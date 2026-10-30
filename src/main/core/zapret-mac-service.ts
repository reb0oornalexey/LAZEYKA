/**
 * macOS: служба Zapret (движок utunws из Flowseal/zapret-mac-discord-youtube).
 *
 * Права root нужны для utun, BPF и правил pf, а приложение работает от обычного
 * пользователя. Поэтому пароль спрашивают ОДИН раз — при установке службы
 * (системное окно osascript), дальше всё идёт без пароля:
 *
 *   • /Library/Application Support/LAZEYKA/zapret/ — движок, стратегии, наши
 *     скрипты (run/stop/watchdog/ctl). Всё root:wheel, пользователь писать не может.
 *   • /Library/LaunchDaemons/io.github.reb0oornalexey.lazeyka.zapret.plist —
 *     задача launchd (RunAtLoad выключен, при загрузке системы не стартует).
 *   • /etc/sudoers.d/lazeyka-zapret — разрешает пользователю запускать без пароля
 *     ТОЛЬКО четыре команды: `ctl.sh start|stop|restart|status`.
 *
 * Приложение пишет в свою папку (zapretMacDataRoot) выбранную стратегию, режим
 * IPset и списки; run.sh от root проверяет и копирует их — как в оригинале Flowseal.
 *
 * Установка и обновление движка — один и тот же шаг и всегда с паролем: без пароля
 * любой процесс пользователя мог бы подменить бинарник, который запускается от root.
 * Чтобы пользовательский процесс не успел подменить файлы за время, пока открыто
 * окно пароля, команда установки несёт SHA-256 каждого файла и root проверяет
 * копии (а не исходники) до подмены рабочей папки.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resourcesDir, zapretMacDataRoot } from '../utils/dirs'
import { appLog } from '../utils/app-logger'
import { runElevated } from './incy-mac-service'
import { shQuote } from './incy-mac-lxd'
import runSh from './zapret-mac/run.sh?raw'
import watchdogSh from './zapret-mac/watchdog.sh?raw'
import stopSh from './zapret-mac/stop.sh?raw'
import ctlSh from './zapret-mac/ctl.sh?raw'

const IS_MAC = process.platform === 'darwin'

export const ZAPRET_LABEL = 'io.github.reb0oornalexey.lazeyka.zapret'
export const ZAPRET_PARENT = '/Library/Application Support/LAZEYKA'
export const ZAPRET_BASE = `${ZAPRET_PARENT}/zapret`
export const ZAPRET_CTL = `${ZAPRET_BASE}/ctl.sh`
export const ZAPRET_PLIST = `/Library/LaunchDaemons/${ZAPRET_LABEL}.plist`
export const ZAPRET_SUDOERS = '/private/etc/sudoers.d/lazeyka-zapret'
const PAYLOAD_INFO = `${ZAPRET_BASE}/lazeyka-payload.json`

export type ZapretMacStateId = 'unsupported' | 'not_installed' | 'needs_update' | 'ready'

export interface ZapretMacServiceInfo {
  state: ZapretMacStateId
  installed: boolean
  /** Версия движка Zapret (релиз Flowseal) в установленной службе. */
  installedVersion?: string
  /** Версия, которая лежит в приложении. */
  bundledVersion?: string
  detail?: string
}

export interface ZapretMacServiceResult {
  ok: boolean
  cancelled?: boolean
  message: string
  info: ZapretMacServiceInfo
}

/** Событие для окна: «нужна / нужно обновить службу Zapret». */
export interface ZapretMacNotice {
  reason: 'required' | 'update'
  message: string
}

export const ZAPRET_REQUIRED_TEXT =
  'Для Zapret на macOS нужна служба с правами администратора. Пароль спросят один раз.'

/** Нужна установка службы (нет службы, sudoers или она сломана). */
export class ZapretMacServiceRequiredError extends Error {
  constructor(message = ZAPRET_REQUIRED_TEXT) {
    super(message)
    this.name = 'ZapretMacServiceRequiredError'
  }
}

// ---- Состав сборки --------------------------------------------------------------

