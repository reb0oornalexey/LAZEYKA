/**
 * Плагин Stream Deck для LAZEYKA: поиск, упаковка и установка из окна программы.
 *
 * Плагин сам ничего не делает: кнопки открывают ссылки lazeyka://…, которые разбирает deeplink.ts.
 * Установка = открыть файл .streamDeckPlugin системой, его подхватывает приложение Elgato.
 * В сборку папка плагина попадает через extraResources (electron-builder.yml → resources/streamdeck).
 * Готового файла нет (обычный случай, так и должно быть) — архив собирается из папки на лету
 * во временную папку, adm-zip.
 *
 * Ничего не работает в фоне: код выполняется только по кнопкам на карточке.
 *
 * Подпись ссылок: при сборке плагина в него кладётся plugin/codes.js с кодами
 * HMAC секрета установки по каждому действию (deeplink-sign.ts) — кнопки
 * работают без подтверждения. Плагин из репозитория (без кодов) работает, но
 * программа на каждое нажатие спрашивает «Выполнить?».
 *
 * IPC: streamdeck:info, streamdeck:install, streamdeck:reveal,
 *      streamdeck:links (подписанные ссылки для копирования), streamdeck:rotateKey («Обновить ссылки»).
 */
import { app, ipcMain, shell } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { resourcesDir } from '../utils/dirs'
import { appLog } from '../utils/app-logger'
import { PLUGIN_DIR_NAME, PLUGIN_FILE_NAME, packPlugin } from './streamdeck-pack'
import { FIXED_ACTIONS, buildSignedUrl, isSignableAction, pluginCodesScript } from './deeplink-sign'
import { getDeeplinkKey, rotateDeeplinkKey } from './deeplink-key'
import { listScenarios } from './scenarios'

export interface StreamDeckInfo {
  platform: NodeJS.Platform
  /** file — есть готовый файл; folder — соберём из папки; none — плагина в программе нет. */
  source: 'file' | 'folder' | 'none'
  /** Найдено ли приложение Elgato Stream Deck (по обычным местам установки). */
  elgatoFound: boolean
}

export interface StreamDeckResult {
  status: 'opened' | 'not-found' | 'error' | 'revealed'
  message: string
  /** Файл плагина (куда собран или откуда взят). */
  file?: string
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Корни, где может лежать папка streamdeck: установленная программа и рабочая копия (dev). */
function roots(): string[] {
  const res = resourcesDir()
  return [path.join(res, 'streamdeck'), path.join(res, '..', 'streamdeck'), path.join(app.getAppPath(), 'streamdeck')]
}

export function locatePlugin(): { file: string | null; folder: string | null } {
  let file: string | null = null
  let folder: string | null = null
  for (const r of roots()) {
    for (const f of [path.join(r, PLUGIN_FILE_NAME), path.join(r, 'dist', PLUGIN_FILE_NAME)]) {
      if (!file && isFile(f)) file = f
    }
    const d = path.join(r, PLUGIN_DIR_NAME)
    if (!folder && isDir(d) && isFile(path.join(d, 'manifest.json'))) folder = d
  }
  return { file, folder }
}

/** Приложение Elgato по обычным местам установки. Не нашли — ещё не значит «нет»: поэтому есть «всё равно открыть». */
export function findElgato(platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['ProgramW6432']].filter(Boolean) as string[]
    const exe = pf.map((p) => path.join(p, 'Elgato', 'StreamDeck', 'StreamDeck.exe'))
    const appData = process.env['APPDATA'] ? [path.join(process.env['APPDATA'], 'Elgato', 'StreamDeck')] : []
    return [...exe].some(isFile) || appData.some(isDir)
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Elgato Stream Deck.app',
      path.join(homedir(), 'Applications', 'Elgato Stream Deck.app'),
      path.join(homedir(), 'Library', 'Application Support', 'com.elgato.StreamDeck')
    ].some(isDir)
  }
  return false
}

/** Действия, которые подписываются для плагина: постоянные и все сценарии на момент сборки. */
function pluginActions(): string[] {
  let ids: string[] = []
  try {
    ids = listScenarios().map((s) => `scenario/${s.id}`)
  } catch {
    /* сценариев нет */
  }
  return [...FIXED_ACTIONS, ...ids].filter(isSignableAction)
}

