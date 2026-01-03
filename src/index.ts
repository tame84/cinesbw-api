import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import scrapingRoutes from "./routes/scrape";
import showsRoutes from "./routes/shows";

const app = new Hono().use(logger()).route("/scrape", scrapingRoutes).route("/shows", showsRoutes);

serve(
    {
        fetch: app.fetch,
        port: 3000,
    },
    (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
    }
);
