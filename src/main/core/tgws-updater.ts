import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync, readdirSync, readFileSync, cpSync } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'
import { tgwsRuntimeDir, tgwsCliPaths, resourcesDir } from '../utils/dirs'
import { getAppConfig, patchAppConfig } from '../config'
import { loadUpdateCache, saveUpdateCache } from '../utils/update-cache'
import { stopTgws, getTgwsStatus } from './tgws'
import { logToFile } from '../utils/file-logger'

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
  // Версия консольного пакета Flowseal (файл VERSION рядом с `proxy/`) —
  // именно он и запускается. Поле конфига осталось от tray-бинарника.
  const cli = tgwsCliPaths()
  if (cli?.version) return cli.version
  const v = cfgInstalled?.trim()
  return v ? v : undefined
}

/** Baseline used for comparison — an unknown install is older than anything. */
function compareBaseline(installed?: string): string {
  return installed ?? '0.0.0'
}

export async function checkTgwsUpdate(force = false): Promise<TgwsUpdateInfo> {
  // macOS: обновление ставится во встроенный Windows-Python — на Mac не подходит,
  // подключается на этапе порта TgWsProxy.
  if (process.platform === 'darwin') return { hasUpdate: false }
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

  // Обновляется не tray-бинарник, а пакет `proxy` из исходников релиза:
  // LAZEYKA запускает консольную точку входа Flowseal во встроенном Python
  // (без трея и окон). Архив исходников есть у каждого тега.
  const winAsset = undefined as { name: string; size?: number } | undefined
  const assetDownloadUrl = tag ? `https://github.com/${REPO}/archive/refs/tags/${tag}.zip` : undefined

  const hasUpdate = latest ? compareVersion(latest, compareBaseline(installed)) > 0 : false

  const info: TgwsUpdateInfo = {
    installed,
    latest,
    hasUpdate,
    assetName: winAsset?.name ?? `tg-ws-proxy-${tag}.zip`,
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

/**
 * Проверить, что встроенный Python импортирует новый пакет целиком.
 *
 * Импортируются ВСЕ модули `proxy/`, а не только точка входа: часть модулей
 * Flowseal подключает лениво, и недостающая зависимость всплыла бы только
 * на живом трафике. Возвращает null при успехе или последнюю строку ошибки.
 */
function smokeTestPackage(appDir: string): Promise<string | null> {
  const cli = tgwsCliPaths()
  if (!cli) return Promise.resolve('встроенный Python не найден')
  return new Promise((resolve) => {
    const code = [
      'import sys, pkgutil, importlib',
      'sys.path.insert(0, sys.argv[1])',
      'import proxy',
      'import proxy.tg_ws_proxy as m',
      'assert hasattr(m, "main")',
      'for i in pkgutil.iter_modules(proxy.__path__): importlib.import_module("proxy." + i.name)',
      'print("ok")'
    ].join('\n')
    const p = spawn(cli.python, ['-B', '-X', 'utf8', '-c', code, appDir], { windowsHide: true })
    let out = ''
    let err = ''
    p.stdout?.on('data', (d) => (out += d.toString()))
    p.stderr?.on('data', (d) => (err += d.toString()))
    const timer = setTimeout(() => {
      try { p.kill() } catch { /* noop */ }
      resolve('таймаут проверки')
    }, 20000)
    p.on('error', (e) => {
      clearTimeout(timer)
      resolve(e.message)
    })
    p.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c === 0 && out.includes('ok') ? null : (err.trim().split(/\r?\n/).pop() || `код ${c}`))
    })
  })
}

// ---- зависимости Python ------------------------------------------------------
//
// С 1.11 Flowseal ходит в Cloudflare по HTTP/2 (`proxy/cf_h2.py`,
// `proxy/h2_transport.py`) и тянет `httpx[http2]` и `h2`. Во встроенном
// Python их нет, а pip во встраиваемом дистрибутиве отсутствует, поэтому
// обновление отклонялось с «No module named 'httpx'».
//
// Теперь недостающие модули ставятся сами: проверка импорта называет модуль,
// которого не хватает, он берётся из уже установленной копии (встроенной или
// прошлого обновления) либо скачивается с PyPI колесом `py3-none-any` и
// распаковывается рядом с пакетом `proxy/` — тот же каталог уже стоит в
// sys.path. Повторяем, пока импорт не пройдёт. Версии, закреплённые в
// pyproject.toml Flowseal (`httpx[http2]==0.28.1`), соблюдаются.

/** Имя модуля → имя пакета на PyPI, где они различаются. */
const MODULE_TO_DIST: Record<string, string> = {
  typing_extensions: 'typing-extensions',
  exceptiongroup: 'exceptiongroup',
  yaml: 'PyYAML',
  dateutil: 'python-dateutil'
}

/** Только чистый Python: двоичные пакеты под встроенный Python не подобрать надёжно. */
const MAX_DEP_ROUNDS = 20

