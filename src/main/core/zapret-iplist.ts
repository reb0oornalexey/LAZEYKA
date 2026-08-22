import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { zapretBundleDir, resourcesDir } from '../utils/dirs'

export interface CuratedIpSet {
  id: string
  name: string
  description: string
  cidrs: string[]
  /**
   * Сколько записей добавит набор.
   *
   * Для обычных наборов это просто длина `cidrs`. Авторский пак читается из
   * файла и `cidrs` у него пустой — иначе каждое открытие карточки гоняло бы
   * через IPC 125 тысяч строк ради подписи «сколько записей».
   */
  entryCount?: number
  /** Набор от автора приложения — выделяется в интерфейсе и идёт первым. */
  recommended?: boolean
  /** Содержимое лежит в файле, а не в массиве выше. */
  fileBacked?: boolean
  /**
   * Файл набора найден и прочитан.
   *
   * false означает «в этой сборке пака нет» — интерфейс показывает это прямо
   * и блокирует выбор, вместо того чтобы рисовать «0 записей» и делать вид,
   * что набор просто пустой.
   */
  available?: boolean
}

/**
 * Итог применения набора.
 *
 * Считаем отдельно добавленное и пропущенное, потому что главный вопрос
 * пользователя при добавлении пака — «а мои-то записи не затёрло и дубли не
 * налезли?». Одна цифра «всего в списке» на него не отвечает.
 */
export interface IpListApplyResult extends IpListSnapshot {
  /** Сколько записей реально появилось в файле. */
  added: number
  /** Сколько из выбранного уже было в списке и не записалось повторно. */
  skipped: number
  /** true, если список был перезаписан, а не дополнен. */
  replaced: boolean
}

export interface IpListSnapshot {
  total: number
  preview: string[]
  hasBackup: boolean
  filePath: string
}

export interface IpListPatch {
  setIds?: string[]
  customCidrs?: string[]
  replace?: boolean
}

// list-general-user.txt is Zapret's own dedicated file for user-added
// domains — separate from list-general.txt (the curated default list that
// Flowseal ships and replaces on every update). general.bat passes BOTH
// files to winws.exe as separate --hostlist arguments, and service.bat's
// own `load_user_lists` step creates list-general-user.txt (with a
// placeholder line) if it doesn't exist yet, but never touches it once
// created. Update archives never include this file at all (confirmed:
// it's absent from the release zip), so it survives every Zapret bundle
// update by construction — no merge/preserve logic needed on our side.
const IPV4_CIDR = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\/(?:[0-9]|[12]\d|3[0-2]))?$/
const IPV6_CIDR = /^(?:[A-Fa-f0-9:]+:+)+[A-Fa-f0-9]*(?:\/(?:1[0-1]\d|12[0-8]|\d{1,2}))?$/
// Hostname / FQDN: labels of [a-z0-9-], 1–63 chars, joined by dots,
// optionally with a leading wildcard (`*.example.com`). Total ≤253.
const HOSTNAME = /^\*?\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i

/** Идентификатор авторского пака — на него завязана загрузка из файла. */
export const AUTHOR_PACK_ID = 'author-full'

/**
 * Полный список хостов, собранный автором приложения.
 *
 * Лежит отдельным файлом в `resources/lists/`, а не в `resources/zapret/`:
 * бандл Zapret подменяется целиком при обновлении (и вообще может уехать в
 * runtime-каталог), а этот пак должен пережить любое такое обновление.
 */
function authorPackFile(): string {
  return path.join(resourcesDir(), 'lists', 'list-general-author.txt')
}

/**
 * Кеш пуст потому, что файла нет, или потому, что он и правда пустой?
 *
 * Разница важна для интерфейса: «0 записей» у рекомендованного набора выглядит
 * как сломанный пак, хотя на деле означает, что файл не доехал до сборки
 * (например, при обновлении только app.asar). Тогда честнее сказать прямо и
 * не давать его выбрать.
 */
export function isAuthorPackPresent(): boolean {
  return existsSync(authorPackFile())
}

/**
 * Записи авторского пака.
 *
 * Кешируется после первого чтения: файл на 2 МБ, разбирать его заново на
 * каждый клик незачем, а меняется он только вместе с обновлением приложения.
 */
let authorPackCache: string[] | null = null

