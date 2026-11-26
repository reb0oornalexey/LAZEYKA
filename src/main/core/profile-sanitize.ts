/**
 * Что из конфига попадает в профиль `.lazeyka` и что из чужого профиля
 * принимается. Чистая логика без Electron.
 *
 * Не уносим и не принимаем:
 *  - секрет прокси Telegram (`tgws.secret`) — по нему чужой человек
 *    пользуется вашим прокси, а при импорте он подменял бы ваш;
 *  - зерно идентификатора устройства (`deviceHwidSeed`) — по нему провайдер
 *    подписки считает устройства;
 *  - служебные метки (`lastBuildId`, `configVersion`, `dismissed*`);
 *  - любые поля, похожие на пароли, токены и ключи (на будущее);
 *  - при импорте ещё и пути к исполняемым файлам (`*Path`, кроме обычных
 *    данных) — их запуск идёт с правами администратора.
 *
 * Пароли раздачи и пульта (lan.json), настройки и подписки INCY, ключ автора
 * Hub (hub-author.bin) и ключ подписи ссылок лежат в отдельных файлах и в
 * профиль не попадают вовсе.
 */

const TOP_LEVEL_DROP = new Set(['deviceHwidSeed', 'lastBuildId', 'configVersion'])

/** Имя поля похоже на секрет. */
export function isSecretKey(key: string): boolean {
  if (key === 'pass' || /[a-z0-9_]Pass$/.test(key)) return true // proxyPass, socksPass (но не «bypass»)
  return /(secret|passw(or)?d|token$|api[-_]?key|private[-_]?key|auth[-_]?key|hwid)/i.test(key)
}

function isExecutablePathKey(key: string): boolean {
  return /(binary|bundle|exe|script|python)Path$/i.test(key)
}

function clean(o: unknown, depth: number, dropPaths: boolean): unknown {
  if (Array.isArray(o)) return o.map((v) => clean(v, depth + 1, dropPaths))
  if (!o || typeof o !== 'object') return o
  if (depth > 12) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (depth === 0 && (TOP_LEVEL_DROP.has(k) || /^dismissed/i.test(k))) continue
    if (/^dismissed/i.test(k)) continue
    if (isSecretKey(k)) continue
    if (dropPaths && isExecutablePathKey(k)) continue
    out[k] = clean(v, depth + 1, dropPaths)
  }
  return out
}

/** Конфиг для записи в профиль: без секретов и служебных меток. */
export function configForExport(config: unknown): Record<string, unknown> {
  const c = clean(config, 0, false)
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {}
}

/** Конфиг из чужого профиля: без секретов, меток и путей к программам. */
export function configForImport(config: unknown): Record<string, unknown> {
  const c = clean(config, 0, true)
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {}
}
