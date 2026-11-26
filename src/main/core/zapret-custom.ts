/**
 * Свои стратегии Zapret (Windows): хранение, запись .bat, переименование, экспорт.
 *
 * Где лежат:
 *  - главная копия — `<данные программы>/zapret-custom-strategies.json` (модели и названия);
 *    обновление сборки Zapret её не трогает;
 *  - рабочая копия — `general (LZ <название>).bat` в папке сборки (zapretBundleDir()), рядом
 *    со встроенными: только оттуда стратегию видят запуск Zapret (cmd /c), проверка всех
 *    стратегий и установка службы, и только там работают `%~dp0bin\`, `%~dp0lists\` и
 *    `call service.bat …`. Имя проходит isSafeStrategyFileName.
 * Обновление сборки (installZapretBundle) переносит файлы `general (…).bat`, которых нет
 * в новой версии; если файл всё же пропал — он пишется заново из главной копии при
 * следующем чтении списка стратегий (ensureCustomMaterialized). Файл `general (LZ …).bat`
 * с моделью внутри, которого нет в списке (например, список удалили), — подхватывается.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { dataDir, zapretBundleDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { appLog } from '../utils/app-logger'
import { getAppConfig, patchAppConfig } from '../config'
import {
  checkCustomName,
  customFileName,
  customNameFromFile,
  exportStrategyText,
  generateBat,
  importStrategyText,
  modelFromBatComment,
  normalizeModel,
  parseBatToModel,
  referencedBinFiles,
  renderCommandPreview,
  type StrategyModel
} from './zapret-model'
import { isSafeStrategyFileName } from './zapret-strategy'

export type CustomOrigin = 'manual' | 'autopick' | 'import'

export interface CustomStrategy {
  id: string
  name: string
  file: string
  model: StrategyModel
  origin: CustomOrigin
  /** Название стратегии, на основе которой создана (для подписи). */
  basedOn?: string
  createdAt: number
  updatedAt: number
}

interface StoreFile {
  v: 1
  items: Omit<CustomStrategy, 'file'>[]
}

const STORE = 'zapret-custom-strategies.json'
const MAX_ITEMS = 60

function storePath(): string {
  return path.join(dataDir(), STORE)
}

function readStore(): Omit<CustomStrategy, 'file'>[] {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf-8')) as Partial<StoreFile>
    if (!raw || !Array.isArray(raw.items)) return []
    const out: Omit<CustomStrategy, 'file'>[] = []
    for (const it of raw.items) {
      const nm = checkCustomName(it?.name)
      if (!nm.ok || typeof it.id !== 'string' || !/^[a-f0-9]{8,32}$/.test(it.id)) continue
      try {
        out.push({
          id: it.id,
          name: nm.name,
          model: normalizeModel(it.model),
          origin: it.origin === 'autopick' || it.origin === 'import' ? it.origin : 'manual',
          basedOn: typeof it.basedOn === 'string' ? it.basedOn.slice(0, 80) : undefined,
          createdAt: Number(it.createdAt) || Date.now(),
          updatedAt: Number(it.updatedAt) || Date.now()
        })
      } catch {
        /* испорченная запись — пропускаем */
      }
    }
    return out
  } catch {
    return []
  }
}

function writeStore(items: Omit<CustomStrategy, 'file'>[]): void {
  mkdirSync(dataDir(), { recursive: true })
  const data: StoreFile = { v: 1, items }
  writeFileAtomic(storePath(), JSON.stringify(data, null, 2))
}

const withFile = (x: Omit<CustomStrategy, 'file'>): CustomStrategy => ({ ...x, file: customFileName(x.name) })

const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase('ru') === b.toLocaleLowerCase('ru')

/** Папка сборки, если в ней есть general.bat (иначе писать некуда). */
function bundleDir(): string | null {
  if (process.platform !== 'win32') return null
  const dir = zapretBundleDir()
  return existsSync(path.join(dir, 'general.bat')) ? dir : null
}

