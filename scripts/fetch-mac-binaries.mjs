#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Скачивает для macOS ядра INCY (sing-box и Xray) в resources-mac/incy/,
// Python для TgWsProxy (python-build-standalone + пакет proxy Flowseal) в resources-mac/tgws/
// и сборку Zapret для Mac (Flowseal/zapret-mac-discord-youtube: utunws, стратегии, списки)
// в resources-mac/zapret/.
//
// Использование:  node scripts/fetch-mac-binaries.mjs <arm64|x64> [--only=zapret]
// (--only=zapret — только Zapret, не трогая incy/ и tgws/; нужен для отладки.)
//
// Папка resources-mac/ не хранится в git: её заполняет CI перед сборкой
// (см. .github/workflows/build-mac.yml). electron-builder кладёт её внутрь
// .app в ту же раскладку, что и resources/ на Windows (incy/sing-box, incy/xray,
// tgws/python, tgws/app).
//
// Только встроенные модули Node + adm-zip (уже в зависимостях) + системный `tar`.

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

// ---- Версии ----------------------------------------------------------------
// sing-box: тот же форк, что и на Windows, — Leadaxe/sing-box-lx (AmneziaWG,
// без которой WARP в РФ не подключается). Официальный SagerNet не подходит.
// Xray: официальный XTLS/Xray-core. Переопределяются переменными окружения
// SING_BOX_VERSION / XRAY_VERSION.
const SING_BOX_REPO = 'Leadaxe/sing-box-lx'
const SING_BOX_VERSION = process.env.SING_BOX_VERSION || '1.14.4-lx.25'
const XRAY_VERSION = process.env.XRAY_VERSION || '26.10.29'

// Python для TgWsProxy: python-build-standalone (astral-sh), вариант
// install_only_stripped. Минорная версия 3.12 — как во встроенном Python на
// Windows (resources/tgws/python/python312.zip). Тег релиза и патч-версия
// закреплены; переопределяются PBS_TAG / PBS_PYTHON.
const PBS_REPO = 'astral-sh/python-build-standalone'
const PBS_TAG = process.env.PBS_TAG || '20261026'
const PBS_PYTHON = process.env.PBS_PYTHON || '3.12.16'

// Zapret для macOS — официальный порт Flowseal (nfqws через utun + BPF, движок utunws).
// Берём из релиза ZapretMac-macOS-universal.zip только Payload (бинарник, стратегии,
// списки по умолчанию). Скрипты запуска и служба — свои (src/main/core/zapret-mac-scripts).
// Тег закреплён; переопределяется ZAPRET_MAC_TAG (сумму тогда берём только из API GitHub).
const ZAPRET_MAC_REPO = 'Flowseal/zapret-mac-discord-youtube'
const ZAPRET_MAC_ASSET = 'ZapretMac-macOS-universal.zip'
const ZAPRET_MAC_TAG = process.env.ZAPRET_MAC_TAG || '1.1.2'
// SHA-256 архива закреплённого тега: запасной вариант, если API GitHub не отдаёт digest.
const ZAPRET_MAC_PINNED_SHA = { '1.1.2': '9895b0ec5d13ec05676f755cde71107e72d2661538440c3cc4f06e0e6d47844f' }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'resources-mac', 'incy')
const TGWS_OUT = path.join(ROOT, 'resources-mac', 'tgws')
const ZAPRET_OUT = path.join(ROOT, 'resources-mac', 'zapret')

const ARCH_MAP = {
  arm64: { singBox: 'arm64', xray: 'arm64-v8a', pbs: 'aarch64', pipPlatform: 'macosx_11_0_arm64', cpuType: 0x0100000c },
  x64: { singBox: 'amd64', xray: '64', pbs: 'x86_64', pipPlatform: 'macosx_10_13_x86_64', cpuType: 0x01000007 }
}

function fail(msg) {
  console.error(`\n[fetch-mac] ОШИБКА: ${msg}`)
  process.exit(1)
}

const arch = process.argv[2]
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length)
if (!arch || !ARCH_MAP[arch]) fail('укажите архитектуру: arm64 или x64')
const cfg = ARCH_MAP[arch]

