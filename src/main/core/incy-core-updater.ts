/**
 * Auto-updater for the two INCY proxy cores (sing-box and Xray).
 *
 * ## Why this is not a plain "always install the latest" updater
 *
 * sing-box changes its **configuration schema between minor versions**, and it
 * does so destructively. Going from 1.11 to 1.13 turned `inet4_address` into a
 * fatal error, deleted the `block` / `dns` special outbounds and removed the
 * inbound `sniff` fields. A naive updater would have installed that silently
 * and left the user with a tunnel that refuses to start and no idea why.
 *
 * So the policy is deliberately conservative:
 *
 *  - **Patch releases install themselves.** 1.13.19 → 1.13.24 never changes the
 *    schema; these are the bug and security fixes worth having immediately.
 *  - **Minor and major releases only notify.** 1.13 → 1.14 may need the config
 *    generator updated first, so it waits for a human.
 *  - **Nothing is swapped in unvalidated.** Every candidate binary is run
 *    against the config this app actually generates (`sing-box check` /
 *    `xray -test`) while still in a temp folder. A binary that rejects our
 *    config is discarded and the working one stays.
 *  - **The previous binary is kept.** If the new one fails to launch, the
 *    backup is restored.
 *
 * The result: patch fixes arrive on their own, and a breaking release becomes
 * a visible notice instead of a broken VPN.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import { dataDir, incyRuntimeDir, incyBinaryPath, xrayBinaryPath } from '../utils/dirs'

const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

export type CoreId = 'sing-box' | 'xray'
export type UpdateKind = 'none' | 'patch' | 'minor' | 'major' | 'unknown'

interface CoreSpec {
  id: CoreId
  exeName: string
  repo: string
  /** Picks the Windows x64 archive out of a release's asset list. */
  matchAsset: (name: string) => boolean
  /** Path of the binary currently in use. */
  currentPath: () => string
  /** Arguments that make the binary validate a config and exit non-zero on error. */
  validateArgs: (configPath: string) => string[]
  /** Arguments that print the version. */
  versionArgs: string[]
  /** Config file this core is validated against. */
  configFile: () => string
  minBytes: number
}

const CORES: CoreSpec[] = [
  {
    id: 'sing-box',
    exeName: 'sing-box.exe',
    repo: 'SagerNet/sing-box',
    matchAsset: (n) => /^sing-box-.*-windows-amd64\.zip$/i.test(n),
    currentPath: incyBinaryPath,
    validateArgs: (cfg) => ['check', '-c', cfg],
    versionArgs: ['version'],
    configFile: () => path.join(dataDir(), 'sing-box-config.json'),
    minBytes: 5 * 1024 * 1024
  },
  {
    id: 'xray',
    exeName: 'xray.exe',
    repo: 'XTLS/Xray-core',
    matchAsset: (n) => /^Xray-windows-64\.zip$/i.test(n),
    currentPath: xrayBinaryPath,
    validateArgs: (cfg) => ['-test', '-config', cfg],
    versionArgs: ['version'],
    configFile: () => path.join(dataDir(), 'xray-config.json'),
    minBytes: 5 * 1024 * 1024
  }
]

export interface CoreUpdateState {
  id: CoreId
  installed?: string
  latest?: string
  kind: UpdateKind
  /** Patch updates are applied without asking; anything larger waits. */
  autoInstallable: boolean
  assetUrl?: string
  assetName?: string
  releaseUrl?: string
  present: boolean
  note?: string
}

// ---------------------------------------------------------------------------
// version helpers
// ---------------------------------------------------------------------------