/** Файлы bin/ сборки (для выбора подделок в конструкторе). */
export function listBinFiles(): { tls: string[]; quic: string[]; all: string[] } {
  const dir = path.join(zapretBundleDir(), 'bin')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((f) => /\.bin$/i.test(f) && /^[A-Za-z0-9_.-]+$/.test(f))
  } catch {
    names = []
  }
  names.sort()
  return {
    tls: names.filter((f) => /^(tls_clienthello_|stun)/i.test(f)),
    quic: names.filter((f) => /^quic_initial_/i.test(f)),
    all: names
  }
}

function checkBinFiles(m: StrategyModel): void {
  const dir = path.join(zapretBundleDir(), 'bin')
  if (!existsSync(dir)) return // dev без bin/: проверять нечего
  const missing = referencedBinFiles(m).filter((f) => !existsSync(path.join(dir, f)))
  if (missing.length) throw new Error(`В сборке Zapret нет файла ${missing.join(', ')} — выберите другую подделку`)
}

function writeBat(dir: string, name: string, m: StrategyModel): void {
  const file = customFileName(name)
  if (!isSafeStrategyFileName(file)) throw new Error('Недопустимое название стратегии')
  writeFileAtomic(path.join(dir, file), generateBat(m, name))
}

/**
 * Привести папку сборки в соответствие со списком: дописать пропавшие .bat,
 * подхватить чужие `general (LZ …).bat` с моделью внутри. Ничего не удаляет.
 */
