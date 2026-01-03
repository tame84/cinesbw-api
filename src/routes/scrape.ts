import axios, { AxiosError } from "axios";
import { Hono } from "hono";
import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { createUTCDate, createUTCDateTime } from "src/utils/date";
import { Movie } from "src/utils/types";
import { addMoviesToDb, removeMoviesFromDb } from "src/db";
import { log } from "console";

interface TmdbBFindResponse {
    movie_results: {
        id: number;
    }[];
}

interface UnfetchedMovie {
    url: string;
    imdbId: string | null;
    cinenewsId: string | null;
}

interface FetchedMovie {
    url: string;
    tmdbId: number;
    cinenewsId: string;
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

const CINENEWS_BASE_URL = "https://www.cinenews.be";

const generateUserAgent = () => {
    const ua = new UserAgent(/Chrome/);
    return ua.toString();
};

const generateHeaders = () => {
    const ua = generateUserAgent();

    const versionMatch = ua.match(/(Chrome|Chromium)\/(\d+)/i);
    const majorVersion = versionMatch ? versionMatch[2] : "120";

    return {
        "User-Agent": generateUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.5",
        Referer: "https://www.google.com/",
        "Sec-CH-UA": `"Chromium";v="${majorVersion}", "Not A;Brand";v="24"`,
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Sec-Gpc": "1",
    };
};

const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month}-${day}`;
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

const getMoviesTmdbId = async () => {
    const movies = new Set<string>();

    let startrow = 1;
    while (true) {
        const response = await axios.get(
            `${CINENEWS_BASE_URL}/fr/cinema/programme/region/brabant-wallon?startrow=${startrow}`,
            {
                headers: generateHeaders(),
            }
        );
        if (response.status !== 200) {
            throw new Error(`Failed to fetch movies: ${response.status}`);
        }
        const data = response.data;
        const $ = cheerio.load(data);

        const newMovies = $(".movies-list")
            .find("article.movies-stk .stk-title a")
            .map((_, el) => el.attribs["href"])
            .get();

        if (newMovies.length === 0) {
            break;
        }

        newMovies.forEach((href) => movies.add(href));
        startrow += 24;
    }

    const unfetchedMovies: UnfetchedMovie[] = [];
    const moviesPage = (
        await Promise.all(
            Array.from(movies).map(async (movieHref) => {
                const pageUrl = `${CINENEWS_BASE_URL}${movieHref}`;
                const response = await axios
                    .get(pageUrl, {
                        headers: generateHeaders(),
                    })
                    .catch((error) => {
                        console.log(`Failed to fetch movie page at ${pageUrl}`);
                        throw error;
                    });
                if (response.status !== 200) {
                    unfetchedMovies.push({ url: pageUrl, imdbId: null, cinenewsId: null });
                    return null;
                }
                const data = response.data;
                const $ = cheerio.load(data);
                return {
                    pageUrl,
                    $,
                };
            })
        )
    ).filter((page) => page !== null);

    const fetchedMovies: FetchedMovie[] = (
        await Promise.all(
            moviesPage.map(async (page) => {
                const imdbId = page.$("[data-vod-imdb]").attr("data-vod-imdb");
                const cinenewsId = page.$("[data-tbl-id]").attr("data-tbl-id");
                if (!imdbId || !cinenewsId) {
                    unfetchedMovies.push({ url: page.pageUrl, imdbId: null, cinenewsId: cinenewsId || null });
                    return null;
                }

                const response = await axios
                    .get(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=fr-BE`, {
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                        },
                    })
                    .catch((error) => {
                        console.log(`Failed to fetch TMDb data for IMDb ID ${imdbId}`);
                        throw error;
                    });
                if (response.status !== 200) {
                    unfetchedMovies.push({ url: page.pageUrl, imdbId, cinenewsId });
                    return null;
                }
                const data: TmdbBFindResponse = response.data;

                return {
                    url: page.pageUrl,
                    tmdbId: data.movie_results[0].id,
                    cinenewsId,
                };
            })
        )
    ).filter((details) => details !== null);

    return { fetchedMovies, unfetchedMovies };
};

