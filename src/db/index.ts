import { eq, lt, notExists } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { version } from "os";
import { moviesTable, showsTable, showtimesTable } from "src/db/schema";
import { Movie } from "src/utils/types";

export const db = drizzle(process.env.DATABASE_URL!);

export const addMoviesToDb = async (movies: Movie[]) => {
    const moviesToInsert = movies.map((m) => ({
        slug: m.movie.slug,
        title: m.movie.title,
        releaseDate: m.movie.releaseDate,
        runtime: m.movie.runtime,
        genres: m.movie.genres,
        directors: m.movie.directors,
        actors: m.movie.actors,
        overview: m.movie.overview,
        backdrop: m.movie.backdrop,
        poster: m.movie.poster,
        videos: m.movie.videos,
    }));
    if (!moviesToInsert.length) return [0, 0, 0];

    const insertedMovies = await db
        .insert(moviesTable)
        .values(moviesToInsert)
        .onConflictDoUpdate({ target: moviesTable.slug, set: { slug: moviesTable.slug } })
        .returning({ uuid: moviesTable.uuid, slug: moviesTable.slug });

    const insertedShowsCount = (
        await Promise.all(
            insertedMovies.map(async (movie) => {
                const existingMovie = movies.find((m) => m.movie.slug === movie.slug);
                const shows = existingMovie?.shows;
                if (!shows || shows.length === 0) return { count: 0, insertedShowtimesCount: 0 };

                const showstoInsert = shows.map((show) => ({
                    date: show.date,
                    movieUuid: movie.uuid,
                }));

                const insertedShows = await db
                    .insert(showsTable)
                    .values(showstoInsert)
                    .onConflictDoUpdate({
                        target: [showsTable.date, showsTable.movieUuid],
                        set: { date: showsTable.date },
                    })
                    .returning({ uuid: showsTable.uuid, date: showsTable.date });

                const insertedShowtimesCount = (
                    await Promise.all(
                        insertedShows.map(async (show) => {
                            const existingShow = shows.find((s) => s.date.getTime() === show.date.getTime());
                            const showtimes = existingShow?.cinemas;
                            if (!showtimes || showtimes.length === 0) return 0;

                            const showtimesToInsert = showtimes.flatMap((c) => {
                                return c.times.map((t) => ({
                                    dateTime: t.showDateTime,
                                    version: t.version.short,
                                    versionLong: t.version.long,
                                    showUuid: show.uuid,
                                    cinemaId: c.cinema.yellowId,
                                }));
                            });

                            const insertedShowtimes = await db
                                .insert(showtimesTable)
                                .values(showtimesToInsert)
                                .onConflictDoNothing()
                                .returning({ dateTime: showtimesTable.dateTime });
                            return insertedShowtimes.length;
                        })
                    )
                ).reduce((a, b) => a + b, 0);

                return { count: insertedShows.length, insertedShowtimesCount };
            })
        )
    ).reduce(
        (a, b) => ({
            count: a.count + b.count,
            insertedShowtimesCount: a.insertedShowtimesCount + b.insertedShowtimesCount,
        }),
        { count: 0, insertedShowtimesCount: 0 }
    );

    return [insertedMovies.length, insertedShowsCount.count, insertedShowsCount.insertedShowtimesCount];
};

export const removeMoviesFromDb = async () => {
    const today = new Date();

    const returnedCounts = await db.transaction(async (tx) => {
        const deletedShows = await tx
            .delete(showsTable)
            .where(lt(showsTable.date, today))
            .returning({ movueUuid: showsTable.movieUuid });
        if (deletedShows.length === 0) return [0, 0];

        const deletedMovies = await tx
            .delete(moviesTable)
            .where(notExists(tx.select().from(showsTable).where(eq(showsTable.movieUuid, moviesTable.uuid))))
            .returning({ uuid: moviesTable.uuid });

        return [deletedShows.length, deletedMovies.length];
    });
    return returnedCounts;
};
