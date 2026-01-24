import { date, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const cinemasTable = pgTable("cinemas", {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    website: text("website").notNull(),
});

export const moviesTable = pgTable("movies", {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    tmdbId: integer("tmdb_id").unique(),
    imdbId: text("imdb_id").unique(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    releaseDate: date("release_date", { mode: "date" }),
    runtime: integer("runtime"),
    genres: text("genres").array(),
    originalLanguage: text("original_language"),
    directors: text("directors").array(),
    actors: text("actors").array(),
    overview: text("overview"),
    backdrop: jsonb("backdrop"),
    poster: jsonb("poster"),
    videos: jsonb("videos").array(),
});

export const showsTable = pgTable(
    "shows",
    {
        uuid: uuid("uuid").primaryKey().defaultRandom(),
        date: date("date", { mode: "date" }).notNull(),
        movieUuid: uuid("movie_uuid")
            .notNull()
            .references(() => moviesTable.uuid, { onDelete: "cascade", onUpdate: "cascade" }),
    },
    (t) => [unique().on(t.date, t.movieUuid)],
);

export const showtimesTable = pgTable(
    "showtimes",
    {
        dateTime: timestamp("date_time", { mode: "date" }).notNull(),
        version: text("version").notNull(),
        versionLong: text("version_long").notNull(),
        showUuid: uuid("show_uuid")
            .notNull()
            .references(() => showsTable.uuid, { onDelete: "cascade", onUpdate: "cascade" }),
        cinemaId: integer("cinema_id")
            .notNull()
            .references(() => cinemasTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    },
    (t) => [unique().on(t.cinemaId, t.showUuid, t.version, t.dateTime)],
);