export function ensureCustomMaterialized(): void {
  const dir = bundleDir()
  if (!dir) return
  try {
    const items = readStore()
    let changed = false
    for (const it of items) {
      const full = path.join(dir, customFileName(it.name))
      const want = generateBat(it.model, it.name)
      let have = ''
      try {
        have = readFileSync(full, 'utf-8')
      } catch {
        /* нет файла */
      }
      if (have !== want) writeFileAtomic(full, want)
    }
    for (const f of readdirSync(dir)) {
      const name = customNameFromFile(f)
      if (!name || !isSafeStrategyFileName(f)) continue
      if (items.some((x) => sameName(x.name, name))) continue
      const nm = checkCustomName(name)
      if (!nm.ok) continue
      let model: StrategyModel | null = null
      try {
        model = modelFromBatComment(readFileSync(path.join(dir, f), 'utf-8'))
      } catch {
        model = null
      }
      if (!model || items.length >= MAX_ITEMS) continue
      items.push({ id: newId(), name: nm.name, model, origin: 'import', createdAt: Date.now(), updatedAt: Date.now() })
      changed = true
    }
    if (changed) writeStore(items)
  } catch (e) {
    appLog('warn', `zapret: свои стратегии не записаны в папку сборки: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function newId(): string {
  return randomBytes(8).toString('hex')
}

export function listCustomStrategies(): CustomStrategy[] {
  ensureCustomMaterialized()
  return readStore().map(withFile)
}

export interface SaveInput {
  /** Есть — изменить эту стратегию (и, если поменялось название, переименовать файл). */
  id?: string
  name: string
  model: unknown
  origin?: CustomOrigin
  basedOn?: string
}

/** Создать или изменить свою стратегию. Возвращает её с именем файла. */
export async function saveCustomStrategy(input: SaveInput): Promise<CustomStrategy> {
  const dir = bundleDir()
  if (!dir) throw new Error('Сборка Zapret не найдена — свои стратегии сохранить некуда')
  const nm = checkCustomName(input.name)
  if (!nm.ok) throw new Error(nm.message)
  const model = normalizeModel(input.model)
  checkBinFiles(model)
  const items = readStore()
  const idx = input.id ? items.findIndex((x) => x.id === input.id) : -1
  if (input.id && idx < 0) throw new Error('Эта стратегия уже удалена')
  if (items.some((x, i) => i !== idx && sameName(x.name, nm.name))) throw new Error(`Стратегия «${nm.name}» уже есть — выберите другое название`)
  if (idx < 0 && items.length >= MAX_ITEMS) throw new Error(`Своих стратегий не больше ${MAX_ITEMS} — удалите ненужные`)
  // Встроенная стратегия с тем же именем файла (маловероятно, но не перетираем чужое).
  const file = customFileName(nm.name)
  const prevFile = idx >= 0 ? customFileName(items[idx].name) : null
  if (file !== prevFile && existsSync(path.join(dir, file)) && !items.some((x) => customFileName(x.name) === file)) {
    const owned = modelFromBatComment(readFileSync(path.join(dir, file), 'utf-8'))
    if (!owned) throw new Error(`Файл ${file} уже есть в папке Zapret — выберите другое название`)
  }
  const now = Date.now()
  const item: Omit<CustomStrategy, 'file'> =
    idx >= 0
      ? { ...items[idx], name: nm.name, model, updatedAt: now }
      : {
          id: newId(),
          name: nm.name,
          model,
          origin: input.origin ?? 'manual',
          basedOn: typeof input.basedOn === 'string' ? input.basedOn.slice(0, 80) : undefined,
          createdAt: now,
          updatedAt: now
        }
  writeBat(dir, item.name, item.model)
  if (idx >= 0) items[idx] = item
  else items.push(item)
  writeStore(items)
  // Переименование: новый файл уже есть — переключаем выбранную стратегию и убираем старый.
  if (prevFile && prevFile !== file) {
    const cfg = await getAppConfig()
    if (cfg.zapret?.activeStrategy === prevFile) {
      await patchAppConfig({ zapret: { ...cfg.zapret, activeStrategy: file } })
    }
    try {
      unlinkSync(path.join(dir, prevFile))
    } catch {
      /* файл занят или уже удалён — он без записи в списке, вреда нет */
    }
  }
  return withFile(item)
}

export async function deleteCustomStrategy(id: string): Promise<void> {
  const items = readStore()
  const idx = items.findIndex((x) => x.id === id)
  if (idx < 0) return
  const file = customFileName(items[idx].name)
  const cfg = await getAppConfig()
  if (cfg.zapret?.activeStrategy === file) {
    throw new Error('Эта стратегия выбрана сейчас — сначала выберите другую')
  }
  items.splice(idx, 1)
  writeStore(items)
  const dir = bundleDir()
  if (dir) {
    try {
      unlinkSync(path.join(dir, file))
    } catch {
      /* нет файла */
    }
  }
}

export function exportCustomStrategy(id: string): string {
  const it = readStore().find((x) => x.id === id)
  if (!it) throw new Error('Стратегия не найдена')
  return exportStrategyText(it.name, it.model)
}

/** Импорт текстом: сохраняет под свободным названием («Дом», «Дом 2», …). */
export async function importCustomStrategy(text: unknown): Promise<CustomStrategy> {
  const { name, model } = importStrategyText(typeof text === 'string' ? text : '')
  const items = readStore()
  let candidate = name
  for (let i = 2; items.some((x) => sameName(x.name, candidate)); i++) candidate = `${name.slice(0, 36)} ${i}`
  return saveCustomStrategy({ name: candidate, model, origin: 'import' })
}

/** Предпросмотр: командная строка и текст .bat. */
export function previewCustomModel(raw: unknown, name: unknown): { command: string; bat: string; model: StrategyModel } {
  const model = normalizeModel(raw)
  const nm = checkCustomName(name)
  return { command: renderCommandPreview(model), bat: generateBat(model, nm.ok ? nm.name : 'Без названия'), model }
}

/** Модель по стратегии из папки сборки (встроенной или своей) — для «Создать на основе». */
export function modelFromStrategyFile(file: unknown): { model: StrategyModel; approximate: boolean; title: string } {
  if (!isSafeStrategyFileName(file)) throw new Error('Недопустимое имя стратегии')
  const own = readStore().find((x) => customFileName(x.name) === file)
  if (own) return { model: own.model, approximate: false, title: own.name }
  const full = path.join(zapretBundleDir(), file)
  if (!existsSync(full)) throw new Error('Стратегия не найдена в папке Zapret')
  const parsed = parseBatToModel(readFileSync(full, 'utf-8'))
  if (!parsed) throw new Error('В этой стратегии не удалось узнать приём для TCP — начните с пустого конструктора')
  return { ...parsed, title: file.replace(/\.bat$/i, '') }
}