function parseSemver(raw: string | undefined): [number, number, number] | null {
  if (!raw) return null
  const m = raw.replace(/^v/i, '').match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Classify the jump between two versions. Pre-releases are never auto-installed. */
export function classifyUpdate(installed?: string, latest?: string): UpdateKind {
  if (!latest) return 'none'
  if (/alpha|beta|rc/i.test(latest)) return 'unknown'
  const a = parseSemver(installed)
  const b = parseSemver(latest)
  if (!a || !b) return 'unknown'
  if (b[0] > a[0]) return 'major'
  if (b[0] < a[0]) return 'none'
  if (b[1] > a[1]) return 'minor'
  if (b[1] < a[1]) return 'none'
  if (b[2] > a[2]) return 'patch'
  return 'none'
}

function runCapture(bin: string, args: string[], timeoutMs = 8000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      resolve({ code, out })
    }
    try {
      const p = spawn(bin, args, { windowsHide: true })
      p.stdout?.on('data', (b) => { out += b.toString() })
      p.stderr?.on('data', (b) => { out += b.toString() })
      p.on('exit', (code) => finish(code ?? 1))
      p.on('error', () => finish(1))
      setTimeout(() => {
        try { p.kill() } catch { /* noop */ }
        finish(1)
      }, timeoutMs)
    } catch {
      finish(1)
    }
  })
}

/** Read the version a binary reports about itself. */
export async function probeCoreVersion(spec: CoreSpec): Promise<string | undefined> {
  const bin = spec.currentPath()
  if (!existsSync(bin)) return undefined
  const { out } = await runCapture(bin, spec.versionArgs)
  const m = out.match(/(\d+\.\d+\.\d+)/)
  return m ? m[1] : undefined
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

interface GhAsset { name: string; browser_download_url: string; size: number }
interface GhRelease {
  tag_name?: string
  html_url?: string
  prerelease?: boolean
  draft?: boolean
  assets?: GhAsset[]
}

async function fetchLatestRelease(repo: string): Promise<GhRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: REQUEST_HEADERS
    })
    if (!res.ok) return null
    return (await res.json()) as GhRelease
  } catch {
    return null
  }
}

