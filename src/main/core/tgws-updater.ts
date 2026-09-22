import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { tgwsRuntimeDir, resourcesDir } from '../utils/dirs'
import { getAppConfig, patchAppConfig } from '../config'
import { loadUpdateCache, saveUpdateCache } from '../utils/update-cache'
import { stopTgws, getTgwsStatus } from './tgws'

import { fetchLatestGithubRelease, type GhRelease } from '../utils/github-release'

const REPO = 'Flowseal/tg-ws-proxy'
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

export interface TgwsUpdateInfo {
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

function compareVersion(a: string, b: string): number {
  const norm = (v: string): (number | string)[] =>
    v
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p))
  const aa = norm(a)
  const bb = norm(b)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i++) {
    const av = aa[i] ?? 0
    const bv = bb[i] ?? 0
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av > bv) return 1
      if (av < bv) return -1
    } else {
      const as = String(av)
      const bs = String(bv)
      if (as > bs) return 1
      if (as < bs) return -1
    }
  }
  return 0
}

let cache: { at: number; data: TgwsUpdateInfo } | null = null
let cacheHydrated = false
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_NAME = 'tgws'

function hydrateCacheFromDisk(): void {
  if (cacheHydrated) return
  cacheHydrated = true
  const persisted = loadUpdateCache<TgwsUpdateInfo>(CACHE_NAME)
  if (persisted) cache = persisted
}

let refreshInflight = false
function backgroundRefresh(): void {
  if (refreshInflight) return
  refreshInflight = true
  checkTgwsUpdate(true)
    .catch(() => void 0)
    .finally(() => {
      refreshInflight = false
    })
}

/**
 * Version currently installed into runtime/tgws, or `undefined` when the user
 * has never installed an update and is still running the binary that shipped
 * inside the installer.
 */
function installedVersion(cfgInstalled?: string): string | undefined {
  const v = cfgInstalled?.trim()
  return v ? v : undefined
}

/** Baseline used for comparison — an unknown install is older than anything. */
function compareBaseline(installed?: string): string {
  return installed ?? '0.0.0'
}

export async function checkTgwsUpdate(force = false): Promise<TgwsUpdateInfo> {
  hydrateCacheFromDisk()
  const cfg = await getAppConfig()
  const installed = installedVersion(cfg.tgws?.installedVersion)
  const dismissedTag = cfg.tgws?.dismissedUpdateTag

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS && cache.data.latest) {
    if (Date.now() - cache.at > 60 * 60 * 1000) backgroundRefresh()
    return {
      ...cache.data,
      installed,
      hasUpdate: compareVersion(cache.data.latest, compareBaseline(installed)) > 0,
      dismissed: dismissedTag === cache.data.latest
    }
  }

  let release: GhRelease
  try {
    release = await fetchLatestGithubRelease(REPO)
  } catch (e) {
    throw new Error(`Не удалось проверить обновления TgWsProxy: ${e instanceof Error ? e.message : String(e)}`)
  }

  const latestRaw = release.tag_name ?? release.name ?? ''
  const latest = latestRaw.replace(/^v/i, '').trim() || undefined
  const tag = release.tag_name || (latest ? `v${latest}` : '')

  // Strict 64-bit Windows binary match: prioritize official TgWsProxy_windows.exe
  const assets = release.assets ?? []
  const winAsset =
    assets.find((a) => a.name === 'TgWsProxy_windows.exe') ??
    assets.find((a) => /^TgWsProxy_windows\.exe$/i.test(a.name)) ??
    assets.find((a) => /^TgWsProxy_windows.*\.exe$/i.test(a.name) && !/32bit|7_|arm64/i.test(a.name))

  const assetDownloadUrl =
    winAsset?.browser_download_url ??
    (tag ? `https://github.com/${REPO}/releases/download/${tag}/TgWsProxy_windows.exe` : undefined)

  const hasUpdate = latest ? compareVersion(latest, compareBaseline(installed)) > 0 : false

  const info: TgwsUpdateInfo = {
    installed,
    latest,
    hasUpdate,
    assetName: winAsset?.name ?? 'TgWsProxy_windows.exe',
    assetUrl: assetDownloadUrl,
    assetSize: winAsset?.size,
    releaseUrl: release.html_url ?? (tag ? `https://github.com/${REPO}/releases/tag/${tag}` : undefined),
    publishedAt: release.published_at,
    dismissed: dismissedTag === latest
  }

  cache = { at: Date.now(), data: info }
  saveUpdateCache(CACHE_NAME, info)
  return info
}

