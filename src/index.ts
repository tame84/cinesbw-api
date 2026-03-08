import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import scrapingRoutes from "./routes/scrape";
import scraping2Routes from "./routes/scrape2";
import { customLogger } from "src/utils/logger";

const app = new Hono()
    .use(logger(customLogger))
    .onError((err, c) => {
        console.error(err);
        return c.text("Internal Server Error", 500);
    })
    .route("/scrape", scrapingRoutes)
    .route("/scrape2", scraping2Routes);

serve(
    {
        fetch: app.fetch,
        port: 3000,
    },
    (info) => {
        if (info.address === "::") {
            console.log(`Server is running on http://localhost:${info.port}`);
        } else {
            console.log(`Server is running...`);
        }
    },
);