/** GET с редиректами (fetch следует им сам) и понятной ошибкой. */
async function download(url, { auth = false, soft = false } = {}) {
  const headers = { 'User-Agent': 'LAZEYKA-fetch-mac' }
  // Токен отдаём только API GitHub: на редиректе в хранилище он не нужен.
  if (auth && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  let lastErr
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
      console.warn(`[fetch-mac] ${url}: попытка ${attempt} не удалась (${e.message})`)
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
  // soft: необязательный запрос (суммы) — вызывающий сам решает, что делать.
  if (soft) throw lastErr
  fail(`не удалось скачать ${url}: ${lastErr?.message ?? lastErr}`)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Ожидаемая SHA-256 ассета из API GitHub (поле digest «sha256:…»), если релиз её отдаёт. */
async function apiDigest(repo, tag, assetName) {
  try {
    const buf = await download(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { auth: true, soft: true })
    const rel = JSON.parse(buf.toString('utf8'))
    const a = (rel.assets ?? []).find((x) => x.name === assetName)
    const m = /^sha256:([0-9a-f]{64})$/i.exec(a?.digest ?? '')
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

/** Проверка суммы: у Xray есть файл .dgst, у остальных — digest из API. Несовпадение — ошибка. */
async function verify(buf, repo, tag, assetName, url, kind) {
  const actual = sha256(buf)
  let expected = null
  let source = ''
  if (kind === 'sums') {
    // sing-box-lx публикует общий файл SHA256SUMS рядом с архивами.
    try {
      const txt = (await download(`https://github.com/${repo}/releases/download/${tag}/SHA256SUMS`, { soft: true })).toString('utf8')
      const line = txt.split(/\r?\n/).find((l) => l.trim().endsWith(` ${assetName}`) || l.trim().endsWith(`*${assetName}`))
      const m = line ? /^([0-9a-f]{64})/i.exec(line.trim()) : null
      if (m) {
        expected = m[1].toLowerCase()
        source = 'SHA256SUMS'
      }
    } catch {
      /* пойдём через API */
    }
  }
  if (kind === 'dgst') {
    try {
      const txt = (await download(`${url}.dgst`, { soft: true })).toString('utf8')
      const m = /SHA2-256=\s*([0-9a-f]{64})/i.exec(txt)
      if (m) {
        expected = m[1].toLowerCase()
        source = '.dgst'
      }
    } catch {
      /* пойдём через API */
    }
  }
  if (!expected) {
    expected = await apiDigest(repo, tag, assetName)
    source = 'API GitHub'
  }
  if (!expected) {
    console.warn(`[fetch-mac] ${assetName}: опубликованной суммы нет — SHA-256 ${actual} не сверена`)
    return
  }
  if (expected !== actual) fail(`${assetName}: SHA-256 не совпала (${source}: ${expected}, получено ${actual})`)
  console.log(`[fetch-mac] ${assetName}: SHA-256 совпала (${source})`)
}

/** Первый файл с именем `name` в дереве каталога. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const r = findFile(p, name)
      if (r) return r
    } else if (entry.name === name) {
      return p
    }
  }
  return null
}

/** Это Mach-O нужной архитектуры (а не страница ошибки или бинарник другой платформы). */
function assertMachO(file, label) {
  const head = readFileSync(file).subarray(0, 8)
  const magic = head.readUInt32BE(0)
  // 0xcffaedfe — 64-битный Mach-O (little-endian), 0xcafebabe — fat-бинарник.
  if (magic === 0xcafebabe) return
  if (magic !== 0xcffaedfe) fail(`${label}: это не Mach-O (магическое число ${magic.toString(16)})`)
  const cpu = head.readUInt32LE(4)
  if (cpu !== cfg.cpuType) fail(`${label}: неверная архитектура (cputype 0x${cpu.toString(16)}, нужен ${arch})`)
}

function install(src, name) {
  mkdirSync(OUT_DIR, { recursive: true })
  const dest = path.join(OUT_DIR, name)
  writeFileSync(dest, readFileSync(src))
  chmodSync(dest, 0o755)
  assertMachO(dest, name)
  console.log(`[fetch-mac] ${name}: ${(statSync(dest).size / 1048576).toFixed(1)} МБ -> ${path.relative(ROOT, dest)}`)
}

async function fetchSingBox(tmp) {
  const tag = `v${SING_BOX_VERSION}`
  const asset = `sing-box-${SING_BOX_VERSION}-darwin-${cfg.singBox}.tar.gz`
  const url = `https://github.com/${SING_BOX_REPO}/releases/download/${tag}/${asset}`
  console.log(`[fetch-mac] sing-box: ${url}`)
  const buf = await download(url)
  if (buf.length < 5 * 1024 * 1024) fail(`${asset}: слишком маленький файл (${buf.length} байт)`)
  await verify(buf, SING_BOX_REPO, tag, asset, url, 'sums')
  const archive = path.join(tmp, asset)
  writeFileSync(archive, buf)
  const dir = path.join(tmp, 'sing-box')
  mkdirSync(dir, { recursive: true })
  const r = spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' })
  if (r.status !== 0) fail('tar не распаковал архив sing-box')
  const bin = findFile(dir, 'sing-box')
  if (!bin) fail('в архиве sing-box нет файла sing-box')
  install(bin, 'sing-box')
}

async function fetchXray(tmp) {
  const tag = `v${XRAY_VERSION}`
  const asset = `Xray-macos-${cfg.xray}.zip`
  const url = `https://github.com/XTLS/Xray-core/releases/download/${tag}/${asset}`
  console.log(`[fetch-mac] xray: ${url}`)
  const buf = await download(url)
  if (buf.length < 5 * 1024 * 1024) fail(`${asset}: слишком маленький файл (${buf.length} байт)`)
  await verify(buf, 'XTLS/Xray-core', tag, asset, url, 'dgst')
  const zip = new AdmZip(buf)
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.split('/').pop() === 'xray')
  if (!entry) fail('в архиве Xray нет файла xray')
  const out = path.join(tmp, 'xray')
  writeFileSync(out, entry.getData())
  install(out, 'xray')
}

// ---- Python для TgWsProxy ----------------------------------------------------

/** Каталоги и файлы python-build-standalone, которые TgWsProxy не нужны (tkinter/IDLE/тесты/заголовки). */
const PY_PRUNE = [
  'include',
  'share',
  'lib/pkgconfig',
  'lib/itcl4.3.8',
  'lib/tcl9',
  'lib/tcl9.0',
  'lib/tk9.0',
  'lib/thread3.0.6',
  'lib/libtcl9.0.dylib',
  'lib/libtcl9tk9.0.dylib',
  // Исполняемый python3.12 собран со статически вложенным интерпретатором
  // (ссылается только на системные библиотеки), libpython нужна лишь при встраивании.
  'lib/libpython3.12.dylib',
  'lib/python3.12/test',
  'lib/python3.12/idlelib',
  'lib/python3.12/tkinter',
  'lib/python3.12/turtledemo',
  'lib/python3.12/turtle.py',
  'lib/python3.12/ensurepip',
  'lib/python3.12/lib2to3',
  'lib/python3.12/pydoc_data',
  'lib/python3.12/config-3.12-darwin',
  'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so'
]

/** Все __pycache__ и симлинки → обычные файлы (electron-builder не обязан хранить симлинки). */
function cleanTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = path.resolve(path.dirname(p), readlinkSync(p))
      rmSync(p, { force: true })
      if (existsSync(target) && statSync(target).isFile()) copyFileSync(target, p)
    } else if (entry.isDirectory()) {
      if (entry.name === '__pycache__') rmSync(p, { recursive: true, force: true })
      else cleanTree(p)
    }
  }
}

