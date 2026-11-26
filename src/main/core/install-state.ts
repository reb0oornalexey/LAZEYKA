/**
 * Новая установка или обновление.
 *
 * Нужно, чтобы при самом первом запуске показать короткое «Знакомство», а
 * «Что нового» — только тем, у кого уже стояла прошлая версия.
 *
 * Как отличаем. Рядом с config.yaml лежит install-state.json с последней
 * запущенной версией. Если файла нет:
 *  - config.yaml уже есть → программа стояла раньше (версия до 1.3.0, где
 *    этого файла ещё не было) — это обновление;
 *  - config.yaml нет → чистая установка.
 * Проверка идёт до init(), то есть до того, как программа сама создаст
 * config.yaml, — поэтому captureInstallState() вызывается в index.ts сразу
 * после app.setName (имя задаёт папку данных: у dev-сборки своя папка
 * lazeyka-dev, у установленной — lazeyka; портативная — data рядом с exe).
 *
 * «Последняя запущенная версия» записывается только когда окно программы
 * подтвердило запуск (install:ack). Копия без прав администратора, которая
 * только перезапускает себя через UAC, окна не открывает и состояние «новая
 * установка» не сбивает.
 */
import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import path from 'path'
import { appConfigPath, dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'

interface StoredState {
  /** Последняя версия, окно которой открывалось. null — ещё ни разу. */
  lastVersion: string | null
  /** Файл создан при чистой установке (до этого не было config.yaml). */
  fresh: boolean
}

export interface InstallState {
  /** Чистая установка: программа запускается впервые. */
  fresh: boolean
  /** Версия, которая запускалась до этого; 'legacy' — была версия старше 1.3.0. */
  previousVersion: string | null
  version: string
}

let captured: InstallState | null = null

function statePath(): string {
  return path.join(dataDir(), 'install-state.json')
}

function readStored(): StoredState | null {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<StoredState>
    return {
      lastVersion: typeof raw.lastVersion === 'string' ? raw.lastVersion : null,
      fresh: raw.fresh === true
    }
  } catch {
    return null
  }
}

function writeStored(s: StoredState): void {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileAtomic(statePath(), JSON.stringify(s, null, 2))
  } catch {
    /* не записалось — в худшем случае знакомство покажется ещё раз */
  }
}

/** Вызывать один раз в начале запуска, до init() (он создаёт config.yaml). */
export function captureInstallState(): void {
  if (captured) return
  const hadConfig = existsSync(appConfigPath())
  let stored = readStored()
  if (!stored) {
    stored = { lastVersion: hadConfig ? 'legacy' : null, fresh: !hadConfig }
    writeStored(stored)
  }
  captured = decideInstallState(stored, hadConfig, app.getVersion())
}

/** Чистая функция для проверки: что показать при запуске. */
export function decideInstallState(stored: StoredState | null, hadConfig: boolean, version: string): InstallState {
  const s = stored ?? { lastVersion: hadConfig ? 'legacy' : null, fresh: !hadConfig }
  return { fresh: s.fresh && s.lastVersion === null, previousVersion: s.lastVersion, version }
}

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

export function registerInstallStateIpc(): void {
  ipcMain.handle(
    'install:state',
    h((): InstallState => {
      if (!captured) captureInstallState()
      return captured as InstallState
    })
  )
  // Окно открылось: запоминаем текущую версию как последнюю запущенную.
  ipcMain.handle(
    'install:ack',
    h((): void => {
      writeStored({ lastVersion: app.getVersion(), fresh: false })
    })
  )
}