function missingModuleOf(err: string | null): string | null {
  if (!err) return null
  const m = /No module named '([A-Za-z0-9_.]+)'/.exec(err)
  return m ? m[1].split('.')[0] : null
}

/** `httpx[http2]==0.28.1` → { httpx: '0.28.1' } из списка dependencies в pyproject.toml. */
function parsePins(pyproject: string): Map<string, string> {
  const pins = new Map<string, string>()
  const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(pyproject)?.[1] ?? ''
  for (const m of block.matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([A-Za-z0-9_.]+)\s*(;[^"']*)?["']/g)) {
    const marker = m[3] ?? ''
    // Маркеры под старый Python/другие ОС пропускаем — нам нужен Windows + 3.12.
    if (/python_version\s*<\s*'3\.(?:[0-9]|1[0-2])'/.test(marker) && !/>=/.test(marker)) continue
    if (/platform_system\s*==\s*'(?:Darwin|Linux)'/.test(marker)) continue
    pins.set(m[1].toLowerCase().replace(/_/g, '-'), m[2])
  }
  return pins
}

/** Модуль уже лежит в каталоге (пакет или одиночный .py)? Тогда копируем его вместе с dist-info. */
function copyModuleFrom(srcDir: string, mod: string, destDir: string): boolean {
  if (!existsSync(srcDir) || path.resolve(srcDir) === path.resolve(destDir)) return false
  const pkg = path.join(srcDir, mod)
  const single = path.join(srcDir, `${mod}.py`)
  const hasPkg = existsSync(path.join(pkg, '__init__.py'))
  if (!hasPkg && !existsSync(single)) return false
  if (hasPkg) cpSync(pkg, path.join(destDir, mod), { recursive: true })
  else cpSync(single, path.join(destDir, `${mod}.py`))
  // dist-info того же пакета — для importlib.metadata.
  const distPrefix = (MODULE_TO_DIST[mod] ?? mod).toLowerCase().replace(/-/g, '_')
  for (const name of readdirSync(srcDir)) {
    if (name.toLowerCase().startsWith(`${distPrefix}-`) && name.endsWith('.dist-info')) {
      cpSync(path.join(srcDir, name), path.join(destDir, name), { recursive: true })
    }
  }
  return true
}

interface PypiFile {
  filename: string
  url: string
  packagetype?: string
  yanked?: boolean
}

async function fetchPypiWheel(dist: string, version?: string): Promise<{ file: PypiFile; version: string }> {
  const url = version
    ? `https://pypi.org/pypi/${encodeURIComponent(dist)}/${encodeURIComponent(version)}/json`
    : `https://pypi.org/pypi/${encodeURIComponent(dist)}/json`
  const res = await fetch(url, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'], Accept: 'application/json' } })
  if (!res.ok) throw new Error(`PyPI ${dist}: HTTP ${res.status}`)
  const data = (await res.json()) as { info?: { version?: string }; urls?: PypiFile[] }
  const files = (data.urls ?? []).filter((f) => f.packagetype === 'bdist_wheel' && !f.yanked)
  const pick =
    files.find((f) => /-py3-none-any\.whl$/i.test(f.filename)) ??
    files.find((f) => /-py2\.py3-none-any\.whl$/i.test(f.filename)) ??
    files.find((f) => /-cp312-[^-]+-win_amd64\.whl$/i.test(f.filename))
  if (!pick) throw new Error(`PyPI ${dist}: нет подходящего колеса для Windows / Python 3.12`)
  return { file: pick, version: data.info?.version ?? version ?? '?' }
}

async function installWheelFromPypi(dist: string, version: string | undefined, destDir: string): Promise<string> {
  const { file, version: v } = await fetchPypiWheel(dist, version)
  const res = await fetch(file.url, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
  if (!res.ok) throw new Error(`${file.filename}: HTTP ${res.status}`)
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()))
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const rel = entry.entryName.replace(/\\/g, '/')
    // `*.data/` (скрипты, заголовки) встроенному Python не нужны.
    if (rel.startsWith('/') || rel.split('/').includes('..') || rel.split('/')[0].endsWith('.data')) continue
    const dest = path.join(destDir, ...rel.split('/'))
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, entry.getData())
  }
  return `${dist} ${v}`
}

/**
 * Довести `appDir` до рабочего состояния: ставить недостающие модули, пока
 * импорт не пройдёт. Возвращает null при успехе или текст последней ошибки.
 */
