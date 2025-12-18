import axios from "axios";
import { Hono } from "hono";
import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { createUTCDate, createUTCDateTime } from "src/utils/date";

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
    original_language: string;
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
            throw new Error(`Failed to fetch data: ${response.status}`);
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
                const response = await axios.get(pageUrl, {
                    headers: generateHeaders(),
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
                    unfetchedMovies.push({ url: page.pageUrl, imdbId: null, cinenewsId: null });
                    return null;
                }

                const response = await axios.get(
                    `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=fr-BE`,
                    {
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                        },
                    }
                );
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

const getMoviesData = async (fetchedMovies: FetchedMovie[]) => {
    return await Promise.all(
        fetchedMovies.map(async (movie) => {
            let shows = [];
            const today = new Date();
            let dateIterator = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            while (true) {
                const showtimesResponse = await axios.get(
                    `${CINENEWS_BASE_URL}/modules/ajax_showtimes.cfm?Lang=fr&act=movieShowtimes&moviesId=${
                        movie.cinenewsId
                    }&v3&regionId=3&selDate=${formatDate(dateIterator)}`,
                    {
                        headers: generateHeaders(),
                    }
                );
                if (showtimesResponse.status !== 200) {
                    return { url: movie.url, data: null };
                }
                const showtimesData: CinenewsShowtimesResponse = showtimesResponse.data;

                if (showtimesData.data.length === 0) {
                    if (dateIterator.getTime() - today.getTime() > 1000 * 60 * 60 * 24 * 7) {
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
                    dateIterator = new Date(dateIterator.setDate(dateIterator.getDate() + 1));
                    continue;
                }

                shows.push({
                    date: createUTCDate(
                        dateIterator.getDate(),
                        dateIterator.getMonth() + 1,
                        dateIterator.getFullYear()
                    ),
                    shows: await Promise.all(
                        showtimesData.data[0].data.map(async (cinema) => {
                            return {
                                cinema: {
                                    yellowName: cinema.YellowName,
                                    yellowId: cinema.YellowID,
                                },
                                shows: cinema.data.map((show) => {
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

                await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
                dateIterator = new Date(dateIterator.setDate(dateIterator.getDate() + 1));
            }

            const response = await axios.get(
                `https://api.themoviedb.org/3/movie/${movie.tmdbId}?append_to_response=credits%2Cvideos&language=fr-BE`,
                {
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
                    },
                }
            );
            if (response.status !== 200) {
                return { url: movie.url, data: null };
            }
            const data: TmdbMovieDetailsResponse = response.data;

            return {
                movie: {
                    title: data.title,
                    releaseDate: data.release_date,
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
                    originalLanguage: data.original_language,
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
                                    type: video.type,
                                }
                        )
                        .filter(Boolean),
                },
                shows,
            };
        })
    );
};

const app = new Hono().get("/scrape", async (c) => {
    const startTime = performance.now();

    try {
        const moviesTmdbId = await getMoviesTmdbId();
        const fetchedMoviesData = await getMoviesData(moviesTmdbId.fetchedMovies);

        return c.json(fetchedMoviesData);
    } catch (error) {
        console.error(error);
        return c.json({ error: "An error occurred during scraping." }, 500);
    } finally {
        const endTime = performance.now();
        const elapsedTime = endTime - startTime;
        console.log(`Scraping completed in ${elapsedTime.toFixed(0)} milliseconds.`);
    }
});

export default app;