/** Что берём из Payload релиза Flowseal (остальное — их скрипты и plist — нам не нужно). */
const PAYLOAD_KEEP = [
  /^bin\/[A-Za-z0-9._-]+$/,
  /^strategies\/general[a-z0-9-]*\.conf\.in$/,
  /^default-lists\/[a-z0-9-]+\.txt$/,
  /^strategies\.tsv$/,
  /^ipset-(any|none)\.txt$/
]
const PAYLOAD_REQUIRED = [
  'bin/utunws',
  'strategies.tsv',
  'ipset-any.txt',
  'ipset-none.txt',
  'strategies/general-simple-fake.conf.in',
  'default-lists/list-general.txt',
  'default-lists/ipset-all.txt'
]

export interface PlanFile {
  /** Путь внутри папки службы, всегда через «/». */
  rel: string
  sha256: string
  exec: boolean
  /** Откуда root копирует файл; у сгенерированных файлов нет, их содержимое несёт сама команда. */
  src?: string
  content?: Buffer
}

export interface PayloadScan {
  dir: string
  version: string
  files: PlanFile[]
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

/** Fat (0xcafebabe) или 64-битный Mach-O: не страница ошибки и не чужой бинарник. */
export function isMachO(file: string): boolean {
  try {
    const b = readFileSync(file).subarray(0, 4)
    if (b.length < 4) return false
    const be = b.readUInt32BE(0)
    return be === 0xcafebabe || be === 0xcffaedfe || be === 0xfeedfacf
  } catch {
    return false
  }
}

/**
 * Разобрать папку Payload: белый список файлов, SHA-256 каждого. Ссылки и всё
 * нестандартное отбрасываются; нет обязательных файлов или движок — не Mach-O → ошибка.
 */
export function scanPayload(dir: string): PayloadScan {
  const files: PlanFile[] = []
  const walk = (sub: string): void => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name
      const full = path.join(dir, rel)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(rel)
      else if (st.isFile() && PAYLOAD_KEEP.some((re) => re.test(rel))) {
        files.push({ rel, sha256: sha256(readFileSync(full)), exec: rel === 'bin/utunws', src: full })
      }
    }
  }
  walk('')
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  for (const need of PAYLOAD_REQUIRED) {
    if (!files.some((f) => f.rel === need)) throw new Error(`В сборке Zapret нет файла ${need}`)
  }
  if (!isMachO(path.join(dir, 'bin', 'utunws'))) throw new Error('bin/utunws — не исполняемый файл macOS (Mach-O)')
  let version = ''
  try {
    version = readFileSync(path.join(dir, 'VERSION'), 'utf-8').trim()
  } catch {
    /* версии нет — покажем «неизвестна» */
  }
  return { dir, version, files }
}

/** Папка со встроенной сборкой (resources-mac/zapret → resources/zapret в .app). */
export function bundledPayloadDir(): string | null {
  const candidates = [path.join(resourcesDir(), 'zapret')]
  // Dev на macOS: resources/zapret — это Windows-сборка, Mac-сборку кладёт scripts/fetch-mac-binaries.mjs.
  if (is.dev) candidates.push(path.join(resourcesDir(), '..', 'resources-mac', 'zapret'))
  return candidates.find((d) => existsSync(path.join(d, 'bin', 'utunws'))) ?? null
}

export function bundledPayloadVersion(): string | undefined {
  const dir = bundledPayloadDir()
  if (!dir) return undefined
  try {
    return readFileSync(path.join(dir, 'VERSION'), 'utf-8').trim() || undefined
  } catch {
    return undefined
  }
}