async function ensureDependencies(
  appDir: string,
  pins: Map<string, string>,
  onStep?: (msg: string) => void
): Promise<string | null> {
  const donors = [path.join(tgwsRuntimeDir(), 'app'), path.join(resourcesDir(), 'tgws', 'app')]
  const tried = new Set<string>()
  let err = await smokeTestPackage(appDir)
  for (let round = 0; err && round < MAX_DEP_ROUNDS; round++) {
    const mod = missingModuleOf(err)
    if (!mod || tried.has(mod)) return err
    tried.add(mod)
    if (donors.some((d) => copyModuleFrom(d, mod, appDir))) {
      onStep?.(`зависимость ${mod}: из установленной копии`)
    } else {
      const dist = MODULE_TO_DIST[mod] ?? mod
      try {
        const label = await installWheelFromPypi(dist, pins.get(dist.toLowerCase().replace(/_/g, '-')), appDir)
        onStep?.(`зависимость ${mod}: скачан ${label} (PyPI)`)
      } catch (e) {
        return `не удалось установить модуль ${mod}: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    err = await smokeTestPackage(appDir)
  }
  return err
}

/**
 * Установить новую версию Flowseal tg-ws-proxy.
 *
 * Скачивается архив исходников тега, из него берётся только пакет `proxy/`,
 * проверяется импортом во встроенном Python и атомарно подменяет прежний
 * (с откатом при ошибке). Раньше tray-бинарник записывался поверх рабочего
 * без проверки и без возможности отката.
 */
export async function installTgwsUpdate(
  assetUrl: string,
  expectedVersion?: string,
  onProgress?: (msg: string) => void
): Promise<{ installedVersion?: string; sizeBytes: number }> {
  if (process.platform === 'darwin') throw new Error('Обновление TgWsProxy для macOS пока недоступно')
  if (!assetUrl) throw new Error('Пустая ссылка на обновление')
  if (!tgwsCliPaths()) throw new Error('Встроенный Python для TgWsProxy не найден — переустановите LAZEYKA')

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, { headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    throw new Error(`Не удалось скачать TgWsProxy: ${e instanceof Error ? e.message : String(e)}`)
  }

  const root = tgwsRuntimeDir()
  mkdirSync(root, { recursive: true })
  const staging = path.join(root, `app.new-${Date.now()}`)
  const target = path.join(root, 'app')
  const backup = path.join(root, 'app.bak')

  try {
    const zip = new AdmZip(buf)
    let files = 0
    for (const entry of zip.getEntries()) {
      // <repo>-<tag>/proxy/... → proxy/...
      const m = /^[^/]+\/(proxy\/.+|LICENSE|pyproject\.toml)$/.exec(entry.entryName)
      if (!m || entry.isDirectory) continue
      const rel = m[1]
      if (rel.includes('..')) continue
      const dest = path.join(staging, ...rel.split('/'))
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, entry.getData())
      files++
    }
    if (files === 0 || !existsSync(path.join(staging, 'proxy', 'tg_ws_proxy.py'))) {
      throw new Error('в архиве нет пакета proxy/tg_ws_proxy.py')
    }
    if (expectedVersion) writeFileSync(path.join(staging, 'VERSION'), expectedVersion.replace(/^v/i, ''), 'utf-8')

    let pins = new Map<string, string>()
    try {
      pins = parsePins(readFileSync(path.join(staging, 'pyproject.toml'), 'utf-8'))
    } catch { /* pyproject нет — ставим последние версии */ }
    const smoke = await ensureDependencies(staging, pins, (msg) => {
      logToFile({ time: Date.now(), type: 'info', source: 'tgws', payload: `обновление: ${msg}` })
      onProgress?.(msg)
    })
    if (smoke) throw new Error(`новая версия не запускается во встроенном Python: ${smoke}`)
  } catch (e) {
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* noop */ }
    throw new Error(`Обновление TgWsProxy отклонено: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Остановить прокси, подменить пакет, при сбое — вернуть прежний.
  const st = getTgwsStatus()
  const wasRunning = st.state === 'running' || st.state === 'starting'
  if (wasRunning) {
    try { await stopTgws() } catch { /* best-effort */ }
  }
  try {
    rmSync(backup, { recursive: true, force: true })
    if (existsSync(target)) renameSync(target, backup)
    renameSync(staging, target)
    rmSync(backup, { recursive: true, force: true })
  } catch (e) {
    try {
      if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
    } catch { /* noop */ }
    throw new Error(`Не удалось заменить файлы TgWsProxy: ${e instanceof Error ? e.message : String(e)}`)
  }
  // Подчистить незавершённые попытки прошлых запусков.
  for (const name of readdirSync(root)) {
    if (name.startsWith('app.new-')) {
      try { rmSync(path.join(root, name), { recursive: true, force: true }) } catch { /* noop */ }
    }
  }

  const finalVersion = expectedVersion?.replace(/^v/i, '') || undefined
  const cfg = await getAppConfig()
  const next: TgwsConfig = {
    ...(cfg.tgws as TgwsConfig),
    installedVersion: finalVersion ?? cfg.tgws?.installedVersion,
    dismissedUpdateTag: undefined
  }
  await patchAppConfig({ tgws: next })

  if (wasRunning) {
    const { startTgws } = await import('./tgws')
    await startTgws().catch(() => void 0)
  }

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