export function readAuthorPack(): string[] {
  if (authorPackCache) return authorPackCache
  const file = authorPackFile()
  // Неудачу не кешируем: existsSync дешёвый, а запомнить «файла нет» на всю
  // сессию значит не заметить его, если он появится (например, после
  // обновления ресурсов рядом с работающим приложением).
  if (!existsSync(file)) return []
  try {
    authorPackCache = dedup(readLines(file).filter(isValidCidr))
  } catch {
    return []
  }
  return authorPackCache
}

export const CURATED_IP_SETS: CuratedIpSet[] = [
  {
    id: AUTHOR_PACK_ID,
    name: 'Полный пак от автора',
    description:
      'Собранный вручную список доменов: Discord, YouTube, Telegram, Twitch, Cloudflare, ' +
      'игровые сервисы, CDN и всё остальное, что обычно режут. Покрывает почти все ' +
      'наборы ниже сразу — если не знаете, что выбрать, берите его.',
    // Пусто намеренно: содержимое читается из файла, а `entryCount`
    // проставляет getCuratedIpSets по факту чтения.
    cidrs: [],
    recommended: true,
    fileBacked: true
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Основные домены Discord, их CDN и голосовых сервисов.',
    cidrs: [
      'discord.com',
      'discordapp.com',
      'discordapp.net',
      'discord.gg',
      'discord.gift',
      'discord.media',
      'discord.new',
      'discordcdn.com',
      'dis.gd',
      'discordstatus.com'
    ]
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Домены Telegram и вспомогательных сервисов.',
    cidrs: [
      'telegram.org',
      'telegram.me',
      't.me',
      'telesco.pe',
      'web.telegram.org',
      'core.telegram.org',
      'cdn-telegram.org',
      'tdesktop.com',
      'telegram-cdn.org'
    ]
  },
  {
    id: 'youtube',
    name: 'YouTube / Google',
    description: 'Домены YouTube и смежных сервисов Google.',
    cidrs: [
      'youtube.com',
      'youtu.be',
      'youtubekids.com',
      'youtube-nocookie.com',
      'yt.be',
      'ytimg.com',
      'ggpht.com',
      'googlevideo.com',
      'youtubei.googleapis.com',
      'i.ytimg.com',
      's.ytimg.com',
      'm.youtube.com'
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Ключевые домены Cloudflare (DNS, Workers, ECH, R2).',
    cidrs: [
      'cloudflare.com',
      'cloudflare-dns.com',
      'cloudflareinsights.com',
      'cloudflarestream.com',
      'cloudflareaccess.com',
      'cloudflare-ech.com',
      'workers.dev',
      'pages.dev',
      'r2.dev',
      'one.one.one.one'
    ]
  },
  {
    id: 'twitch',
    name: 'Twitch',
    description: 'Домены Twitch и их CDN.',
    cidrs: [
      'twitch.tv',
      'ttvnw.net',
      'jtvnw.net',
      'twitchcdn.net',
      'twitchsvc.net',
      'live-video.net',
      'helix.twitch.tv'
    ]
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Домены Spotify и смежных CDN.',
    cidrs: [
      'spotify.com',
      'spotifycdn.com',
      'scdn.co',
      'spoti.fi',
      'spotilocal.com',
      'pscdn.co',
      'audio-fa.scdn.co',
      'audio-ak.spotify.com'
    ]
  }
]

export function getCuratedIpSets(): CuratedIpSet[] {
  return CURATED_IP_SETS.map((s) => {
    // Файловые наборы уезжают в интерфейс без содержимого — только счётчик.
    // 125 тысяч строк через IPC на каждое открытие карточки не нужны никому.
    if (s.fileBacked) {
      const entries = readAuthorPack()
      return {
        ...s,
        cidrs: [],
        entryCount: entries.length,
        available: isAuthorPackPresent() && entries.length > 0
      }
    }
    return { ...s, cidrs: [...s.cidrs], entryCount: s.cidrs.length, available: true }
  })
}

function listFile(): string {
  return path.join(zapretBundleDir(), 'lists', 'list-general.txt')
}

function backupFile(): string {
  return path.join(zapretBundleDir(), 'lists', 'list-general.txt.backup')
}

function isValidCidr(line: string): boolean {
  const v = line.trim()
  if (!v) return false
  if (v.startsWith('#') || v.startsWith(';')) return false
  if (IPV4_CIDR.test(v) || IPV6_CIDR.test(v)) return true
  if (v.length > 253) return false
  return HOSTNAME.test(v)
}

function ensureBackup(): void {
  const src = listFile()
  const bak = backupFile()
  if (!existsSync(src)) return
  if (existsSync(bak) && safeSize(bak) > 0) return
  try { copyFileSync(src, bak) } catch { /* best-effort */ }
}

function readLines(file: string): string[] {
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf-8').split(/\r?\n/)
  } catch {
    return []
  }
}

