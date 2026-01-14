import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import scrapingRoutes from "./routes/scrape";
import showsRoutes from "./routes/shows";
import movieRoutes from "./routes/movie";
import genresRoutes from "./routes/genres";
import versionsRoutes from "./routes/versions";
import cinemasRoutes from "./routes/cinemas";

const app = new Hono()
    .use(logger())
    .route("/scrape", scrapingRoutes)
    .route("/shows", showsRoutes)
    .route("/movie", movieRoutes)
    .route("/genres", genresRoutes)
    .route("/versions", versionsRoutes)
    .route("/cinemas", cinemasRoutes);

serve(
    {
        fetch: app.fetch,
        port: 3000,
    },
    (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
    }
);
