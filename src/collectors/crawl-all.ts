import { spawn } from "node:child_process";

function run(script: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["tsx", script], {
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
  });
}

async function main() {
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const skip = process.argv.find((arg) => arg.startsWith("--skip="))?.slice("--skip=".length);
  const jobs = [
    ["tistory", "src/collectors/tistory/crawl.ts"],
    ["velog", "src/collectors/velog/crawl.ts"],
    ["brunch", "src/collectors/brunch/crawl.ts"],
  ] as const;
  for (const [name, script] of jobs) {
    if (only && only !== name) continue;
    if (skip && skip.split(",").includes(name)) continue;
    console.log(`\n===== ${name} =====`);
    await run(script);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
