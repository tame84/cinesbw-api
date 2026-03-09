import axios from "axios";
import { Hono } from "hono";
import * as cheerio from "cheerio";
import { addMoviesToDb, removeMoviesFromDb } from "src/db";
import { Movie, Show } from "src/utils/types";
import { vValidator } from "@hono/valibot-validator";
import * as v from "valibot";
import dayjs from "dayjs";

interface TmdbMovieDetailsResponse {
    backdrop_path: string;
    genres: {
        name: string;
    }[];
    overview: string;
    poster_path: string;
    release_date: string;
    runtime: number;
    title: string;
    original_language: string;
    credits: {
        cast: {
            name: string;
        }[];
        crew: {
            name: string;
            department: string;
            job: string;
        }[];
    };
    videos: {
        results: {
            name: string;
            site: string;
            key: string;
            type: string;
        }[];
    };
}

interface CinenewsShowtimesResponse {
    data: {
        data: {
            YellowID: number;
            YellowName: string;
            data: {
                MoviesShowtimeID: number;
                ShowDateTime: string;
                mVersion: string;
                mVersionLong: string;
            }[];
        }[];
    }[];
}

const CINENEWS_BASE_URL = "https://www.cinenews.be";

const generateHeaders = () => {
    const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    const headers = {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
        "sec-fetch-mode": "navigate",
    };

    return headers;
};

const slugifyTitle = (title: string, cinenewsId: string) => {
    return title
        .normalize("NFD")
        .trim()
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .concat(`_${cinenewsId}`)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
};

const displayNameFr = new Intl.DisplayNames(["fr"], { type: "language" });
const languageCodeToFrenchName = (code: string) => {
    const name = displayNameFr.of(code);
    if (name) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    } else {
        return code;
    }
};

const getAllMoviesUrl = async (): Promise<string[]> => {
    const moviesUrl = new Set<string>();

    let startRow = 1;
    while (true) {
        const response = await axios.get(
            CINENEWS_BASE_URL + `/fr/cinema/programme/region/brabant-wallon/?startrow=${startRow}`,
            {
                headers: generateHeaders(),
            },
        );
        if (response.status !== 200) {
            throw new Error(`Failed to fetch all movies: ${response.statusText}`);
        }

        const data = response.data;
        const $page = cheerio.load(data);

        const scrapedMoviesHref = $page(".movies-list")
            .find("article.movies-stk .stk-title a")
            .map((_, el) => el.attribs["href"])
            .get();

        if (scrapedMoviesHref.length === 0) {
            break;
        }

        scrapedMoviesHref.forEach((href) => moviesUrl.add(CINENEWS_BASE_URL + href));
        startRow += 24;
    }

    return Array.from(moviesUrl);
};

const getMovieShowtimes = async (cinenewsId: string) => {
    let shows = [];
    const today = dayjs().startOf("date").toDate();
    let dateIterator = dayjs().startOf("date");
    // Iterate over the next 7 days or until we hit a Wednesday (when the new movies are released)
    while (true) {
        const response = await axios.get(
            CINENEWS_BASE_URL +
                `/modules/ajax_showtimes.cfm?Lang=fr&act=movieShowtimes&moviesId=${cinenewsId}&v3&regionId=3&selDate=${dateIterator.format("YYYY-MM-DD")}`,
            {
                headers: { ...generateHeaders(), "X-Requested-With": "XMLHttpRequest" },
            },
        );
        if (response.status !== 200) {
            console.error(
                `Failed to fetch showtimes for movie ID ${cinenewsId} on ${dateIterator.format("YYYY-MM-DD")}: ${response.statusText}`,
            );
            throw new Error(
                `Failed to fetch showtimes for movie ID ${cinenewsId} on ${dateIterator.format("YYYY-MM-DD")}`,
            );
        }

        const data: CinenewsShowtimesResponse = response.data;

        if (data.data.length === 0) {
            if (dateIterator.diff(today) > 1000 * 60 * 60 * 24 * 7) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            dateIterator = dateIterator.add(1, "day");
            continue;
        }

        shows.push({
            date: dateIterator.format(),
            cinemas: data.data[0].data.map((cinema) => ({
                cinema: {
                    name: cinema.YellowName,
                    id: cinema.YellowID,
                },
                showtimes: cinema.data.map((show) => {
                    const datetime = dayjs(show.ShowDateTime);

                    return {
                        showDatetime: datetime.format(),
                        version: {
                            short: show.mVersion,
                            long: show.mVersionLong,
                        },
                    };
                }),
            })),
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));
        dateIterator = dateIterator.add(1, "day");
    }

    return shows;
};

