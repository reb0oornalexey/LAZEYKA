/**
 * Auto-updater for the RoscomVPN geo databases.
 *
 * ## What these files are
 *
 * `geoip.dat` and `geosite.dat` are compiled lookup tables that Xray loads at
 * startup. They let a routing rule say `geoip:direct` or `geosite:category-ru`
 * instead of listing thousands of subnets and domains by hand — which is
 * exactly what `split-tunneling.ts` tries to do with its ~100 hand-written
 * entries.
 *
 * The RoscomVPN builds are curated for RU/BY specifically:
 *
 *  - `geoip:direct`    — RU/BY subnets from three independent geo databases
 *                        (GeoLite2, IPinfo, DB-IP), plus VK/Yandex/CDNVideo
 *                        ranges, **minus** RKN-blocked lists and the Russian
 *                        assets of foreign CDNs. That subtraction is the whole
 *                        point: a blocked service hosted on a Russian CDN edge
 *                        must still go through the tunnel.
 *  - `geosite:category-ru`, `steam`, `apple`, `microsoft`, `faceit` … — direct
 *  - `geosite:youtube`, `telegram`, `github`, `google-play` — forced through
 *                        the proxy
 *  - `geosite:win-spy`, `category-ads`, `torrent` — blocked
 *
 * ## How the update works
 *
 * Both repositories publish a GitHub release whose **tag is a timestamp**
 * (`202606020803` = 2026-06-02 08:03). geoip rebuilds daily at 03:10 UTC,
 * geosite on every push to master. Because the tag is a zero-padded numeric
 * string, "is there something newer" is a plain string comparison — no semver
 * parsing needed.
 *
 * Downloads try GitHub Releases first and fall back to the jsDelivr CDN, which
 * matters here: GitHub is frequently throttled or blocked on Russian ISPs, and
 * this app's whole audience is behind exactly that. The last installed tag per
 * repository is remembered on disk so a check costs one small API call.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { incyRuntimeDir, dataDir, xrayAssetsDir } from '../utils/dirs'

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

/** A compiled geo database tracked by this updater. */
interface GeoSource {
  id: 'geoip' | 'geosite'
  fileName: string
  repo: string
  /** Primary download — GitHub release asset. */
  releaseUrl: string
  /** Mirror that usually survives when GitHub does not. */
  cdnUrl: string
  /** Smallest plausible size; anything under this is a truncated download. */
  minBytes: number
}

const GEO_SOURCES: GeoSource[] = [
  {
    id: 'geoip',
    fileName: 'geoip.dat',
    repo: 'hydraponique/roscomvpn-geoip',
    releaseUrl:
      'https://github.com/hydraponique/roscomvpn-geoip/releases/latest/download/geoip.dat',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-geoip/release/geoip.dat',
    minBytes: 64 * 1024
  },
  {
    id: 'geosite',
    fileName: 'geosite.dat',
    repo: 'hydraponique/roscomvpn-geosite',
    releaseUrl:
      'https://github.com/hydraponique/roscomvpn-geosite/releases/latest/download/geosite.dat',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/hydraponique/roscomvpn-geosite/release/geosite.dat',
    minBytes: 64 * 1024
  }
]

export interface GeoDbState {
  id: 'geoip' | 'geosite'
  fileName: string
  /** Release tag currently on disk, or undefined when never updated. */
  installedTag?: string
  /** Newest tag upstream, filled in by `checkGeoUpdate`. */
  latestTag?: string
  hasUpdate: boolean
  /** True when the file exists in runtime/ or resources/. */
  present: boolean
  sizeBytes?: number
  checkedAt?: number
}

export interface GeoUpdateInfo {
  databases: GeoDbState[]
  hasUpdate: boolean
  /** True when neither file exists anywhere — routing rules would be inert. */
  missing: boolean
}

function stateFile(): string {
  return path.join(dataDir(), 'incy-geo-state.json')
}

