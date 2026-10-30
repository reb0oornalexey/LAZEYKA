/**
 * macOS: обновление Zapret из релизов Flowseal/zapret-mac-discord-youtube
 * (ZapretMac-macOS-universal.zip). Windows-обновление (zapret-updater.ts) не затрагивается.
 *
 * Скачанное распаковывается во временную папку пользователя, проверяется (сумма из
 * GitHub, Mach-O движок) и ставится в службу через системное окно пароля: без
 * пароля любой процесс пользователя мог бы подменить бинарник, который работает от root.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { getAppConfig } from '../config'
import { fetchLatestGithubRelease, type GhRelease } from '../utils/github-release'
import {
  bundledPayloadVersion,
  installZapretMacService,
  installedPayloadVersion,
  makeUpdateTempDir,
  scanPayload
} from './zapret-mac-service'
import { afterZapretMacInstall } from './zapret-mac'
import { getZapretStatus, startZapret, stopZapret } from './zapret'

export const ZAPRET_MAC_REPO = 'Flowseal/zapret-mac-discord-youtube'
export const ZAPRET_MAC_ASSET = 'ZapretMac-macOS-universal.zip'
const DOWNLOAD_PREFIX = `https://github.com/${ZAPRET_MAC_REPO}/releases/download/`
const PAYLOAD_PREFIX = 'ZapretMac.app/Contents/Resources/Payload/'
const KEEP = [
  /^bin\/[A-Za-z0-9._-]+$/,
  /^strategies\/general[a-z0-9-]*\.conf\.in$/,
  /^default-lists\/[a-z0-9-]+\.txt$/,
  /^strategies\.tsv$/,
  /^ipset-(any|none)\.txt$/
]

export interface MacUpdateInfo {
  installed?: string
  latest?: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  publishedAt?: string
  dismissed?: boolean
}

function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Установленная версия: из службы, а пока её нет — встроенная в приложение. */
export function currentMacVersion(): string | undefined {
  return installedPayloadVersion() ?? bundledPayloadVersion()
}

let cache: { at: number; data: MacUpdateInfo } | null = null
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

export async function checkMacUpdate(force = false): Promise<MacUpdateInfo> {
  const cfg = await getAppConfig()
  const installed = currentMacVersion()
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    const d = cache.data
    return {
      ...d,
      installed,
      hasUpdate: !!d.latest && cmp(d.latest, installed ?? '0.0.0') > 0,
      dismissed: cfg.zapret?.dismissedUpdateTag === d.latest
    }
  }
  let release: GhRelease
  try {
    release = await fetchLatestGithubRelease(ZAPRET_MAC_REPO)
  } catch (e) {
    throw new Error(`Не удалось проверить обновления: ${e instanceof Error ? e.message : String(e)}`)
  }
  const tag = release.tag_name ?? release.name ?? ''
  const latest = tag.replace(/^v/i, '').trim() || undefined
  const asset = (release.assets ?? []).find((a) => a.name === ZAPRET_MAC_ASSET)
  const data: MacUpdateInfo = {
    installed,
    latest,
    // Без нужного архива в релизе обновлять нечем.
    hasUpdate: !!latest && !!asset && cmp(latest, installed ?? '0.0.0') > 0,
    assetName: ZAPRET_MAC_ASSET,
    assetUrl: asset?.browser_download_url ?? (tag ? `${DOWNLOAD_PREFIX}${tag}/${ZAPRET_MAC_ASSET}` : undefined),
    assetSize: asset?.size,
    releaseUrl: release.html_url ?? (tag ? `https://github.com/${ZAPRET_MAC_REPO}/releases/tag/${tag}` : undefined),
    publishedAt: release.published_at,
    dismissed: !!latest && cfg.zapret?.dismissedUpdateTag === latest
  }
  cache = { at: Date.now(), data }
  return data
}

export function resetMacUpdateCache(): void {
  cache = null
}

/** Сумма файла из API GitHub (поле digest), если релиз её отдаёт; нет — null. */
async function expectedDigest(tag: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${ZAPRET_MAC_REPO}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { 'User-Agent': 'LAZEYKA-Updater', Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return null
    const rel = (await res.json()) as GhRelease
    const m = /^sha256:([0-9a-f]{64})$/i.exec(rel.assets?.find((a) => a.name === ZAPRET_MAC_ASSET)?.digest ?? '')
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

/** Распаковать Payload из архива релиза в новую пустую папку (только белый список файлов). */
function extractPayload(zipBytes: Buffer, destDir: string, version: string): void {
  const zip = new AdmZip(zipBytes)
  let n = 0
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(PAYLOAD_PREFIX)) continue
    const rel = e.entryName.slice(PAYLOAD_PREFIX.length)
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\') || !KEEP.some((re) => re.test(rel))) continue
    const out = path.join(destDir, ...rel.split('/'))
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, e.getData())
    chmodSync(out, rel === 'bin/utunws' ? 0o755 : 0o644)
    n++
  }
  if (n === 0) throw new Error('Архив не похож на сборку Zapret для macOS')
  writeFileSync(path.join(destDir, 'VERSION'), `${version}\n`)
}

export async function installMacUpdate(
  assetUrl: string,
  _expectedVersion?: string
): Promise<{ strategies: number; installedVersion?: string }> {
  // Ссылка уходит в установку от root — принимаем только архив нужного релиза нашего репозитория.
  const m = /^https:\/\/github\.com\/Flowseal\/zapret-mac-discord-youtube\/releases\/download\/([^/]+)\/ZapretMac-macOS-universal\.zip$/.exec(
    assetUrl
  )
  if (!m) throw new Error('Ссылка не ведёт на релиз Zapret для macOS')
  const tag = decodeURIComponent(m[1])
  const version = tag.replace(/^v/i, '')

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, { headers: { 'User-Agent': 'LAZEYKA-Updater' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    throw new Error(`Не удалось скачать архив: ${e instanceof Error ? e.message : String(e)}`)
  }
  const digest = await expectedDigest(tag)
  if (digest && createHash('sha256').update(buf).digest('hex') !== digest) {
    throw new Error('Контрольная сумма архива не совпала — обновление отменено')
  }

  // Перед заменой файлов службу останавливаем (установка всё равно её остановит), потом поднимаем снова.
  const wasRunning = getZapretStatus().state === 'running' || getZapretStatus().state === 'starting'
  if (wasRunning) await stopZapret().catch(() => void 0)

  const tmp = makeUpdateTempDir()
  try {
    const payloadDir = path.join(tmp, 'payload')
    mkdirSync(payloadDir, { recursive: true })
    extractPayload(buf, payloadDir, version)
    const scan = scanPayload(payloadDir) // обязательные файлы и Mach-O движок
    const res = await installZapretMacService({ sourceDir: payloadDir, version })
    if (!res.ok) throw new Error(res.cancelled ? 'Установка отменена' : res.message)
    await afterZapretMacInstall()
    resetMacUpdateCache()
    if (wasRunning) startZapret().catch(() => void 0)
    return { strategies: scan.files.filter((f) => f.rel.startsWith('strategies/')).length, installedVersion: version }
  } catch (e) {
    // Не вышло — возвращаем Zapret в прежнее состояние.
    if (wasRunning) startZapret().catch(() => void 0)
    throw e
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

