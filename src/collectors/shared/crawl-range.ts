export function argValue(name: string, argv = process.argv): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function addKstDays(ymd: string, delta: number) {
  const date = new Date(`${ymd}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

export function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addKstDays(cursor, 1)) days.push(cursor);
  return days;
}

export function crawlRange(argv = process.argv) {
  const yesterday = argv.includes("--yesterday");
  if (yesterday) {
    const to = addKstDays(kstToday(), -1);
    return { from: to, to };
  }
  const date = argValue("date", argv);
  const from = argValue("from", argv) || date;
  const to = argValue("to", argv) || date;
  return { from, to };
}

export function keepDate(date: string, from?: string, to?: string) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
