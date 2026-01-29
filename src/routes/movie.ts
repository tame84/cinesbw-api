import { vValidator } from "@hono/valibot-validator";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "src/db";
import { cinemasTable, moviesTable, showsTable, showtimesTable } from "src/db/schema";
import { createUTCDate } from "src/utils/date";
import * as v from "valibot";

const app = new Hono()
    .basePath("/:slug")
    .get("/", async (c) => {
        const slug = c.req.param("slug");

        const movie = await db
            .select({
                imdbId: moviesTable.imdbId,
                title: moviesTable.title,
                releaseDate: moviesTable.releaseDate,
                runtime: moviesTable.runtime,
                genres: moviesTable.genres,
                originalLanguage: moviesTable.originalLanguage,
                directors: moviesTable.directors,
                actors: moviesTable.actors,
                overview: moviesTable.overview,
                backdrop: moviesTable.backdrop,
                poster: moviesTable.poster,
                videos: moviesTable.videos,
            })
            .from(moviesTable)
            .where(eq(moviesTable.slug, slug));
        return c.json(movie[0]);
    })
    .get(
        "/shows",
        vValidator("query", v.object({ date: v.optional(v.string()) }), (result, c) => {
            if (!result.success) {
                return c.json({ error: "Invalid query parameters" }, 400);
            }
        }),
        async (c) => {
            const { date } = c.req.valid("query");
            const slug = c.req.param("slug");

            const today = new Date();
            const todayUTC = createUTCDate(today.getDate(), today.getMonth() + 1, today.getFullYear());
            const yesterdayUTC = createUTCDate(today.getDate() - 1, today.getMonth() + 1, today.getFullYear());
            let dateFilter = todayUTC;
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

            const shows = await db
                .select({
                    show: {
                        uuid: showsTable.uuid,
                        date: showsTable.date,
                    },
                    showtime: {
                        dateTime: showtimesTable.dateTime,
                        version: showtimesTable.version,
                        versionLong: showtimesTable.versionLong,
                        showUuid: showtimesTable.showUuid,
                        cinemaId: showtimesTable.cinemaId,
                    },
                    cinema: {
                        id: cinemasTable.id,
                        name: cinemasTable.name,
                        website: cinemasTable.website,
                    },
                })
                .from(moviesTable)
                .where(eq(moviesTable.slug, slug))
                .innerJoin(showsTable, and(eq(showsTable.movieUuid, moviesTable.uuid), eq(showsTable.date, dateFilter)))
                .innerJoin(showtimesTable, eq(showtimesTable.showUuid, showsTable.uuid))
                .innerJoin(cinemasTable, eq(showtimesTable.cinemaId, cinemasTable.id))
                .orderBy(showtimesTable.dateTime);

            const showsMerged = new Map();
            for (const show of shows) {
                const showKey = show.show.uuid;
                if (!showsMerged.has(showKey)) {
                    showsMerged.set(showKey, {
                        date: show.show.date,
                        showtimes: [],
                    });
                }
                showsMerged.get(showKey)?.showtimes.push({
                    dateTime: show.showtime.dateTime,
                    version: show.showtime.version,
                    versionLong: show.showtime.versionLong,
                    cinema: { ...show.cinema },
                });
            }

            return c.json(Array.from(showsMerged.values()));
        },
    );

export default app;
