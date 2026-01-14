import { eq, lt, notExists } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { moviesTable, showsTable, showtimesTable } from "src/db/schema";
import { Movie } from "src/utils/types";

export const db = drizzle(process.env.DATABASE_URL!);

export const addMoviesToDb = async (movies: Movie[]) => {
    const moviesToInsert = movies.map((m) => ({
        imdbId: m.movie.imdbId,
        tmdbId: m.movie.tmdbId,
        slug: m.movie.slug,
        title: m.movie.title,
        releaseDate: m.movie.releaseDate && !isNaN(m.movie.releaseDate.getTime()) ? m.movie.releaseDate : null,
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

    return await db.transaction(async (tx) => {
        const insertedMovies = await tx
            .insert(moviesTable)
            .values(moviesToInsert)
            .onConflictDoUpdate({ target: moviesTable.slug, set: { slug: moviesTable.slug } })
            .returning({ uuid: moviesTable.uuid, slug: moviesTable.slug });

        const allShowsToInsert: Array<{ date: Date; movieUuid: string; movieSlug: string }> = [];
        for (const movie of insertedMovies) {
            const existingMovie = movies.find((m) => m.movie.slug === movie.slug);
            const shows = existingMovie?.shows;
            if (shows && shows.length > 0) {
                allShowsToInsert.push(
                    ...shows.map((show) => ({
                        date: show.date,
                        movieUuid: movie.uuid,
                        movieSlug: movie.slug,
                    }))
                );
            }
        }

        if (allShowsToInsert.length === 0) {
            return [insertedMovies.length, 0, 0];
        }

        const insertedShows = await tx
            .insert(showsTable)
            .values(allShowsToInsert)
            .onConflictDoUpdate({
                target: [showsTable.date, showsTable.movieUuid],
                set: { date: showsTable.date },
            })
            .returning({ uuid: showsTable.uuid, date: showsTable.date, movieUuid: showsTable.movieUuid });

        const allShowtimesToInsert = [];
        for (const show of insertedShows) {
            const movieSlug = allShowsToInsert.find(
                (s) => s.movieUuid === show.movieUuid && s.date.getTime() === show.date.getTime()
            )?.movieSlug;
            const existingMovie = movies.find((m) => m.movie.slug === movieSlug);
            const existingShow = existingMovie?.shows.find((s) => s.date.getTime() === show.date.getTime());
            const showtimes = existingShow?.cinemas;

            if (showtimes && showtimes.length > 0) {
                allShowtimesToInsert.push(
                    ...showtimes.flatMap((c) =>
                        c.times.map((t) => ({
                            dateTime: t.showDateTime,
                            version: t.version.short,
                            versionLong: t.version.long,
                            showUuid: show.uuid,
                            cinemaId: c.cinema.yellowId,
                        }))
                    )
                );
            }
        }

        let insertedShowtimesCount = 0;
        if (allShowtimesToInsert.length > 0) {
            const insertedShowtimes = await tx
                .insert(showtimesTable)
                .values(allShowtimesToInsert)
                .onConflictDoNothing()
                .returning({ dateTime: showtimesTable.dateTime });
            insertedShowtimesCount = insertedShowtimes.length;
        }

        return [insertedMovies.length, insertedShows.length, insertedShowtimesCount];
    });
};

export const removeMoviesFromDb = async () => {
    const today = new Date();

    const returnedCounts = await db.transaction(async (tx) => {
        const deletedShows = await tx
            .delete(showsTable)
            .where(lt(showsTable.date, today))
            .returning({ movieUuid: showsTable.movieUuid });
        if (deletedShows.length === 0) return [0, 0];

        const deletedMovies = await tx
            .delete(moviesTable)
            .where(notExists(tx.select().from(showsTable).where(eq(showsTable.movieUuid, moviesTable.uuid))))
            .returning({ uuid: moviesTable.uuid });

        return [deletedShows.length, deletedMovies.length];
    });
    return returnedCounts;
};
