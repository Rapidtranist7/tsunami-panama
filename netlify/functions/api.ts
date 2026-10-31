import type { Config } from "@netlify/functions";
import { handleApi } from "../lib/app";

export default async (req: Request) => handleApi(new URL(req.url).pathname);

export const config: Config = {
  path: ["/api", "/api/*"],
};