// Best-effort kill of any leftover TgWsProxy* processes so we can cleanly
// overwrite/manage files without Windows file locking errors.
async function killStaleTgwsBinary(): Promise<void> {
  if (process.platform !== 'win32') return
  await new Promise<void>((resolve) => {
    const p = spawn('taskkill.exe', ['/F', '/IM', 'TgWsProxy*', '/T'], {
      windowsHide: true
    })
    p.on('exit', () => resolve())
    p.on('error', () => resolve())
  })
  await new Promise((r) => setTimeout(r, 400))
}

export async function installTgwsUpdate(
  assetUrl: string,
  expectedVersion?: string
): Promise<{ installedVersion?: string; sizeBytes: number }> {
  if (!assetUrl) throw new Error('Пустая ссылка на бинарник')

  // Stop the currently-running tgws first
  const st = getTgwsStatus()
  if (st.state === 'running' || st.state === 'starting') {
    try { await stopTgws() } catch { /* best-effort */ }
  }
  await killStaleTgwsBinary()

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    buf = Buffer.from(ab)
  } catch (e) {
    throw new Error(`Не удалось скачать TgWsProxy: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (buf.length < 1024 * 1024) {
    throw new Error(`Загруженный файл слишком маленький (${buf.length} байт)`)
  }

  // Validate PE header in-memory without spawning process
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error('Файл не является исполняемым файлом Windows (нет сигнатуры MZ)')
  }
  const peOffset = buf.readUInt32LE(0x3c)
  if (buf.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0') {
    throw new Error('Повреждённый PE-заголовок файла')
  }
  const machine = buf.readUInt16LE(peOffset + 4)
  if (machine !== 0x8664) {
    throw new Error('Несовместимая архитектура (требуется x64)')
  }

  const dir = tgwsRuntimeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const dest = path.join(dir, 'TgWsProxy_windows.exe')
  try {
    if (existsSync(dest)) unlinkSync(dest)
  } catch {
    await killStaleTgwsBinary()
    try { if (existsSync(dest)) unlinkSync(dest) } catch { /* ok */ }
  }

  writeFileSync(dest, buf)

  // Also update bundled binary if writable in development
  try {
    const bundled = path.join(resourcesDir(), 'tgws', 'TgWsProxy_windows.exe')
    writeFileSync(bundled, buf)
  } catch { /* ok in production */ }

  // Persist version + clear "Later" dismissal.
  const finalVersion = expectedVersion || undefined
  const cfg = await getAppConfig()
  const next: TgwsConfig = {
    ...(cfg.tgws as TgwsConfig),
    installedVersion: finalVersion ?? cfg.tgws?.installedVersion,
    dismissedUpdateTag: undefined
  }
  await patchAppConfig({ tgws: next })

  cache = null
  return { installedVersion: finalVersion, sizeBytes: buf.length }
}

export async function dismissTgwsUpdate(tag: string): Promise<void> {
  if (!tag) return
  const cfg = await getAppConfig()
  const next: TgwsConfig = {
    ...(cfg.tgws as TgwsConfig),
    dismissedUpdateTag: tag
  }
  await patchAppConfig({ tgws: next })
  if (cache) cache.data.dismissed = cache.data.latest === tag
}
