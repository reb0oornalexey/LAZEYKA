/** Е6: какие файлы логов старше срока хранения. Чистая логика (то же правило, что pruneOldLogs). */
export function isOldLogName(name: string, maxDays: number, now: number): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name)
  if (!m || !(maxDays > 0)) return false
  const when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return when < now - maxDays * 24 * 60 * 60 * 1000
}
