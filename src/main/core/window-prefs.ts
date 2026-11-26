/**
 * Е6: настройки основного окна — «поверх всех окон», масштаб всего окна,
 * «сбросить размер и положение».
 *
 * Масштаб — webContents.setZoomFactor основного окна. Почему так, а не CSS zoom:
 * CSS-зум на корне раздувает единицы vh (h-screen становится выше окна).
 * Почему нужен webPreferences.zoomFactor ≠ 1 при создании окна (MAIN_ZOOM_SEED):
 * Chromium хранит масштаб по адресу страницы, и у file://…index.html#/settings
 * каждый раздел (hash) — свой адрес, так что масштаб сбрасывался бы на каждом
 * переходе, а при обычном пути мог бы достаться мини-окну. Если окно создано с
 * zoomFactor ≠ 1, Electron держит его масштаб «временным», только для этого
 * окна: переходы его не сбрасывают, мини-окно и окно обновления не задевает.
 * Проверено опытом на Electron 37 (file://). В режиме разработки (адрес
 * http://127.0.0.1:5173) Chromium хранит масштаб на весь адрес — там мини-окно
 * тоже увеличится; в собранной программе — нет.
 */
import { BrowserWindow, screen } from 'electron'
import { getAppConfigSync } from '../config'
import { appLog } from '../utils/app-logger'

/** Допустимые значения масштаба окна. */
export const WINDOW_ZOOMS = [0.9, 1, 1.1, 1.25] as const

/**
 * Начальный zoomFactor окна: сам масштаб из настроек (окно сразу рисуется в
 * нём), а для 100 % — чуть больше 1, чтобы масштаб был только у этого окна.
 */
export function mainZoomSeed(cfg: AppConfig): number {
  const z = normalizeZoom(cfg.windowZoom)
  return z === 1 ? 1.01 : z
}

export function normalizeZoom(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  // Ближайшее допустимое значение — в конфиг могли руками вписать 1.2.
  let best = 1
  for (const z of WINDOW_ZOOMS) if (Math.abs(z - n) < Math.abs(best - n)) best = z
  return best
}

let main: BrowserWindow | null = null

function alive(w: BrowserWindow | null): w is BrowserWindow {
  return Boolean(w && !w.isDestroyed() && !w.webContents.isDestroyed())
}

function applyZoom(w: BrowserWindow, cfg: AppConfig = getAppConfigSync(), force = false): void {
  if (!alive(w)) return
  const want = normalizeZoom(cfg.windowZoom)
  try {
    // force: после загрузки ставим явно, даже если значение уже то же — иначе
    // масштаб из webPreferences слетает на первом переходе между разделами.
    if (force || Math.abs(w.webContents.getZoomFactor() - want) > 0.001) w.webContents.setZoomFactor(want)
  } catch (e) {
    appLog('warn', `масштаб окна: ${e}`)
  }
}

function applyOnTop(w: BrowserWindow, cfg: AppConfig = getAppConfigSync()): void {
  if (!alive(w)) return
  const on = cfg.windowAlwaysOnTop === true
  try {
    if (w.isAlwaysOnTop() !== on) w.setAlwaysOnTop(on)
  } catch (e) {
    appLog('warn', `поверх всех окон: ${e}`)
  }
}

/** Подключить основное окно: вызывается сразу после new BrowserWindow. */
export function attachMainWindowPrefs(w: BrowserWindow, cfg?: AppConfig): void {
  main = w
  applyOnTop(w, cfg)
  // Масштаб ставится после загрузки и проверяется при переходах внутри страницы.
  w.webContents.on('did-finish-load', () => applyZoom(w, undefined, true))
  w.webContents.on('did-navigate-in-page', () => applyZoom(w))
  w.on('closed', () => {
    if (main === w) main = null
  })
}

/** После изменения конфига (patch, сброс, импорт профиля). */
export function applyMainWindowPrefs(): void {
  const w = main
  if (!alive(w)) return
  const cfg = getAppConfigSync()
  applyOnTop(w, cfg)
  applyZoom(w, cfg)
}

/** Размер окна по умолчанию с поправкой на экран (как при первом запуске). */
export function defaultWindowBounds(
  work: { x: number; y: number; width: number; height: number },
  w: number,
  h: number
): { x: number; y: number; width: number; height: number } {
  const width = Math.max(860, Math.min(w, work.width - 40))
  const height = Math.max(600, Math.min(h, work.height - 40))
  return {
    width,
    height,
    x: Math.round(work.x + (work.width - width) / 2),
    y: Math.round(work.y + (work.height - height) / 2)
  }
}

/**
 * Вернуть окно к размеру по умолчанию по центру основного монитора.
 * window-state.json перезапишется сам: на resize/move в index.ts висит запись.
 */
export function resetMainWindowBounds(defW: number, defH: number): { width: number; height: number } {
  const w = main
  if (!alive(w)) throw new Error('Окно программы не найдено')
  if (w.isFullScreen()) w.setFullScreen(false)
  if (w.isMaximized()) w.unmaximize()
  if (w.isMinimized()) w.restore()
  const b = defaultWindowBounds(screen.getPrimaryDisplay().workArea, defW, defH)
  w.setBounds(b)
  if (!w.isVisible()) w.show()
  w.focus()
  appLog('info', `Размер и положение окна сброшены: ${b.width}×${b.height}`)
  return { width: b.width, height: b.height }
}
