import { Hono } from "hono";
import { registerUrlInfoRoutes } from "./url-upload/info.js";
import { registerUrlPresignRoutes } from "./url-upload/presign.js";
import { registerUrlMultipartRoutes } from "./url-upload/multipart.js";
import { registerUrlCancelRoutes } from "./url-upload/cancel.js";

const app = new Hono();

registerUrlInfoRoutes(app);
registerUrlPresignRoutes(app);
registerUrlMultipartRoutes(app);
registerUrlCancelRoutes(app);

export default app;