function dedup(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const v = raw.trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function ensureDirOrThrow(): void {
  const dir = path.dirname(listFile())
  if (!existsSync(dir)) {
    throw new Error(`zapret-bundle отсутствует: нет ${dir}. Установите/обновите Zapret.`)
  }
}

export function getIpListSnapshot(): IpListSnapshot {
  const file = listFile()
  const lines = dedup(readLines(file).filter(isValidCidr))
  return {
    total: lines.length,
    preview: lines.slice(0, 25),
    hasBackup: existsSync(backupFile()) && safeSize(backupFile()) > 0,
    filePath: file
  }
}

function safeSize(file: string): number {
  try { return statSync(file).size } catch { return 0 }
}

/**
 * Apply a patch to list-general.txt:
 *  - replace=true → wipe the file first
 *  - then merge in entries from selected curated sets + custom user lines
 *
 * Accepts hostnames, IPv4/IPv6 addresses, and CIDR ranges. Invalid lines
 * are silently dropped; duplicates collapsed. The original Flowseal
 * hostlist is backed up to list-general.txt.backup on first edit so
 * the user can restore it.
 */
export function applyIpListPatch(patch: IpListPatch): IpListApplyResult {
  ensureDirOrThrow()
  ensureBackup()
  const file = listFile()

  const existing = patch.replace ? [] : dedup(readLines(file).filter(isValidCidr))

  const fromSets: string[] = []
  if (patch.setIds && patch.setIds.length) {
    const byId = new Map(CURATED_IP_SETS.map((s) => [s.id, s]))
    for (const id of patch.setIds) {
      const s = byId.get(id)
      if (!s) continue
      // Авторский пак живёт в файле — его содержимое подтягивается здесь, а не
      // передаётся из интерфейса.
      //
      // Копируем циклом, а НЕ через `push(...array)`: спред разворачивает
      // массив в аргументы вызова, а их число ограничено размером стека —
      // на 125 тысячах записей это падало с «Maximum call stack size
      // exceeded». Здесь размер набора ничем не ограничен по определению,
      // поэтому поэлементное добавление тут единственный корректный способ.
      const source = s.fileBacked ? readAuthorPack() : s.cidrs
      for (const entry of source) fromSets.push(entry)
    }
  }

  const fromCustom = (patch.customCidrs ?? [])
    .flatMap((s) => s.split(/[\s,;]+/))
    .map((s) => s.trim())
    .filter(isValidCidr)

  // Порядок важен: существующие записи идут первыми, и dedup оставляет первое
  // вхождение — значит собственный список пользователя не переезжает в конец
  // файла и не теряется, к нему просто дописывается недостающее.
  //
  // Спред в литерале массива (в отличие от спреда в аргументах вызова) идёт
  // через итератор и на больших массивах безопасен.
  const merged = dedup([...existing, ...fromSets, ...fromCustom])
  writeAtomic(file, merged.join('\r\n') + (merged.length ? '\r\n' : ''))

  const incomingUnique = dedup([...fromSets, ...fromCustom]).length
  const added = merged.length - existing.length
  return {
    ...getIpListSnapshot(),
    added,
    // Всё выбранное, что не увеличило список, — это дубли: либо уже лежало в
    // файле, либо встретилось в двух выбранных наборах сразу.
    skipped: Math.max(0, incomingUnique - added),
    replaced: Boolean(patch.replace)
  }
}

export function clearIpList(): IpListSnapshot {
  ensureDirOrThrow()
  ensureBackup()
  writeAtomic(listFile(), '')
  return getIpListSnapshot()
}

/**
 * Restore list-general.txt from a backup. The first time the user edits
 * the file we copy the original Flowseal hostlist to .backup; restore
 * just copies it back.
 */
export function restoreIpListBackup(): IpListSnapshot {
  ensureDirOrThrow()
  const src = backupFile()
  if (!existsSync(src)) {
    throw new Error('Backup-файл list-general.txt.backup ещё не создан (вы ни разу не правили список).')
  }
  copyFileSync(src, listFile())
  return getIpListSnapshot()
}

function writeAtomic(file: string, content: string): void {
  // list-general.txt is loaded once when winws.exe starts; live mid-write
  // races aren't a real concern. A direct write is fine and avoids the
  // Windows rename-over-existing-file caveat entirely.
  writeFileSync(file, content, 'utf-8')
}
