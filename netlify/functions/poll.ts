import type { Config } from "@netlify/functions";
import { pollOnce } from "../lib/app";

// Runs every 5 minutes so new PTWC bulletins are archived even when nobody is on the site.
export default async () => {
  await pollOnce();
  return new Response("ok");
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