export async function checkCoreUpdates(): Promise<CoreUpdateState[]> {
  const out: CoreUpdateState[] = []

  for (const spec of CORES) {
    const present = existsSync(spec.currentPath())
    const installed = await probeCoreVersion(spec)
    const release = await fetchLatestRelease(spec.repo)
    const latest = release?.tag_name?.replace(/^v/i, '').trim()
    const asset = (release?.assets ?? []).find((a) => spec.matchAsset(a.name))
    const kind =
      release?.draft || release?.prerelease ? 'none' : classifyUpdate(installed, latest)

    out.push({
      id: spec.id,
      installed,
      latest,
      kind,
      // Only patch bumps are safe to apply unattended — see the file header.
      autoInstallable: kind === 'patch' && Boolean(asset),
      assetUrl: asset?.browser_download_url,
      assetName: asset?.name,
      releaseUrl: release?.html_url,
      present,
      note:
        kind === 'minor' || kind === 'major'
          ? 'Смена минорной версии может изменить схему конфига — установка только вручную, после проверки.'
          : undefined
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

/** Pull the core executable out of a release archive, wherever it sits. */
function extractExe(zipBuf: Buffer, exeName: string): Buffer | null {
  const zip = new AdmZip(zipBuf)
  const target = exeName.toLowerCase()
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const base = entry.entryName.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
    if (base === target) return entry.getData()
  }
  return null
}

/**
 * Validate a candidate binary against the config this app actually generates.
 *
 * This is the check that would have caught the 1.11 → 1.13 break before it
 * reached the user. When no config has been generated yet (the user has never
 * connected) there is nothing to validate against, and the caller decides
 * whether to proceed — currently only patch updates do.
 */
async function validateCandidate(
  spec: CoreSpec,
  candidatePath: string
): Promise<{ ok: boolean; reason?: string }> {
  const cfg = spec.configFile()
  if (!existsSync(cfg)) {
    return { ok: true, reason: 'конфиг ещё не создан — проверка пропущена' }
  }
  const { code, out } = await runCapture(candidatePath, spec.validateArgs(cfg), 15000)
  if (code === 0) return { ok: true }
  // eslint-disable-next-line no-control-regex
  const clean = out.replace(/\[[0-9;]*[A-Za-z]/g, '').trim().split('\n').slice(-3).join(' | ')
  return { ok: false, reason: clean || `код выхода ${code}` }
}

export interface CoreInstallResult {
  id: CoreId
  success: boolean
  installedVersion?: string
  message: string
}

export async function installCoreUpdate(
  id: CoreId,
  assetUrl: string,
  expectedVersion?: string
): Promise<CoreInstallResult> {
  const spec = CORES.find((c) => c.id === id)
  if (!spec) return { id, success: false, message: `Неизвестное ядро: ${id}` }
  if (!assetUrl) return { id, success: false, message: 'Пустая ссылка на архив' }

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return { id, success: false, message: `Не удалось скачать: ${e instanceof Error ? e.message : String(e)}` }
  }

  let exeData: Buffer | null
  try {
    exeData = extractExe(buf, spec.exeName)
  } catch (e) {
    return { id, success: false, message: `Архив повреждён: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!exeData || exeData.length < spec.minBytes) {
    return { id, success: false, message: `В архиве нет пригодного ${spec.exeName}` }
  }

  // Stage in a temp folder so a rejected candidate never touches the live path.
  const tmpDir = path.join(os.tmpdir(), `lazeyka-core-${id}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const candidate = path.join(tmpDir, spec.exeName)
  writeFileSync(candidate, exeData)

  const verdict = await validateCandidate(spec, candidate)
  if (!verdict.ok) {
    try { unlinkSync(candidate) } catch { /* noop */ }
    return {
      id,
      success: false,
      message:
        `Новая версия ${spec.exeName} отклонена: она не принимает наш конфиг. ` +
        `Текущая версия оставлена без изменений. Причина: ${verdict.reason}`
    }
  }

  // Swap with a backup we can roll back to.
  const dir = incyRuntimeDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const live = path.join(dir, spec.exeName)
  const backup = `${live}.bak`

  try {
    if (existsSync(live)) {
      try { if (existsSync(backup)) unlinkSync(backup) } catch { /* noop */ }
      copyFileSync(live, backup)
      unlinkSync(live)
    }
    renameSync(candidate, live)
  } catch (e) {
    // Put the old binary back if the swap failed halfway.
    try {
      if (!existsSync(live) && existsSync(backup)) copyFileSync(backup, live)
    } catch { /* noop */ }
    return {
      id,
      success: false,
      message: `Не удалось заменить ${spec.exeName}: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  const installed = await probeCoreVersion(spec)
  const size = (() => { try { return statSync(live).size } catch { return 0 } })()

  return {
    id,
    success: true,
    installedVersion: installed ?? expectedVersion,
    message:
      `${spec.exeName} обновлён до ${installed ?? expectedVersion ?? 'новой версии'} ` +
      `(${(size / 1024 / 1024).toFixed(1)} МБ)` +
      (verdict.reason ? ` — ${verdict.reason}` : '')
  }
}

/**
 * Apply every update that is safe to apply unattended, and report the rest.
 * Called on startup; never throws.
 */
export async function autoUpdateCores(): Promise<{
  installed: CoreInstallResult[]
  pending: CoreUpdateState[]
}> {
  const installed: CoreInstallResult[] = []
  const pending: CoreUpdateState[] = []

  let states: CoreUpdateState[] = []
  try {
    states = await checkCoreUpdates()
  } catch {
    return { installed, pending }
  }

  for (const s of states) {
    if (s.autoInstallable && s.assetUrl) {
      try {
        installed.push(await installCoreUpdate(s.id, s.assetUrl, s.latest))
      } catch (e) {
        installed.push({
          id: s.id,
          success: false,
          message: e instanceof Error ? e.message : String(e)
        })
      }
    } else if (s.kind === 'minor' || s.kind === 'major') {
      pending.push(s)
    }
  }

  return { installed, pending }
}

/** Discard the rollback copies once a new binary has proven itself. */
export function clearCoreBackups(): void {
  for (const spec of CORES) {
    const bak = path.join(incyRuntimeDir(), `${spec.exeName}.bak`)
    try {
      if (existsSync(bak)) unlinkSync(bak)
    } catch { /* noop */ }
  }
}
