import { config as loadEnv } from "dotenv";
import { spawnSync } from "node:child_process";
import { createSupabaseClient } from "../lib/supabase.js";

loadEnv();

function runPrisma(args: string[]) {
  const result = spawnSync("npx", ["prisma", ...args], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} 실패`);
  }
}

async function probeBlogs() {
  const sb = createSupabaseClient();
  return sb.from("blogs").select("id").limit(1);
}

async function main() {
  let probe = await probeBlogs();
  if (!probe.error) {
    console.log("REST로 blogs 조회 가능. 스키마/권한 OK.");
    return;
  }

  console.log(`테이블 확인: ${probe.error.message}`);

  const url = process.env.DATABASE_URL ?? "";
  if (!url || url.includes("YOUR-DB-PASSWORD")) {
    throw new Error(
      "스키마를 올리려면 .env의 DATABASE_URL 에서 YOUR-DB-PASSWORD 를 Supabase Database 비밀번호로 바꾸세요. SQL은 prisma/supabase-init.sql 입니다.",
    );
  }

  const denied = /permission denied/i.test(probe.error.message);
  if (denied) {
    console.log("PostgREST 역할에 GRANT가 없습니다. prisma/supabase-grants.sql 을 적용합니다.");
    runPrisma(["db", "execute", "--schema", "prisma/schema.prisma", "--file", "prisma/supabase-grants.sql"]);
    probe = await probeBlogs();
    if (!probe.error) {
      console.log("GRANT 적용 후 REST로 blogs 조회 가능.");
      return;
    }
    console.log(`GRANT 후에도 실패: ${probe.error.message}`);
  }

  if (/does not exist|Could not find the table|schema cache/i.test(probe.error.message) || denied) {
    console.log("DATABASE_URL로 prisma db push 를 시도합니다.");
    runPrisma(["db", "push", "--skip-generate"]);
    runPrisma(["db", "execute", "--schema", "prisma/schema.prisma", "--file", "prisma/supabase-grants.sql"]);
    probe = await probeBlogs();
    if (!probe.error) {
      console.log("스키마+GRANT 적용 후 REST로 blogs 조회 가능.");
      return;
    }
    throw new Error(probe.error.message);
  }

  throw new Error(probe.error.message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