const getAllMoviesData = async (moviesUrl: string[]) => {
    const moviesIds = (
        await Promise.all(
            moviesUrl.map(async (url) => {
                const response = await axios.get(url, {
                    headers: generateHeaders(),
                });
                if (response.status !== 200) {
                    console.error(`Failed to fetch movie data for ${url}: ${response.statusText}`);
                    throw new Error(`Failed to fetch movie data for ${url}: ${response.statusText}`);
                }

                const data = response.data;
                const $page = cheerio.load(data);

                const imdbId = $page("[data-vod-imdb]").attr("data-vod-imdb");
                const cinenewsId = $page("[data-tbl-id]").attr("data-tbl-id") as string;

                if (!cinenewsId) {
                    console.error(`Failed to extract Cinenews ID for ${url}`);
                    throw new Error(`Failed to extract Cinenews ID for ${url}`);
                }

                if (imdbId) {
                    const response = await axios.get(
                        `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=fr-BE`,
                        {
                            headers: {
                                Accept: "application/json",
                                Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                            },
                        },
                    );
                    if (response.status !== 200) {
                        console.error(`Failed to fetch movie data from TMDB for ${imdbId}: ${response.statusText}`);
                        throw new Error(`Failed to fetch movie data from TMDB for ${imdbId}: ${response.statusText}`);
                    }

                    const data: { movie_results: { id: number }[] } = response.data;
                    if (data.movie_results.length === 0) {
                        return {
                            url,
                            imdbId,
                            tmdbId: null,
                            cinenewsId,
                            $page,
                        };
                    }

                    return {
                        url,
                        imdbId,
                        tmdbId: data.movie_results[0].id,
                        cinenewsId,
                        $page,
                    };
                } else {
                    return {
                        url,
                        imdbId: null,
                        tmdbId: null,
                        cinenewsId,
                        $page,
                    };
                }
            }),
        )
    ).filter((movie) => movie !== undefined);

    const movies: Movie[] = await Promise.all(
        moviesIds.map(async (movie) => {
            const shows: Show[] = await getMovieShowtimes(movie.cinenewsId);

            if (movie.tmdbId) {
                const response = await axios.get(
                    `https://api.themoviedb.org/3/movie/${movie.tmdbId}?append_to_response=credits%2Cvideos&language=fr-BE`,
                    {
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                        },
                    },
                );
                if (response.status !== 200) {
                    console.error(`Failed to fetch TMDb data for movie ID ${movie.tmdbId}: ${response.statusText}`);
                    throw new Error(`Failed to fetch TMDb data for movie ID ${movie.tmdbId}`);
                }

                const data: TmdbMovieDetailsResponse = response.data;
                const releaseDate = dayjs(data.release_date);
                let releaseDateStr = null;
                if (releaseDate.isValid()) {
                    releaseDateStr = releaseDate.format();
                }

                return {
                    movie: {
                        imdbId: movie.imdbId,
                        tmdbId: movie.tmdbId,
                        slug: slugifyTitle(data.title, movie.cinenewsId),
                        title: data.title,
                        releaseDate: releaseDateStr,
                        runtime: data.runtime,
                        genres: data.genres.map((genre) => genre.name),
                        overview: data.overview,
                        originalLanguage: languageCodeToFrenchName(data.original_language),
                        directors: data.credits.crew
                            .filter(
                                (member) =>
                                    member.department.toLowerCase() === "directing" &&
                                    member.job.toLowerCase() === "director",
                            )
                            .map((director) => director.name),
                        actors: data.credits.cast.map((actor) => actor.name).slice(0, 5),
                        backdrop: {
                            medium: `https://image.tmdb.org/t/p/w780${data.backdrop_path}`,
                            large: `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`,
                        },
                        poster: {
                            small: `https://image.tmdb.org/t/p/w185${data.poster_path}`,
                            medium: `https://image.tmdb.org/t/p/w342${data.poster_path}`,
                            large: `https://image.tmdb.org/t/p/w500${data.poster_path}`,
                        },
                        videos: data.videos.results
                            .filter(
                                (video) =>
                                    video.site.toLowerCase() === "youtube" && video.type.toLowerCase() === "trailer",
                            )
                            .map((video) => ({ name: video.name, key: video.key })),
                    },
                    shows,
                };
            } else {
                const $detailsHeader = movie.$page(".detail-header");
                const title = $detailsHeader.find(".detail-header-title h1").text().trim();
                let releaseDateStr: string | null = $detailsHeader
                    .find(".detail-header-more [itemprop='datePublished']")
                    .text()
                    .trim();
                const releaseDate = dayjs(releaseDateStr);
                if (releaseDate.isValid()) {
                    releaseDateStr = releaseDate.format();
                } else {
                    releaseDateStr = null;
                }
                const runtime = Number(
                    $detailsHeader.find(".list-dot span:contains('minutes')").text().split("minutes")[0].trim(),
                );
                const genres = $detailsHeader
                    .find(".detail-header-more b:contains('Genre :') ~ a.c")
                    .map((_, el) => movie.$page(el).text().trim())
                    .get();
                const overview = $detailsHeader.find(".detail-header-description").text().trim();
                const directors = $detailsHeader
                    .find(".detail-header-more [itemprop='director']")
                    .map((_, el) => movie.$page(el).text().trim())
                    .get();
                const actors = movie
                    .$page("[data-on-tab='casting'] h4 [itemprop='url']")
                    .slice(0, 5)
                    .map((_, el) => movie.$page(el).text().trim())
                    .get();
                const backdropUrl =
                    movie.$page("[data-on-tab='photos'] a[data-bg]").attr("data-bg")?.trim().split("/q")[1] || null;
                const posterUrl =
                    $detailsHeader.find(".detail-header-poster img").attr("data-src")?.trim().split("/q")[1] || null;

                return {
                    movie: {
                        imdbId: movie.imdbId,
                        tmdbId: null,
                        slug: slugifyTitle(title, movie.cinenewsId),
                        title,
                        releaseDate: releaseDateStr,
                        runtime,
                        genres,
                        overview,
                        originalLanguage: null,
                        directors,
                        actors,
                        backdrop: backdropUrl
                            ? {
                                  medium: `https://www.cinenews.be/image/x1386x780/q${backdropUrl}`,
                                  large: `https://www.cinenews.be/image/x2275x1280/q${backdropUrl}`,
                              }
                            : null,
                        poster: posterUrl
                            ? {
                                  small: `https://www.cinenews.be/image/s185/q${posterUrl}`,
                                  medium: `https://www.cinenews.be/image/s342/q${posterUrl}`,
                                  large: `https://www.cinenews.be/image/s500/q${posterUrl}`,
                              }
                            : null,
                        videos: null,
                    },
                    shows,
                };
            }
        }),
    );

    return movies;
};

