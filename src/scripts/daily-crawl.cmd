@echo off
cd /d "%~dp0..\.."
npx tsx src/scripts/crawl-period.ts --yesterday