// ---- Файлы, которые мы ставим сами ----------------------------------------------------

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** plist задачи launchd. DATA_ROOT зашит здесь, поэтому ctl.sh не принимает путей от вызывающего. */
export function buildPlist(dataRoot: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${ZAPRET_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${ZAPRET_BASE}/run.sh</string>
        <string>${xmlEscape(dataRoot)}</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>2</integer>
    <key>StandardOutPath</key>
    <string>${ZAPRET_BASE}/zapret.log</string>
    <key>StandardErrorPath</key>
    <string>${ZAPRET_BASE}/zapret.log</string>
</dict>
</plist>
`
}

/**
 * sudoers: пользователь (по uid, чтобы не зависеть от странных имён) запускает без пароля
 * только ctl.sh с одним из четырёх аргументов. Пробелы в пути экранируются обратной чертой.
 */
export function buildSudoers(uid: number): string {
  if (!Number.isInteger(uid) || uid < 1) throw new Error('Не удалось определить пользователя')
  const ctl = ZAPRET_CTL.replace(/ /g, '\\ ')
  const cmds = ['start', 'stop', 'restart', 'status'].map((c) => `${ctl} ${c}`).join(', ')
  return `# LAZEYKA: управление службой Zapret без пароля (ставится и удаляется вместе со службой)
Cmnd_Alias LAZEYKA_ZAPRET = ${cmds}
#${uid} ALL=(root) NOPASSWD: LAZEYKA_ZAPRET
`
}

const SERVICE_SCRIPTS: { rel: string; text: string }[] = [
  { rel: 'run.sh', text: runSh },
  { rel: 'stop.sh', text: stopSh },
  { rel: 'watchdog.sh', text: watchdogSh },
  { rel: 'ctl.sh', text: ctlSh }
]

/** Хэш всего, что мы пишем сами (скрипты, шаблоны plist и sudoers): изменился — службу надо переустановить. */
export function serviceFilesHash(): string {
  return sha256(
    [...SERVICE_SCRIPTS.map((s) => s.text), buildPlist('@DATA_ROOT@'), buildSudoers(1)].join('\n--\n')
  )
}

// ---- Установленная служба -----------------------------------------------------------------

interface InstalledInfo {
  version?: string
  files?: string
  dataRoot?: string
  uid?: number
}

function readInstalledInfo(): InstalledInfo | null {
  try {
    return JSON.parse(readFileSync(PAYLOAD_INFO, 'utf-8')) as InstalledInfo
  } catch {
    return null
  }
}

export function installedPayloadVersion(): string | undefined {
  return readInstalledInfo()?.version || undefined
}

function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function zapretMacServiceState(): ZapretMacServiceInfo {
  if (!IS_MAC) return { state: 'unsupported', installed: false }
  const bundled = bundledPayloadVersion()
  const info = readInstalledInfo()
  if (!existsSync(ZAPRET_PLIST) || !existsSync(ZAPRET_CTL) || !existsSync(ZAPRET_SUDOERS) || !info) {
    return { state: 'not_installed', installed: false, bundledVersion: bundled }
  }
  const base = { installed: true, installedVersion: info.version, bundledVersion: bundled }
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (info.files !== serviceFilesHash() || info.dataRoot !== zapretMacDataRoot() || info.uid !== uid) {
    return { state: 'needs_update', ...base, detail: 'служба собрана другой версией LAZEYKA или для другого пользователя' }
  }
  if (bundled && info.version && cmpVersion(bundled, info.version) > 0) {
    return { state: 'needs_update', ...base, detail: `в приложении более новый Zapret (${bundled})` }
  }
  return { state: 'ready', ...base }
}

/** Окно приложения должно показать диалог службы Zapret. */
export function notifyZapretMacService(notice: ZapretMacNotice): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('zapretMac:notice', notice)
  }
}

// ---- Управление без пароля (sudo -n ctl.sh …) -----------------------------------------------

export type ZapretCtlCommand = 'start' | 'stop' | 'restart' | 'status'
export type ZapretCtlStatus = 'running' | 'starting' | 'stopped'

export interface ZapretCtlResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/** sudo сказал «нужен пароль / нет прав» — значит sudoers нет или он сломан. */
export function isSudoDenied(stderr: string): boolean {
  return /a password is required|may not run sudo|not in the sudoers|not allowed to execute|a terminal is required/i.test(stderr)
}

/** Только четыре команды, без оболочки (execFile) и без пользовательских аргументов. */
export function zapretCtl(command: ZapretCtlCommand, timeoutMs = 40_000): Promise<ZapretCtlResult> {
  return new Promise((resolve) => {
    if (!IS_MAC) return resolve({ ok: false, code: null, stdout: '', stderr: 'только macOS' })
    execFile('/usr/bin/sudo', ['-n', ZAPRET_CTL, command], { timeout: timeoutMs, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      const rawCode = err ? (err as { code?: unknown }).code : 0
      const code = typeof rawCode === 'number' ? rawCode : null
      resolve({ ok: !err, code, stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

export async function zapretCtlStatus(): Promise<ZapretCtlStatus | 'unavailable'> {
  const r = await zapretCtl('status', 10_000)
  if (!r.ok) return 'unavailable'
  return r.stdout === 'running' || r.stdout === 'starting' ? r.stdout : 'stopped'
}

/** Хвост журнала службы для сообщения об ошибке (файлы 0644, пользователь их читает). */
export function zapretServiceLogTail(lines = 6): string {
  for (const name of ['zapret.log', 'engine.log']) {
    try {
      const text = readFileSync(path.join(ZAPRET_BASE, name), 'utf-8')
      const tail = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-lines)
      if (tail.length) return tail.join(' | ')
    } catch {
      /* нет файла */
    }
  }
  return ''
}

// ---- Команды установки и удаления --------------------------------------------------------

/** Допустимый путь рабочей папки — то же правило, что в run.sh. */
export function isValidDataRoot(p: string): boolean {
  return !p.includes('..') && /^\/Users\/[^/]+\/Library\/Application Support\/(lazeyka|lazeyka-dev)\/zapret-mac$/.test(p)
}

const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64')

/**
 * Одна команда оболочки для `do shell script … with administrator privileges`.
 * Порядок важен: сначала собираем и проверяем всё во временной папке и проверяем
 * sudoers через visudo, и только потом трогаем рабочую папку, plist и sudoers.
 */
export function buildInstallCommand(files: PlanFile[], opts: { dataRoot: string; uid: number }): string {
  const q = shQuote
  const stage = `${ZAPRET_PARENT}/zapret.new`
  const old = `${ZAPRET_PARENT}/zapret.old`
  const manifest = `${ZAPRET_PARENT}/zapret.manifest`
  const sudoersTmp = `${ZAPRET_PARENT}/lazeyka-zapret.sudoers.new`
  const plistTmp = `${ZAPRET_PARENT}/zapret.plist.new`
  const install = '/usr/bin/install -o root -g wheel'
  const decode = (content: string | Buffer, to: string): string => `printf %s ${q(b64(content))} | /usr/bin/base64 -D > ${q(to)}`

  const all = files
  const dirs = new Set<string>([''])
  for (const f of all) {
    const d = path.posix.dirname(f.rel)
    if (d !== '.') dirs.add(d)
  }

  const cmds: string[] = [
    `${install} -d -m 755 ${q(ZAPRET_PARENT)}`,
    `/bin/rm -rf ${q(stage)} ${q(manifest)} ${q(sudoersTmp)} ${q(plistTmp)}`,
    ...[...dirs].sort().map((d) => `${install} -d -m 755 ${q(d ? `${stage}/${d}` : stage)}`)
  ]
  for (const f of all) {
    const dest = `${stage}/${f.rel}`
    if (f.content) {
      cmds.push(decode(f.content, dest), `/usr/sbin/chown root:wheel ${q(dest)}`, `/bin/chmod ${f.exec ? '755' : '644'} ${q(dest)}`)
    } else {
      cmds.push(`${install} -m ${f.exec ? '0755' : '0644'} ${q(f.src as string)} ${q(dest)}`)
    }
  }
  const manifestText = all.map((f) => `${f.sha256}  ${f.rel}`).join('\n') + '\n'
  cmds.push(
    decode(manifestText, manifest),
    // Проверяем КОПИИ, лежащие в каталоге root: что бы ни случилось с исходниками, пока был открыт запрос пароля.
    `( cd ${q(stage)} && /usr/bin/shasum -a 256 -c ${q(manifest)} >/dev/null )`,
    `[ "$(/usr/bin/find ${q(stage)} -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')" = ${all.length} ]`,
    `[ -z "$(/usr/bin/find ${q(stage)} -type l)" ]`,
    // sudoers проверяем ДО любых изменений на диске: не прошёл visudo — установка отменяется целиком.
    decode(buildSudoers(opts.uid), sudoersTmp),
    `/usr/sbin/chown root:wheel ${q(sudoersTmp)}`,
    `/bin/chmod 0440 ${q(sudoersTmp)}`,
    `/usr/sbin/visudo -cf ${q(sudoersTmp)} >/dev/null`,
    decode(buildPlist(opts.dataRoot), plistTmp),
    `/usr/bin/plutil -lint ${q(plistTmp)} >/dev/null`,
    // Старая служба останавливается перед подменой файлов.
    `{ [ ! -x ${q(`${ZAPRET_BASE}/stop.sh`)} ] || /bin/sh ${q(`${ZAPRET_BASE}/stop.sh`)} >/dev/null 2>&1 || true; }`,
    `/bin/rm -rf ${q(old)}`,
    `{ [ ! -e ${q(ZAPRET_BASE)} ] || /bin/mv ${q(ZAPRET_BASE)} ${q(old)}; }`,
    `/bin/mv ${q(stage)} ${q(ZAPRET_BASE)}`,
    `/usr/sbin/chown root:wheel ${q(plistTmp)}`,
    `/bin/chmod 644 ${q(plistTmp)}`,
    `/bin/mv ${q(plistTmp)} ${q(ZAPRET_PLIST)}`,
    // В покое задача выключена: после перезагрузки сама не поднимется. Включает её ctl.sh start.
    `{ /bin/launchctl disable ${q(`system/${ZAPRET_LABEL}`)} >/dev/null 2>&1 || true; }`,
    `${install} -d -m 755 ${q(path.posix.dirname(ZAPRET_SUDOERS))}`,
    `/bin/mv ${q(sudoersTmp)} ${q(ZAPRET_SUDOERS)}`,
    `/bin/rm -rf ${q(old)} ${q(manifest)}`
  )
  // Любой сбой — убрать временные файлы (рабочая папка к этому моменту либо нетронута, либо уже подменена целиком).
  return `${cmds.join(' && ')} || { /bin/rm -rf ${q(stage)} ${q(manifest)} ${q(sudoersTmp)} ${q(plistTmp)}; false; }`
}

export function buildUninstallCommand(): string {
  const q = shQuote
  const tolerant = (c: string): string => `{ ${c} >/dev/null 2>&1 || true; }`
  return [
    tolerant(`[ ! -x ${q(`${ZAPRET_BASE}/stop.sh`)} ] || /bin/sh ${q(`${ZAPRET_BASE}/stop.sh`)}`),
    tolerant(`/bin/launchctl bootout ${q(`system/${ZAPRET_LABEL}`)}`),
    tolerant(`/bin/launchctl enable ${q(`system/${ZAPRET_LABEL}`)}`),
    `/bin/rm -f ${q(ZAPRET_PLIST)} ${q(ZAPRET_SUDOERS)}`,
    `/bin/rm -rf ${q(ZAPRET_BASE)} ${q(`${ZAPRET_PARENT}/zapret.new`)} ${q(`${ZAPRET_PARENT}/zapret.old`)} ${q(`${ZAPRET_PARENT}/zapret.manifest`)}`,
    `/bin/rm -f /var/run/lazeyka-zapret.armed /var/run/lazeyka-zapret.conf /var/db/lazeyka-zapret.keepinit`,
    tolerant(`/bin/rmdir ${q(ZAPRET_PARENT)}`)
  ].join(' && ')
}

// ---- Установка / обновление / удаление -----------------------------------------------------

export interface InstallOptions {
  /** Папка Payload, из которой ставим (скачанное обновление). Не указана — встроенная или уже установленная, смотря что новее. */
  sourceDir?: string
  /** Версия, записываемая в службу (для скачанного обновления). */
  version?: string
}

/**
 * Файлы, которые root будет копировать. Если в службе уже стоит более новый движок,
 * чем встроенный (его скачали обновлением), берём его же — чтобы переустановка скриптов
 * не откатывала Zapret назад.
 */
export function resolveInstallSource(opts: InstallOptions): PayloadScan {
  if (opts.sourceDir) {
    const scan = scanPayload(opts.sourceDir)
    return { ...scan, version: opts.version || scan.version }
  }
  const bundledDir = bundledPayloadDir()
  const bundledVer = bundledPayloadVersion() ?? ''
  const installed = zapretMacServiceState()
  if (installed.installed && installed.installedVersion && (!bundledDir || cmpVersion(installed.installedVersion, bundledVer) > 0)) {
    const scan = scanPayload(ZAPRET_BASE)
    return { ...scan, version: installed.installedVersion }
  }
  if (!bundledDir) throw new Error('В приложении нет сборки Zapret для macOS (resources/zapret/bin/utunws)')
  return scanPayload(bundledDir)
}

/** Скрипты, plist-информация и sudoers — к списку файлов движка. */
export function buildPlanFiles(scan: PayloadScan, dataRoot: string, uid: number): PlanFile[] {
  const generated: PlanFile[] = SERVICE_SCRIPTS.map((s) => ({
    rel: s.rel,
    sha256: sha256(s.text),
    exec: true,
    content: Buffer.from(s.text, 'utf-8')
  }))
  const infoText =
    JSON.stringify({ version: scan.version, files: serviceFilesHash(), dataRoot, uid, installedAt: new Date().toISOString() }) + '\n'
  generated.push({ rel: 'lazeyka-payload.json', sha256: sha256(infoText), exec: false, content: Buffer.from(infoText, 'utf-8') })
  return [...scan.files, ...generated]
}

/** Создать рабочую папку пользователя и положить списки по умолчанию, если их ещё нет. */
export function ensureZapretMacDataRoot(payloadDir?: string): string {
  const root = zapretMacDataRoot()
  const lists = path.join(root, 'lists')
  mkdirSync(lists, { recursive: true })
  const dir = payloadDir ?? (existsSync(path.join(ZAPRET_BASE, 'default-lists')) ? ZAPRET_BASE : bundledPayloadDir())
  if (dir) {
    const defaults = path.join(dir, 'default-lists')
    if (existsSync(defaults)) {
      for (const name of readdirSync(defaults)) {
        const target = path.join(lists, name)
        if (!existsSync(target) && /^[a-z0-9-]+\.txt$/.test(name)) writeFileSync(target, readFileSync(path.join(defaults, name)))
      }
    }
  }
  const strategyFile = path.join(root, 'selected-strategy')
  if (!existsSync(strategyFile)) writeFileSync(strategyFile, 'general-simple-fake\n')
  const ipsetFile = path.join(root, 'ipset-mode')
  if (!existsSync(ipsetFile)) writeFileSync(ipsetFile, 'none\n')
  return root
}

let installBusy = false

export async function installZapretMacService(opts: InstallOptions = {}): Promise<ZapretMacServiceResult> {
  const fail = (message: string, cancelled = false): ZapretMacServiceResult => ({
    ok: false,
    cancelled,
    message,
    info: zapretMacServiceState()
  })
  if (!IS_MAC) return fail('Служба нужна только на macOS')
  if (installBusy) return fail('Установка уже идёт')
  if (typeof process.getuid !== 'function') return fail('Не удалось определить пользователя')
  const dataRoot = zapretMacDataRoot()
  if (!isValidDataRoot(dataRoot)) {
    return fail(`Папка профиля вне /Users не поддерживается: ${dataRoot}`)
  }
  installBusy = true
  try {
    let scan: PayloadScan
    let command: string
    try {
      scan = resolveInstallSource(opts)
      ensureZapretMacDataRoot(scan.dir)
      command = buildInstallCommand(buildPlanFiles(scan, dataRoot, process.getuid()), { dataRoot, uid: process.getuid() })
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
    appLog('info', `[zapret-mac] установка службы (Zapret ${scan.version || '?'}): запрашиваю пароль администратора`)
    const run = await runElevated(command)
    if (run.cancelled) {
      appLog('info', '[zapret-mac] установка отменена пользователем')
      return fail('Установка отменена', true)
    }
    if (!run.ok) {
      appLog('error', `[zapret-mac] установка не удалась: ${run.error}`)
      return fail(`Служба Zapret не установилась: ${run.error}`)
    }
    appLog('info', '[zapret-mac] служба Zapret установлена')
    return { ok: true, message: 'Служба Zapret установлена', info: zapretMacServiceState() }
  } finally {
    installBusy = false
  }
}

export async function uninstallZapretMacService(): Promise<ZapretMacServiceResult> {
  if (!IS_MAC) return { ok: false, message: 'Служба нужна только на macOS', info: zapretMacServiceState() }
  appLog('info', '[zapret-mac] удаление службы: запрашиваю пароль администратора')
  const run = await runElevated(buildUninstallCommand())
  if (run.cancelled) return { ok: false, cancelled: true, message: 'Удаление отменено', info: zapretMacServiceState() }
  if (!run.ok) {
    appLog('error', `[zapret-mac] удаление не удалось: ${run.error}`)
    return { ok: false, message: `Служба Zapret не удалилась: ${run.error}`, info: zapretMacServiceState() }
  }
  appLog('info', '[zapret-mac] служба Zapret удалена')
  return { ok: true, message: 'Служба Zapret удалена', info: zapretMacServiceState() }
}

/** Папка во временном каталоге пользователя для скачанного обновления (0700). */
export function makeUpdateTempDir(): string {
  const dir = path.join(os.tmpdir(), `lazeyka-zapret-${process.pid}-${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
