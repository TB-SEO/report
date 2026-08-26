import { config as loadEnv } from "dotenv";
import { publishWebDocs } from "../lib/publish-web.js";

loadEnv();

async function main() {
  await publishWebDocs(["report", "ads", "wbs"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
