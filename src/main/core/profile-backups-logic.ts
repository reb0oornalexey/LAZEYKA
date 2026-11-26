/** Е6: имена файлов копий профиля перед обновлением. Чистая логика без Electron. */

export const BACKUPS_KEPT = 3

const SAFE_VER = /^[0-9A-Za-z.-]{1,24}$/

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

/** before-update_20261121-153012_2.0.0_to_2.0.1.lazeyka (время местное). */
export function backupName(at: number, from: string, to: string | null): string {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const f = SAFE_VER.test(from) ? from : 'x'
  const t = to && SAFE_VER.test(to) ? `_to_${to}` : ''
  return `before-update_${stamp}_${f}${t}.lazeyka`
}

export function parseBackupName(name: string): { at: number; from: string; to: string | null } | null {
  const m = /^before-update_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_([0-9A-Za-z.-]{1,24})(?:_to_([0-9A-Za-z.-]{1,24}))?\.lazeyka$/.exec(name)
  if (!m) return null
  const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  if (!Number.isFinite(at)) return null
  return { at, from: m[7], to: m[8] ?? null }
}