/**
 * Файл плагина. Из папки собирается всегда (с кодами подписи этой установки);
 * готовый файл из сборки (без кодов) — только если папки нет.
 */
export function ensurePluginFile(): string {
  const { file, folder } = locatePlugin()
  if (folder) {
    const out = path.join(app.getPath('temp'), 'lazeyka-streamdeck', PLUGIN_FILE_NAME)
    const codes = pluginCodesScript(getDeeplinkKey(), pluginActions())
    const n = packPlugin(folder, out, { 'plugin/codes.js': codes })
    appLog('info', `[streamdeck] плагин собран из папки с кодами подписи: ${n} файлов`)
    return out
  }
  if (file) {
    appLog('warn', '[streamdeck] папки плагина нет — ставится готовый файл без кодов подписи (кнопки будут спрашивать подтверждение)')
    return file
  }
  throw new Error('Плагин Stream Deck не найден в программе. Переустановите LAZEYKA')
}

/** Подписанные ссылки для копирования: действие → ссылка. Только простые команды. */
function signedLinks(actions: unknown): Record<string, string> {
  const list = Array.isArray(actions) ? actions.filter((a): a is string => typeof a === 'string').slice(0, 200) : []
  const key = getDeeplinkKey()
  const out: Record<string, string> = {}
  for (const a of list) if (isSignableAction(a)) out[a] = buildSignedUrl(key, a)
  return out
}

function info(): StreamDeckInfo {
  const { file, folder } = locatePlugin()
  return { platform: process.platform, source: file ? 'file' : folder ? 'folder' : 'none', elgatoFound: findElgato() }
}

async function install(force: boolean): Promise<StreamDeckResult> {
  let file: string
  try {
    file = ensurePluginFile()
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  if (!force && !findElgato()) {
    return {
      status: 'not-found',
      file,
      message:
        'Приложение Stream Deck от Elgato не найдено. Установите его с сайта elgato.com (раздел загрузок) и нажмите кнопку ещё раз. Если оно уже стоит в другом месте, нажмите «Всё равно открыть» или откройте файл плагина вручную.'
    }
  }
  const err = await shell.openPath(file)
  if (err) {
    appLog('warn', `[streamdeck] не удалось открыть файл плагина: ${err}`)
    return {
      status: 'error',
      file,
      message: `Система не смогла открыть файл плагина (${err}). Нажмите «Показать файл в папке» и откройте его двойным щелчком или установите приложение Stream Deck.`
    }
  }
  return { status: 'opened', file, message: 'Файл передан приложению Stream Deck. Подтвердите установку в его окне, затем ищите раздел «LAZEYKA» в списке действий справа.' }
}

function reveal(): StreamDeckResult {
  const file = ensurePluginFile()
  shell.showItemInFolder(file)
  return { status: 'revealed', file, message: 'Файл показан в папке. Дважды щёлкните по нему, чтобы установить плагин.' }
}

// ---- IPC ----------------------------------------------------------------------------------

/** Как h() из utils/ipc.ts: ошибка обработчика уходит в окно как { ok: false, message }. */
function h<T>(fn: (...args: unknown[]) => Promise<T> | T) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const value = await fn(...args)
      return { ok: true, value }
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerStreamDeckIpc(): void {
  const handle = <T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, h(fn))
  }
  handle('streamdeck:info', () => info())
  handle('streamdeck:install', (force) => install(force === true))
  handle('streamdeck:reveal', () => reveal())
  handle('streamdeck:links', (actions) => signedLinks(actions))
  handle('streamdeck:rotateKey', () => {
    rotateDeeplinkKey()
    appLog('info', '[deeplink] выпущен новый секрет ссылок: прежние ссылки и плагин будут спрашивать подтверждение')
    return true
  })
  // Секрет создаётся при первом запуске (здесь — при регистрации каналов), а не при первой ссылке.
  try {
    getDeeplinkKey()
  } catch (e) {
    appLog('warn', `[deeplink] не удалось создать секрет ссылок: ${e instanceof Error ? e.message : String(e)}`)
  }
}
