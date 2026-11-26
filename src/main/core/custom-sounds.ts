/**
 * Свои звуки пользователя (Настройки → Звуки → «Свой файл…»).
 * Файл выбирается системным диалогом, копируется в <папка данных>/sounds/ и
 * дальше читается только оттуда. Список — sounds/index.json. В экспорт профиля
 * (.lazeyka) не попадает: экспорт берёт только конфиг и списки Zapret.
 * Проверку «это звук и он не длиннее 5 с» делает окно (decodeAudioData) — если
 * не прошла, оно само вызывает customSounds:remove.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { appLog } from '../utils/app-logger'

export interface CustomSound {
  id: string
  name: string
  file: string
  size: number
  addedAt: number
}

const MAX_BYTES = 2 * 1024 * 1024
const MAX_COUNT = 30
const EXTS = ['mp3', 'wav', 'ogg', 'm4a']

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

function soundsDir(): string {
  const dir = path.join(dataDir(), 'sounds')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const indexFile = (): string => path.join(soundsDir(), 'index.json')
const ID_RE = /^[a-f0-9-]{36}$/

function readIndex(): CustomSound[] {
  try {
    const raw = JSON.parse(readFileSync(indexFile(), 'utf-8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is CustomSound =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as CustomSound).id === 'string' &&
        ID_RE.test((x as CustomSound).id) &&
        typeof (x as CustomSound).name === 'string' &&
        typeof (x as CustomSound).file === 'string' &&
        path.basename((x as CustomSound).file) === (x as CustomSound).file
    )
  } catch {
    return []
  }
}

function writeIndex(list: CustomSound[]): void {
  writeFileAtomic(indexFile(), JSON.stringify(list, null, 2))
}

function list(): CustomSound[] {
  const dir = soundsDir()
  return readIndex().filter((s) => existsSync(path.join(dir, s.file)))
}

function find(id: unknown): CustomSound {
  const s = typeof id === 'string' ? readIndex().find((x) => x.id === id) : undefined
  if (!s) throw new Error('Звук не найден')
  return s
}

async function pick(): Promise<CustomSound | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts: Electron.OpenDialogOptions = {
    title: 'Свой звук',
    properties: ['openFile'],
    filters: [{ name: 'Звук (mp3, wav, ogg, m4a)', extensions: EXTS }]
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return null
  const src = r.filePaths[0]
  const ext = path.extname(src).slice(1).toLowerCase()
  if (!EXTS.includes(ext)) throw new Error('Подходят файлы mp3, wav, ogg и m4a')
  const size = statSync(src).size
  if (size > MAX_BYTES) throw new Error('Файл больше 2 МБ — выберите звук покороче')
  if (size < 64) throw new Error('Файл пустой')
  const cur = list()
  if (cur.length >= MAX_COUNT) throw new Error(`Своих звуков уже ${MAX_COUNT} — удалите ненужные`)
  const id = randomUUID()
  const file = `${id}.${ext}`
  copyFileSync(src, path.join(soundsDir(), file))
  const name = path.basename(src, path.extname(src)).trim().slice(0, 40) || 'Свой звук'
  const entry: CustomSound = { id, name, file, size, addedAt: Date.now() }
  writeIndex([...cur, entry])
  appLog('info', `[sounds] добавлен свой звук: ${name} (${size} байт)`)
  return entry
}

function read(id: unknown): Uint8Array {
  const s = find(id)
  return readFileSync(path.join(soundsDir(), s.file))
}

function remove(id: unknown): void {
  const s = find(id)
  try {
    unlinkSync(path.join(soundsDir(), s.file))
  } catch {
    /* файла уже нет */
  }
  writeIndex(readIndex().filter((x) => x.id !== s.id))
}

export function registerCustomSoundsIpc(): void {
  ipcMain.handle('customSounds:list', h(() => list()))
  ipcMain.handle('customSounds:pick', h(() => pick()))
  ipcMain.handle('customSounds:read', h((id) => read(id)))
  ipcMain.handle('customSounds:remove', h((id) => remove(id)))
}