function loadState(): Record<string, string> {
  try {
    const p = stateFile()
    if (!existsSync(p)) return {}
    const parsed = JSON.parse(readFileSync(p, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveState(next: Record<string, string>): void {
  try {
    writeFileSync(stateFile(), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    /* best effort — a lost tag only costs one redundant download */
  }
}

/** Where a geo file lives right now (runtime wins over the bundled copy). */
function resolveGeoPath(fileName: string): string | null {
  const runtime = path.join(incyRuntimeDir(), fileName)
  if (existsSync(runtime)) return runtime
  const bundled = path.join(xrayAssetsDir(), fileName)
  return existsSync(bundled) ? bundled : null
}

function fileSize(p: string | null): number | undefined {
  if (!p) return undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { statSync } = require('node:fs') as typeof import('node:fs')
    return statSync(p).size
  } catch {
    return undefined
  }
}

/** Latest release tag for a repo, or undefined when the API is unreachable. */
async function fetchLatestTag(repo: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: REQUEST_HEADERS
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { tag_name?: string }
    return json.tag_name?.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Compare two timestamp tags (`202606020803`). Falls back to a plain string
 * comparison for anything that is not purely numeric, which is still correct
 * for this publisher's format and never throws.
 */
function isNewer(latest: string | undefined, installed: string | undefined): boolean {
  if (!latest) return false
  if (!installed) return true
  const a = latest.replace(/\D/g, '')
  const b = installed.replace(/\D/g, '')
  if (a && b && a.length === b.length) return a > b
  return latest !== installed
}

export async function checkGeoUpdate(): Promise<GeoUpdateInfo> {
  const state = loadState()
  const databases: GeoDbState[] = []

  for (const src of GEO_SOURCES) {
    const latestTag = await fetchLatestTag(src.repo)
    const installedTag = state[src.id]
    const filePath = resolveGeoPath(src.fileName)
    const present = filePath !== null
    databases.push({
      id: src.id,
      fileName: src.fileName,
      installedTag,
      latestTag,
      // A file that is missing entirely always counts as an update, otherwise
      // a fresh install with no bundled .dat would never fetch one.
      hasUpdate: !present || isNewer(latestTag, installedTag),
      present,
      sizeBytes: fileSize(filePath),
      checkedAt: Date.now()
    })
  }

  return {
    databases,
    hasUpdate: databases.some((d) => d.hasUpdate),
    missing: databases.every((d) => !d.present)
  }
}

async function downloadTo(url: string, dest: string, minBytes: number): Promise<number> {
  const res = await fetch(url, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < minBytes) {
    throw new Error(`файл подозрительно мал (${buf.length} байт)`)
  }
  // Write to a temp name and rename, so an interrupted download can never
  // leave Xray pointed at a half-written database.
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, buf)
  try {
    if (existsSync(dest)) unlinkSync(dest)
  } catch {
    /* the rename below will surface any real problem */
  }
  renameSync(tmp, dest)
  return buf.length
}

export interface GeoInstallResult {
  updated: { fileName: string; sizeBytes: number; tag?: string }[]
  failed: { fileName: string; error: string }[]
}

/**
 * Download both databases into runtime/incy. Each file is attempted from
 * GitHub first, then jsDelivr; a failure on one database never aborts the
 * other, so a partial outage still refreshes what it can.
 */
export async function installGeoUpdate(): Promise<GeoInstallResult> {
  const dir = incyRuntimeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const state = loadState()
  const updated: GeoInstallResult['updated'] = []
  const failed: GeoInstallResult['failed'] = []

  for (const src of GEO_SOURCES) {
    const dest = path.join(dir, src.fileName)
    let size: number | null = null
    let lastError = ''

    for (const url of [src.releaseUrl, src.cdnUrl]) {
      try {
        size = await downloadTo(url, dest, src.minBytes)
        break
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    if (size === null) {
      failed.push({ fileName: src.fileName, error: lastError || 'неизвестная ошибка' })
      continue
    }

    const tag = await fetchLatestTag(src.repo)
    if (tag) state[src.id] = tag
    updated.push({ fileName: src.fileName, sizeBytes: size, tag })
  }

  saveState(state)
  return { updated, failed }
}

/**
 * True only when **RoscomVPN's** databases are installed — not merely when
 * some geoip.dat exists.
 *
 * This distinction is load-bearing. Categories like `geoip:direct`,
 * `geosite:category-ru` and `geosite:win-spy` exist only in the RoscomVPN
 * builds; the official Xray databases have no such entries. Xray refuses to
 * start when a routing rule references a category it cannot resolve, so
 * emitting those rules against the stock files would take the whole tunnel
 * down with a cryptic parse error.
 *
 * Presence of a recorded release tag is the proof: only `installGeoUpdate`
 * writes it, and only after a successful download from those repositories.
 */
export function areGeoDatabasesReady(): boolean {
  const state = loadState()
  return GEO_SOURCES.every(
    (s) => Boolean(state[s.id]) && resolveGeoPath(s.fileName) !== null
  )
}