const getMoviesShowtimes = async (cinenewsId: string) => {
    let shows = [];
    const today = new Date();
    let dateIterator = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    while (true) {
        const showtimesResponse = await axios
            .get(
                `${CINENEWS_BASE_URL}/modules/ajax_showtimes.cfm?Lang=fr&act=movieShowtimes&moviesId=${cinenewsId}&v3&regionId=3&selDate=${formatDate(
                    dateIterator
                )}`,
                {
                    headers: generateHeaders(),
                }
            )
            .catch((error) => {
                console.log(`Failed to fetch showtimes for movie ID ${cinenewsId} on ${formatDate(dateIterator)}`);
                throw error;
            });
        if (showtimesResponse.status !== 200) {
            return null;
        }
        const showtimesData: CinenewsShowtimesResponse = showtimesResponse.data;

        if (showtimesData.data.length === 0) {
            if (dateIterator.getTime() - today.getTime() > 1000 * 60 * 60 * 24 * 7) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 750 + Math.random() * 1000));
            dateIterator = new Date(dateIterator.setDate(dateIterator.getDate() + 1));
            continue;
        }

        shows.push({
            date: createUTCDate(dateIterator.getDate(), dateIterator.getMonth() + 1, dateIterator.getFullYear()),
            cinemas: await Promise.all(
                showtimesData.data[0].data.map(async (cinema) => {
                    return {
                        cinema: {
                            yellowName: cinema.YellowName,
                            yellowId: cinema.YellowID,
                        },
                        times: cinema.data.map((show) => {
                            const [dateStr, timeStr] = show.ShowDateTime.split(" ");
                            const [day, month, year] = dateStr.split("-").map(Number);
                            const [hours, minutes] = timeStr.split(":").map(Number);
                            const date = createUTCDate(day, month, year);
                            const dateTime = createUTCDateTime(date, hours, minutes);

                            return {
                                showDateTime: dateTime,
                                version: {
                                    short: show.mVersion,
                                    long: show.mVersionLong,
                                },
                            };
                        }),
                    };
                })
            ),
        });

        await new Promise((resolve) => setTimeout(resolve, 750 + Math.random() * 1000));
        dateIterator = new Date(dateIterator.setDate(dateIterator.getDate() + 1));
    }

    return shows;
};

const getMoviesCinenewsData = async (unfetchedMovies: UnfetchedMovie[]): Promise<Movie[]> => {
    const movies = (
        await Promise.all(
            unfetchedMovies.map(async (movie) => {
                if (!movie.cinenewsId) {
                    return null;
                }
                const shows = await getMoviesShowtimes(movie.cinenewsId);
                if (!shows) {
                    return null;
                }

                const response = await axios
                    .get(movie.url, {
                        headers: generateHeaders(),
                    })
                    .catch((error) => {
                        console.log(`Failed to fetch movie page at ${movie.url}`);
                        throw error;
                    });
                if (response.status !== 200) {
                    return null;
                }
                const data = response.data;
                const $ = cheerio.load(data);

                const $detailsHeader = $(".detail-header");
                const title = $detailsHeader.find(".detail-header-title h1").text().trim();
                const releaseDateStr = $detailsHeader
                    .find(".detail-header-more [itemprop='datePublished']")
                    .text()
                    .trim();
                const [year, month, day] = releaseDateStr.split("-").map(Number);
                const releaseDate = createUTCDate(day, month, year);
                const runtime = Number(
                    $detailsHeader.find(".list-dot span:contains('minutes')").text().split("minutes")[0].trim()
                );
                const genres = $detailsHeader
                    .find(".detail-header-more b:contains('Genre :') ~ a.c")
                    .map((_, el) => $(el).text().trim())
                    .get();
                const directors = $detailsHeader
                    .find(".detail-header-more [itemprop='director']")
                    .map((_, el) => $(el).text().trim())
                    .get();
                const actors = $("[data-on-tab='casting'] h4 [itemprop='url']")
                    .slice(0, 5)
                    .map((_, el) => $(el).text().trim())
                    .get();
                const overview = $detailsHeader.find(".detail-header-description").text().trim();
                const backdropUrl =
                    $("[data-on-tab='photos'] a[data-bg]").attr("data-bg")?.trim().split("/q")[1] || null;
                const posterUrl =
                    $detailsHeader.find(".detail-header-poster img").attr("data-src")?.trim().split("/q")[1] || null;

                return {
                    movie: {
                        slug: slugifyTitle(title, movie.cinenewsId),
                        title,
                        releaseDate,
                        runtime,
                        genres,
                        directors,
                        actors,
                        overview,
                        backdrop: {
                            medium: `https://www.cinenews.be/image/x1386x780/q${backdropUrl}`,
                            large: `https://www.cinenews.be/image/x2275x1280/q${backdropUrl}`,
                        },
                        posterUrl,
                        poster: {
                            small: `https://www.cinenews.be/image/s185/q${posterUrl}`,
                            medium: `https://www.cinenews.be/image/s342/q${posterUrl}`,
                            large: `https://www.cinenews.be/image/s500/q${posterUrl}`,
                        },
                        videos: [],
                    },
                    shows,
                };
            })
        )
    ).filter((movie) => movie !== null);

    return movies;
};