const app = new Hono().get(
    "/",
    vValidator("query", v.object({ apiKey: v.string() }), (result, c) => {
        if (!result.success || result.output.apiKey !== process.env.SCRAPE_API_KEY) {
            return c.json({ error: "Unauthorized" }, 401);
        }
    }),
    async (c) => {
        const startTime = performance.now();
        const max403Retries = 3;

        for (let attempt = 0; attempt <= max403Retries; attempt++) {
            try {
                const moviesUrl = await getAllMoviesUrl();
                const moviesData = await getAllMoviesData(moviesUrl);

                const [insertedMoviesCount, insertedShowsCount, insertedShowtimesCount] =
                    await addMoviesToDb(moviesData);
                const [removedShowsCount, removedMoviesCount] = await removeMoviesFromDb();

                return c.json({
                    timeTakenMs: Number((performance.now() - startTime).toFixed(0)),
                    counts: {
                        scrapedMovies: moviesData.length,
                        insertedMovies: insertedMoviesCount,
                        insertedShows: insertedShowsCount,
                        insertedShowtimes: insertedShowtimesCount,
                        removedMovies: removedMoviesCount,
                        removedShows: removedShowsCount,
                    },
                });
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    if (error.response?.status === 403) {
                        if (attempt < max403Retries) {
                            console.log(`Access denied (403). Retrying... Attempt ${attempt + 1}/${max403Retries}`);
                            await new Promise((resolve) => setTimeout(resolve, 2000));
                            continue;
                        } else {
                            console.error(`Access denied (403) after ${max403Retries} attempts. Aborting.`);
                            return c.json({ error: "Access denied (403). Max retries reached" }, 403);
                        }
                    }

                    console.error(`Error fetching movies data: ${error.message}`);
                    console.error(`Request URL: ${error.config?.url}`);
                    console.error(`Request headers: ${JSON.stringify(error.config?.headers)}`);
                    console.error(`Response data:\n ${error.response?.data}`);
                } else {
                    console.error("Error fetching movies data:", error);
                }
                return c.json({ error: "Failed to fetch movies data" }, 500);
            }
        }
    },
);

export default app;
