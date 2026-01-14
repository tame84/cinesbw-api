import { Hono } from "hono";
import { db } from "src/db";
import { moviesTable } from "src/db/schema";

const app = new Hono().get("/", async (c) => {
    const genres = await db.select({ genres: moviesTable.genres }).from(moviesTable);
    return c.json({ genres: Array.from(new Set(genres.map((g) => g.genres).flat())).sort() });
});

export default app;
