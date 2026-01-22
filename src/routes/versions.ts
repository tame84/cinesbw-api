import { Hono } from "hono";
import { db } from "src/db";
import { showtimesTable } from "src/db/schema";

const app = new Hono().get("/", async (c) => {
    const versions = await db.selectDistinct({ versions: { short: showtimesTable.version } }).from(showtimesTable);
    return c.json(Array.from(new Set(versions.map((v) => v.versions.short.slice(0, 2)).flat())).sort());
});

export default app;
