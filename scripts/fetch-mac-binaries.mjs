#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Скачивает ядра INCY для macOS (sing-box и Xray) в resources-mac/incy/.
//
// Использование:  node scripts/fetch-mac-binaries.mjs <arm64|x64>
//
// Папка resources-mac/ не хранится в git: её заполняет CI перед сборкой
// (см. .github/workflows/build-mac.yml). electron-builder кладёт её внутрь
// .app в ту же раскладку, что и resources/ на Windows (incy/sing-box, incy/xray).
//
// Только встроенные модули Node + adm-zip (уже в зависимостях) + системный `tar`.

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

// ---- Версии ----------------------------------------------------------------
// sing-box: в Windows-сборке ядро 1.14.3 (форк sing-box-lx на базе 1.14.3);
// на macOS берём официальный релиз SagerNet с той же базовой версией.
// Xray: XRAY_VERSION нужно держать равной версии xray.exe в resources/incy
// (проверка: `resources/incy/xray.exe version`). Переопределяются переменными
// окружения SING_BOX_VERSION / XRAY_VERSION.
const SING_BOX_VERSION = process.env.SING_BOX_VERSION || '1.14.3'
const XRAY_VERSION = process.env.XRAY_VERSION || '26.3.27'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'resources-mac', 'incy')

const ARCH_MAP = {
  arm64: { singBox: 'arm64', xray: 'arm64-v8a', cpuType: 0x0100000c },
  x64: { singBox: 'amd64', xray: '64', cpuType: 0x01000007 }
}

function fail(msg) {
  console.error(`\n[fetch-mac] ОШИБКА: ${msg}`)
  process.exit(1)
}

const arch = process.argv[2]
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
  const url = `https://github.com/SagerNet/sing-box/releases/download/${tag}/${asset}`
  console.log(`[fetch-mac] sing-box: ${url}`)
  const buf = await download(url)
  if (buf.length < 5 * 1024 * 1024) fail(`${asset}: слишком маленький файл (${buf.length} байт)`)
  await verify(buf, 'SagerNet/sing-box', tag, asset, url, 'api')
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

const tmp = mkdtempSync(path.join(tmpdir(), 'lazeyka-mac-'))
try {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  console.log(`[fetch-mac] архитектура ${arch}, sing-box ${SING_BOX_VERSION}, xray ${XRAY_VERSION}`)
  await fetchSingBox(tmp)
  await fetchXray(tmp)
  console.log('[fetch-mac] готово')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