const getMoviesTmdbData = async (fetchedMovies: FetchedMovie[]): Promise<Movie[]> => {
    const movies = (
        await Promise.all(
            fetchedMovies.map(async (movie) => {
                const shows = await getMoviesShowtimes(movie.cinenewsId);
                if (!shows) {
                    return null;
                }

                const response = await axios
                    .get(
                        `https://api.themoviedb.org/3/movie/${movie.tmdbId}?append_to_response=credits%2Cvideos&language=fr-BE`,
                        {
                            headers: {
                                Accept: "application/json",
                                Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                            },
                        }
                    )
                    .catch((error) => {
                        console.log(`Failed to fetch TMDb data for movie ID ${movie.tmdbId}`);
                        throw error;
                    });
                if (response.status !== 200) {
                    return null;
                }
                const data: TmdbMovieDetailsResponse = response.data;
                const [year, month, day] = data.release_date.split("-").map(Number);
                const releaseDate = createUTCDate(day, month, year);

                return {
                    movie: {
                        slug: slugifyTitle(data.title, movie.cinenewsId),
                        title: data.title,
                        releaseDate: releaseDate,
                        runtime: data.runtime,
                        genres: data.genres.map((genre) => genre.name),
                        directors: data.credits.crew
                            .filter(
                                (member) =>
                                    member.department.toLowerCase() === "directing" &&
                                    member.job.toLowerCase() === "director"
                            )
                            .map((director) => director.name),
                        actors: data.credits.cast.map((actor) => actor.name).slice(0, 5),
                        overview: data.overview,
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
                            .map(
                                (video) =>
                                    video.site.toLowerCase() === "youtube" &&
                                    video.type.toLowerCase() === "trailer" && {
                                        name: video.name,
                                        key: video.key,
                                    }
                            )
                            .filter((video) => video !== false),
                    },
                    shows,
                };
            })
        )
    ).filter((movie) => movie !== null);

    return movies;
};

const app = new Hono().get("/", async (c) => {
    const startTime = performance.now();
    const max403Retries = 3;

    for (let attemp = 1; attemp <= max403Retries; attemp++) {
        try {
            log(`Scraping attempt ${attemp}...`);
            const moviesTmdbId = await getMoviesTmdbId();
            const fetchedMoviesData = await getMoviesTmdbData(moviesTmdbId.fetchedMovies);
            const unfetchedMoviesData = await getMoviesCinenewsData(moviesTmdbId.unfetchedMovies);

            const [insertedMoviesCount, insertedShowsCount, insertedShowtimesCount] = await addMoviesToDb([
                ...fetchedMoviesData,
                ...unfetchedMoviesData,
            ]);
            const [removedShowsCount, removedMoviesCount] = await removeMoviesFromDb();

            return c.json({
                timeToCompleteMs: Number((performance.now() - startTime).toFixed(0)),
                scrapedMoviesCount: fetchedMoviesData.length + unfetchedMoviesData.length,
                insertedMoviesCount,
                insertedShowsCount,
                insertedShowtimesCount,
                removedShowsCount,
                removedMoviesCount,
            });
        } catch (error) {
            if (error instanceof AxiosError && error.status === 403) {
                if (attemp < max403Retries) {
                    console.log(`Access denied (403). Retrying... Attempt ${attemp}/${max403Retries - 1}`);
                    continue;
                } else {
                    console.log(`Access denied (403). Max retries reached. Aborting.`);
                    return c.json({ error: "Access denied (403). Max retries reached." }, 403);
                }
            }
            console.error(error);
            return c.json({ error: "An error occurred during scraping." }, 500);
        }
    }
    const endTime = performance.now();
    const elapsedTime = endTime - startTime;
    console.log(`Scraping completed in ${elapsedTime.toFixed(0)} milliseconds.`);
});

export default app;
