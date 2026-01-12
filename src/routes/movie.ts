import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "src/db";
import { cinemasTable, moviesTable, showsTable, showtimesTable } from "src/db/schema";

const app = new Hono()
    .get("/", async (c) => {
        const slug = c.req.param("slug") as string;

        const movie = await db
            .select({
                title: moviesTable.title,
                releaseDate: moviesTable.releaseDate,
                runtime: moviesTable.runtime,
                genres: moviesTable.genres,
                direcotrs: moviesTable.directors,
                actors: moviesTable.actors,
                overview: moviesTable.overview,
                backdrop: moviesTable.backdrop,
                poster: moviesTable.poster,
                videos: moviesTable.videos,
            })
            .from(moviesTable)
            .where(eq(moviesTable.slug, slug));

        return c.json({ movie: movie[0] });
    })
    .get("/shows", async (c) => {
        const slug = c.req.param("slug") as string;

        const selectedShows = await db
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
            .innerJoin(showsTable, eq(showsTable.movieUuid, moviesTable.uuid))
            .innerJoin(showtimesTable, eq(showtimesTable.showUuid, showsTable.uuid))
            .innerJoin(cinemasTable, eq(showtimesTable.cinemaId, cinemasTable.id))
            .orderBy(showtimesTable.dateTime);

        const showsMap = new Map();
        for (const show of selectedShows) {
            const showKey = show.show.uuid;
            if (!showsMap.has(showKey)) {
                showsMap.set(showKey, {
                    date: show.show.date,
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

        const shows = Array.from(showsMap.values());

        return c.json({ shows });
    });

export default app;
