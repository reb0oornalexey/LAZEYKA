import { installZapretBundle } from './zapret'
import { getAppConfig, patchAppConfig } from '../config'
import { loadUpdateCache, saveUpdateCache } from '../utils/update-cache'
import { fetchLatestGithubRelease, type GhRelease } from '../utils/github-release'

const REPO = 'Flowseal/zapret-discord-youtube'
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

export interface ZapretUpdateInfo {
  installed?: string
  latest?: string
  hasUpdate: boolean
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  publishedAt?: string
  // True when the current `latest` tag matches the one the user previously
  // dismissed via "Later". UI uses this to keep the banner hidden until
  // upstream ships a fresher tag.
  dismissed?: boolean
}

// Lightweight numeric-aware version compare. Handles "1.7.7" vs "v1.7.10"
// correctly (would fail with plain string compare). Non-numeric segments
// fall back to lexical compare so things like "1.7.7-beta" sort sanely.
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

// 12-hour cache, persisted to disk via update-cache helper so the very
let cache: { at: number; data: ZapretUpdateInfo } | null = null
let cacheHydrated = false
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_NAME = 'zapret'

function hydrateCacheFromDisk(): void {
  if (cacheHydrated) return
  cacheHydrated = true
  const persisted = loadUpdateCache<ZapretUpdateInfo>(CACHE_NAME)
  if (persisted) cache = persisted
}

let refreshInflight = false
function backgroundRefresh(): void {
  if (refreshInflight) return
  refreshInflight = true
  checkZapretUpdate(true)
    .catch(() => void 0)
    .finally(() => {
      refreshInflight = false
    })
}

/**
 * Version currently installed into runtime/zapret, or `undefined` when the
 * user has never installed an update and is still running the bundle that
 * shipped inside the installer.
 */
function installedVersion(cfgInstalled?: string): string | undefined {
  const v = cfgInstalled?.trim()
  return v ? v : undefined
}

/** Baseline used for comparison — an unknown install is older than anything. */
function compareBaseline(installed?: string): string {
  return installed ?? '0.0.0'
}

export async function checkZapretUpdate(force = false): Promise<ZapretUpdateInfo> {
  hydrateCacheFromDisk()
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    // Re-attach live values that may have changed since the cached call.
    const cfg = await getAppConfig()
    const installedNow = installedVersion(cfg.zapret?.installedVersion)
    if (Date.now() - cache.at > 60 * 60 * 1000) backgroundRefresh()
    return {
      ...cache.data,
      installed: installedNow,
      hasUpdate:
        !!cache.data.latest &&
        compareVersion(cache.data.latest, compareBaseline(installedNow)) > 0,
      dismissed: cfg.zapret?.dismissedUpdateTag === cache.data.latest
    }
  }

  const cfg = await getAppConfig()
  const installed = installedVersion(cfg.zapret?.installedVersion)
  const dismissedTag = cfg.zapret?.dismissedUpdateTag

  let release: GhRelease
  try {
    release = await fetchLatestGithubRelease(REPO)
  } catch (e) {
    // Network/rate-limit failures are non-fatal — UI just stays quiet.
    throw new Error(`Не удалось проверить обновления: ${e instanceof Error ? e.message : String(e)}`)
  }

  const latestRaw = release.tag_name ?? release.name ?? ''
  const latest = latestRaw.replace(/^v/i, '').trim() || undefined
  const tag = release.tag_name || (latest ? `v${latest}` : '')
  const cleanTag = latest || tag.replace(/^v/i, '')

  const assets = release.assets ?? []
  // Prefer the canonical "zapret-discord-youtube-*.zip" asset, fall back
  // to any .zip if the maintainer renamed it.
  const zipAsset =
    assets.find((a) => /^zapret-discord-youtube.*\.zip$/i.test(a.name)) ??
    assets.find((a) => /\.zip$/i.test(a.name))

  const assetDownloadUrl =
    zipAsset?.browser_download_url ??
    (tag ? `https://github.com/${REPO}/releases/download/${tag}/zapret-discord-youtube-${cleanTag}.zip` : undefined)

  const hasUpdate = !!latest && compareVersion(latest, compareBaseline(installed)) > 0

  const info: ZapretUpdateInfo = {
    installed,
    latest,
    hasUpdate,
    assetName: zipAsset?.name ?? `zapret-discord-youtube-${cleanTag}.zip`,
    assetUrl: assetDownloadUrl,
    assetSize: zipAsset?.size,
    releaseUrl: release.html_url ?? (tag ? `https://github.com/${REPO}/releases/tag/${tag}` : undefined),
    publishedAt: release.published_at,
    dismissed: !!latest && dismissedTag === latest
  }

  cache = { at: Date.now(), data: info }
  saveUpdateCache(CACHE_NAME, info)
  return info
}

export async function installZapretUpdate(
  assetUrl: string,
  expectedVersion?: string
): Promise<{ strategies: number; installedVersion?: string }> {
  if (!assetUrl) throw new Error('Пустая ссылка на архив')

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    buf = Buffer.from(ab)
  } catch (e) {
    throw new Error(`Не удалось скачать архив: ${e instanceof Error ? e.message : String(e)}`)
  }

  const result = await installZapretBundle(new Uint8Array(buf))

  const finalVersion =
    result.installedVersion ?? expectedVersion ?? undefined
  const cfg = await getAppConfig()
  const next: ZapretConfig = {
    ...(cfg.zapret as ZapretConfig),
    installedVersion: finalVersion ?? cfg.zapret?.installedVersion,
    dismissedUpdateTag: undefined
  }
  await patchAppConfig({ zapret: next })

  // Invalidate cache so a follow-up check reflects "up to date".
  cache = null
  // Surface the persisted version in the result so the renderer can reflect
  // the new state without an extra round-trip.
  return { strategies: result.strategies, installedVersion: finalVersion }
}

export async function dismissZapretUpdate(tag: string): Promise<void> {
  if (!tag) return
  const cfg = await getAppConfig()
  const next: ZapretConfig = {
    ...(cfg.zapret as ZapretConfig),
    dismissedUpdateTag: tag
  }
  await patchAppConfig({ zapret: next })
  if (cache) cache.data.dismissed = cache.data.latest === tag
}
