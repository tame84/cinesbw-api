import { Hono } from "hono";
import { db } from "src/db";
import { showtimesTable } from "src/db/schema";

const app = new Hono().get("/", async (c) => {
    const selectedVersions = await db
        .select({ versions: { short: showtimesTable.version, long: showtimesTable.versionLong } })
        .from(showtimesTable);

    const versionsMap = new Map();
    selectedVersions.forEach((version) => {
        const versionFilter = version.versions.short.slice(0, 2);
        if (versionsMap.has(versionFilter)) return;
        versionsMap.set(versionFilter, versionFilter);
    });

    return c.json({ versions: Array.from(versionsMap.values()) });
});

export default app;
