import { Hono } from "hono";
import { db } from "src/db";
import { cinemasTable } from "src/db/schema";

const app = new Hono().get("/", async (c) => {
    const cinemas = await db.select({ id: cinemasTable.id, name: cinemasTable.name }).from(cinemasTable);
    return c.json({ cinemas });
});

export default app;