function dirSizeMB(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSizeMB(p) * 1048576 : lstatSync(p).size
  }
  return total / 1048576
}

/**
 * Закреплённые версии бинарных зависимостей — из dist-info встроенного Windows-Python.
 * cffi и pycparser не закрепляем: для Intel-Mac у новых cffi нет колёс, их версию
 * подбирает pip по требованиям cryptography.
 */
function compiledDepSpecs() {
  const sp = path.join(ROOT, 'resources', 'tgws', 'python', 'Lib', 'site-packages')
  const specs = []
  if (existsSync(sp)) {
    for (const name of readdirSync(sp)) {
      const m = /^(.+?)-([0-9][^-]*)\.dist-info$/.exec(name)
      if (m && !/^(cffi|pycparser)$/i.test(m[1])) specs.push(`${m[1].replace(/_/g, '-')}==${m[2]}`)
    }
  }
  if (specs.length === 0) fail('не нашёл закреплённые зависимости в resources/tgws/python/Lib/site-packages')
  return specs
}

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) fail(`${label} завершился с кодом ${r.status}`)
}

async function fetchTgwsPython(tmp) {
  const asset = `cpython-${PBS_PYTHON}+${PBS_TAG}-${cfg.pbs}-apple-darwin-install_only_stripped.tar.gz`
  const base = `https://github.com/${PBS_REPO}/releases/download/${PBS_TAG}`
  const url = `${base}/${encodeURIComponent(asset)}`
  console.log(`[fetch-mac] python: ${url}`)

  // Сумма — строго из SHA256SUMS релиза; без неё Python не берём.
  const sums = (await download(`${base}/SHA256SUMS`)).toString('utf8')
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}`) || l.trim().endsWith(`*${asset}`))
  const m = line ? /^([0-9a-f]{64})/i.exec(line.trim()) : null
  if (!m) fail(`${asset}: в SHA256SUMS релиза ${PBS_TAG} нет суммы (проверьте PBS_TAG/PBS_PYTHON)`)
  const buf = await download(url)
  if (buf.length < 10 * 1024 * 1024) fail(`${asset}: слишком маленький файл (${buf.length} байт)`)
  const actual = sha256(buf)
  if (actual !== m[1].toLowerCase()) fail(`${asset}: SHA-256 не совпала (SHA256SUMS: ${m[1]}, получено ${actual})`)
  console.log(`[fetch-mac] ${asset}: SHA-256 совпала (SHA256SUMS)`)

  const archive = path.join(tmp, 'python.tar.gz')
  writeFileSync(archive, buf)
  const ex = path.join(tmp, 'python-x')
  mkdirSync(ex, { recursive: true })
  run('tar', ['-xzf', archive, '-C', ex], 'tar (python)')
  const src = path.join(ex, 'python')
  if (!existsSync(path.join(src, 'bin', 'python3.12'))) fail('в архиве Python нет bin/python3.12')

  const pyDir = path.join(TGWS_OUT, 'python')
  rmSync(TGWS_OUT, { recursive: true, force: true })
  mkdirSync(TGWS_OUT, { recursive: true })
  renameSync(src, pyDir)

  // Один настоящий файл bin/python3 (без симлинков и лишних скриптов).
  const binDir = path.join(pyDir, 'bin')
  renameSync(path.join(binDir, 'python3.12'), path.join(tmp, 'python3'))
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir)
  const py = path.join(binDir, 'python3')
  renameSync(path.join(tmp, 'python3'), py)
  chmodSync(py, 0o755)
  assertMachO(py, 'python3')

  // Бинарные зависимости (cryptography, cffi…) — в site-packages самого Python.
  const sitePackages = path.join(pyDir, 'lib', 'python3.12', 'site-packages')
  const specs = compiledDepSpecs()
  const native = process.platform === 'darwin' && process.arch === arch
  const pipCommon = ['--no-warn-script-location', '--disable-pip-version-check', '--only-binary=:all:', '--no-compile']
  if (native) {
    console.log(`[fetch-mac] pip (встроенный Python): ${specs.join(' ')}`)
    run(py, ['-m', 'pip', 'install', ...pipCommon, ...specs], 'pip install')
  } else {
    // Другая ОС/архитектура: колёса нужной платформы ставит pip хозяйского Python.
    const host = process.platform === 'win32' ? 'python' : 'python3'
    console.log(`[fetch-mac] pip (${host}, платформа ${cfg.pipPlatform}): ${specs.join(' ')}`)
    run(
      host,
      ['-m', 'pip', 'install', ...pipCommon, '--target', sitePackages, '--platform', cfg.pipPlatform, '--python-version', '3.12', '--implementation', 'cp', ...specs],
      'pip install --platform'
    )
  }
  // pip и его dist-info рантайму не нужны.
  for (const name of readdirSync(sitePackages)) {
    if (/^(pip|setuptools|wheel|pkg_resources|_distutils_hack)(-|$)/.test(name) || name === 'README.txt' || name === '__pycache__') {
      rmSync(path.join(sitePackages, name), { recursive: true, force: true })
    }
  }

  for (const rel of PY_PRUNE) rmSync(path.join(pyDir, ...rel.split('/')), { recursive: true, force: true })
  cleanTree(pyDir)

  // Загрузчик и пакет proxy — те же, что у Windows-сборки (чистый Python).
  copyFileSync(path.join(ROOT, 'resources', 'tgws', 'python', 'lazeyka_tgws.py'), path.join(pyDir, 'lazeyka_tgws.py'))
  const appSrc = path.join(ROOT, 'resources', 'tgws', 'app')
  if (!existsSync(path.join(appSrc, 'proxy', 'tg_ws_proxy.py'))) fail('resources/tgws/app/proxy не найден')
  const appDir = path.join(TGWS_OUT, 'app')
  cpSync(appSrc, appDir, { recursive: true })
  cleanTree(appDir)
  for (const f of readdirSync(appDir, { recursive: true })) {
    if (/\.(pyd|dll|exe)$/i.test(String(f))) fail(`в resources/tgws/app есть Windows-бинарник: ${f}`)
  }
  console.log(`[fetch-mac] tgws: python ${PBS_PYTHON} (${PBS_TAG}) + app ${dirSizeMB(TGWS_OUT).toFixed(0)} МБ -> ${path.relative(ROOT, TGWS_OUT)}`)

  if (native) {
    // Дымовая проверка: тот же набор импортов, что нужен proxy.
    const code = 'import sys; sys.path.insert(0, sys.argv[1]); import ssl, hashlib, asyncio, certifi, cryptography, httpx, h2, proxy.tg_ws_proxy as m; assert hasattr(m, "main"); print("ok", sys.version.split()[0])'
    const r = spawnSync(py, ['-B', '-s', '-c', code, appDir], { encoding: 'utf8' })
    if (r.status !== 0 || !r.stdout.includes('ok')) fail(`Python для TgWsProxy не прошёл проверку импорта: ${(r.stderr || '').trim().split('\n').pop()}`)
    console.log(`[fetch-mac] проверка импорта: ${r.stdout.trim()}`)
  } else {
    console.warn('[fetch-mac] НЕ macOS-хост той же архитектуры: проверка запуска Python пропущена')
  }
}

// ---- Zapret для macOS ----------------------------------------------------------

/** Что берём из Payload релиза. Остальное (их скрипты, plist, update-app.sh) нам не нужно. */
const ZAPRET_KEEP = [
  /^bin\/[A-Za-z0-9._-]+$/,
  /^strategies\/general[a-z0-9-]*\.conf\.in$/,
  /^default-lists\/[a-z0-9-]+\.txt$/,
  /^strategies\.tsv$/,
  /^ipset-(any|none)\.txt$/
]

/** Fat-бинарник Mach-O с обеими архитектурами (utunws у Flowseal — universal). */
function assertUniversalMachO(file, label) {
  const buf = readFileSync(file)
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0xcafebabe) fail(`${label}: ожидался universal Mach-O (fat)`)
  const n = buf.readUInt32BE(4)
  const cpus = new Set()
  for (let i = 0; i < n && i < 8; i++) cpus.add(buf.readUInt32BE(8 + i * 20))
  if (!cpus.has(0x01000007) || !cpus.has(0x0100000c)) fail(`${label}: в fat-бинарнике нет x86_64 и arm64 одновременно`)
}

async function fetchZapretMac(tmp) {
  const tag = ZAPRET_MAC_TAG
  const url = `https://github.com/${ZAPRET_MAC_REPO}/releases/download/${tag}/${ZAPRET_MAC_ASSET}`
  console.log(`[fetch-mac] zapret: ${url}`)
  const buf = await download(url)
  if (buf.length < 100 * 1024) fail(`${ZAPRET_MAC_ASSET}: слишком маленький файл (${buf.length} байт)`)

  // Сумма: digest из API GitHub; нет его — закреплённая в скрипте; нет и её — только предупреждение.
  const actual = sha256(buf)
  let expected = await apiDigest(ZAPRET_MAC_REPO, tag, ZAPRET_MAC_ASSET)
  let source = 'API GitHub'
  if (!expected && ZAPRET_MAC_PINNED_SHA[tag]) {
    expected = ZAPRET_MAC_PINNED_SHA[tag]
    source = 'сумма, закреплённая в скрипте'
  }
  if (!expected) console.warn(`[fetch-mac] ${ZAPRET_MAC_ASSET}: опубликованной суммы нет — SHA-256 ${actual} не сверена`)
  else if (expected !== actual) fail(`${ZAPRET_MAC_ASSET}: SHA-256 не совпала (${source}: ${expected}, получено ${actual})`)
  else console.log(`[fetch-mac] ${ZAPRET_MAC_ASSET}: SHA-256 совпала (${source})`)

  const zip = new AdmZip(buf)
  const prefix = 'ZapretMac.app/Contents/Resources/Payload/'
  rmSync(ZAPRET_OUT, { recursive: true, force: true })
  mkdirSync(ZAPRET_OUT, { recursive: true })
  let files = 0
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue
    const rel = e.entryName.slice(prefix.length)
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) continue
    if (!ZAPRET_KEEP.some((re) => re.test(rel))) continue
    const dest = path.join(ZAPRET_OUT, ...rel.split('/'))
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, e.getData())
    // Права из архива не доверяем: исполняемый только движок.
    chmodSync(dest, rel === 'bin/utunws' ? 0o755 : 0o644)
    files++
  }
  const engine = path.join(ZAPRET_OUT, 'bin', 'utunws')
  if (!existsSync(engine)) fail('в архиве Zapret нет bin/utunws')
  assertMachO(engine, 'utunws')
  assertUniversalMachO(engine, 'utunws')
  for (const need of ['strategies.tsv', 'ipset-any.txt', 'ipset-none.txt', 'default-lists/list-general.txt', 'strategies/general.conf.in']) {
    if (!existsSync(path.join(ZAPRET_OUT, ...need.split('/')))) fail(`в архиве Zapret нет ${need}`)
  }
  // Версия — рядом с файлами: по ней приложение сравнивает установленную службу с встроенной.
  const plist = zip.getEntry('ZapretMac.app/Contents/Info.plist')?.getData().toString('utf8') ?? ''
  const ver = /CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]
  if (ver && ver !== tag.replace(/^v/i, '')) console.warn(`[fetch-mac] zapret: версия в Info.plist (${ver}) не равна тегу ${tag}`)
  writeFileSync(path.join(ZAPRET_OUT, 'VERSION'), `${tag.replace(/^v/i, '')}\n`)
  console.log(`[fetch-mac] zapret ${tag}: ${files} файлов, utunws ${(statSync(engine).size / 1024).toFixed(0)} КБ -> ${path.relative(ROOT, ZAPRET_OUT)}`)
}

const tmp = mkdtempSync(path.join(tmpdir(), 'lazeyka-mac-'))
try {
  if (only === 'zapret') {
    await fetchZapretMac(tmp)
  } else {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
    console.log(`[fetch-mac] архитектура ${arch}, sing-box ${SING_BOX_VERSION}, xray ${XRAY_VERSION}, python ${PBS_PYTHON}, zapret ${ZAPRET_MAC_TAG}`)
    await fetchSingBox(tmp)
    await fetchXray(tmp)
    await fetchTgwsPython(tmp)
    await fetchZapretMac(tmp)
  }
  console.log('[fetch-mac] готово')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
