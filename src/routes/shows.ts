import { vValidator } from "@hono/valibot-validator";
import { and, arrayOverlaps, eq, inArray, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "src/db";
import { cinemasTable, moviesTable, showsTable, showtimesTable } from "src/db/schema";
import { createUTCDate } from "src/utils/date";
import * as v from "valibot";

interface DBShow {
    show: {
        uuid: string;
        movieUuid: string;
    };
    showtime: {
        dateTime: Date;
        version: string;
        versionLong: string;
    };
    movie: {
        uuid: string;
        slug: string;
        title: string;
        runtime: number | null;
        genres: string[] | null;
        poster: {
            small: string;
            medium: string;
            large: string;
        };
    };
    cinema: {
        name: string;
        website: string;
    };
}

interface TodayShow {
    slug: string;
    title: string;
    runtime: number | null;
    genres: string[] | null;
    poster: {
        small: string;
        medium: string;
        large: string;
    };
    showtimes: {
        dateTime: Date;
        version: string;
        versionLong: string;
        cinema: {
            name: string;
            website: string;
        };
    }[];
}

enum CinemaEnum {
    CINES_WELLINGTON = 60,
    CINEMA_ETOILE = 3946,
    CINE_CENTRE = 209,
    CINE4 = 62932,
    KINEPOLIS_IMAGIBRAINE = 57,
    PATHE_LOUVAIN_LA_NEUVE = 12383,
}

enum VersionEnum {
    VO = "VO",
    VF = "VF",
    VN = "VN",
}

const schema = v.object({
    date: v.optional(v.string()),
    cinemas: v.optional(
        v.pipe(
            v.string(),
            v.transform((str) =>
                str
                    .split(",")
                    .map((id) => Number(id.trim()))
                    .filter(Boolean),
            ),
            v.array(v.enum(CinemaEnum)),
        ),
    ),
    versions: v.optional(
        v.pipe(
            v.string(),
            v.transform((str) =>
                str
                    .split(",")
                    .map((s) => s.toUpperCase().trim())
                    .filter(Boolean),
            ),
            v.array(v.enum(VersionEnum)),
        ),
    ),
    genres: v.optional(
        v.pipe(
            v.string(),
            v.transform((str) =>
                str
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
            ),
            v.array(v.string()),
        ),
    ),
});

const app = new Hono()
    .get(
        "/",
        vValidator("query", schema, (result, c) => {
            if (!result.success) {
                return c.json({ error: "Invalid query parameters" }, 400);
            }
        }),
        async (c) => {
            const { date, cinemas, versions, genres } = c.req.valid("query");

            const today = new Date();
            const yesterdayUTC = createUTCDate(today.getDate() - 1, today.getMonth() + 1, today.getFullYear());
            let dateFilter = yesterdayUTC;
            if (date) {
                const [year, months, days] = date.split("-").map(Number);
                const dateUTC = createUTCDate(days, months, year);
                if (!isNaN(dateUTC.getTime())) {
                    dateFilter = dateUTC;
                }
            }

            if (dateFilter.getTime() < yesterdayUTC.getTime()) {
                return c.json({ error: "Date must be today or in the future" }, 400);
            }

            const cinemasFilter = cinemas || null;
            const versionsFilter = versions || null;
            const genresFilter = genres || null;

            const showtimesFilters = [
                cinemasFilter ? inArray(showtimesTable.cinemaId, cinemasFilter) : undefined,
                versionsFilter ? or(...versionsFilter.map((v) => like(showtimesTable.version, `${v}%`))) : undefined,
            ].filter(Boolean);
            const moviesFilters = [genresFilter ? arrayOverlaps(moviesTable.genres, genresFilter) : undefined].filter(
                Boolean,
            );

            const todaySelectedShows = (await db
                .select({
                    show: {
                        uuid: showsTable.uuid,
                        movieUuid: showsTable.movieUuid,
                    },
                    showtime: {
                        dateTime: showtimesTable.dateTime,
                        version: showtimesTable.version,
                        versionLong: showtimesTable.versionLong,
                    },
                    movie: {
                        slug: moviesTable.slug,
                        title: moviesTable.title,
                        runtime: moviesTable.runtime,
                        genres: moviesTable.genres,
                        poster: moviesTable.poster,
                    },
                    cinema: {
                        name: cinemasTable.name,
                        website: cinemasTable.website,
                    },
                })
                .from(showsTable)
                .where(eq(showsTable.date, dateFilter))
                .innerJoin(showtimesTable, and(eq(showsTable.uuid, showtimesTable.showUuid), ...showtimesFilters))
                .innerJoin(moviesTable, and(eq(showsTable.movieUuid, moviesTable.uuid), ...moviesFilters))
                .innerJoin(cinemasTable, eq(showtimesTable.cinemaId, cinemasTable.id))
                .orderBy(moviesTable.slug, showtimesTable.dateTime)) as DBShow[];

            const showsMap = new Map<string, TodayShow>();
            for (const show of todaySelectedShows) {
                const showKey = `${show.show.uuid}-${show.show.movieUuid}`;
                if (!showsMap.has(showKey)) {
                    showsMap.set(showKey, {
                        ...show.movie,
                        showtimes: [],
                    });
                }

                showsMap.get(showKey)?.showtimes.push({
                    dateTime: show.showtime.dateTime,
                    version: show.showtime.version,
                    versionLong: show.showtime.versionLong,
                    cinema: { ...show.cinema },
                });
            }

            const todayShows = Array.from(showsMap.values());

            return c.json({ showsCount: todayShows.length, shows: todayShows });
        },
    )
    .get("/dates", async (c) => {
        const dates = await db.selectDistinct({ date: showsTable.date }).from(showsTable);
        return c.json(Array.from(dates.flatMap((d) => d.date)).sort((a, b) => a.getTime() - b.getTime()));
    });

export default app;
