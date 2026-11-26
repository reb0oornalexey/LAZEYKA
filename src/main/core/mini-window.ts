/**
 * Мини-окно: маленькое обычное окно программы поверх остальных окон.
 *
 * Это НЕ оверлей: окно ничего не встраивает в игру, не ставит хуков и не
 * читает чужие процессы. Оно такое же, как окно обновления, только маленькое,
 * без рамки и «поверх всех» (уровень 'screen-saver').
 *
 * Где его видно поверх игры:
 *  - Windows: игра «в окне» / «в окне без рамки», а также «полноэкранный» режим DX11/DX12,
 *    который Windows 10/11 на деле ведёт как окно без рамки («оптимизация во весь экран»).
 *    Настоящий эксклюзивный полноэкранный режим обычное окно не перекрывает — только
 *    внедрение в игру (как RivaTuner), а его здесь нет и не будет (античиты).
 *  - macOS: окно-панель (type 'panel') с уровнем 'screen-saver' видно и поверх
 *    полноэкранных приложений в их отдельном рабочем столе.
 * Игра, получая фокус, может поднять себя выше. Пока мини-окно показано, раз в 2 с и
 * когда наше окно теряет фокус, «поверх всех» утверждается заново (без отбора фокуса).
 * Таймер живёт только пока окно показано.
 *
 * Рендерер тот же (index.html), маршрут — `#/mini`: main.tsx рисует для него
 * только мини-окно, без сайдбара и сторов главного окна.
 *
 * Пока окно закрыто, никаких таймеров и подписок здесь нет: всё создаётся при
 * открытии и снимается при закрытии.
 *
 * Место окна. Для каждого вида (панель, индикатор) хранятся свои координаты, размер и
 * снимок экрана, на котором окно стояло (mini-window.json: x/y/w/h/pDisplay и ix/iy/iw/ih/iDisplay).
 * Позиция пишется при перемещении (через полсекунды покоя), перед закрытием и при выходе.
 * При открытии сохранённое место сверяется с подключёнными экранами (mini-placement.ts):
 * не влезает — окно уезжает на ближайший экран с тем же отступом от того же угла.
 * Размер окна задаёт содержимое индикатора (mini:fit): верхняя половина экрана — окно растёт вниз,
 * нижняя — вверх, правая — влево.
 *
 * IPC: mini:open, mini:close, mini:toggle, mini:state, mini:getSettings,
 * mini:setSettings, mini:fit, mini:openMain, mini:flash. Событие для всех окон: mini:changed;
 * только мини-окну: mini:flash (подсветить рамку на N мс).
 */
import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { hardenAppWindow } from '../utils/safe-open'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { appLog } from '../utils/app-logger'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import {
  anchoredResize,
  defaultPlacement,
  parseDisplayInfo,
  resolvePlacement,
  type DisplayInfo,
  type Rect
} from './mini-placement'

const ROUTE = '/mini'
const WIDTH = 260
const HEIGHT = 150
/** Индикатор: только включённые службы зелёными точками, без кнопок. */
const IND_WIDTH = 168
const IND_HEIGHT = 118
/** Индикатору можно быть прозрачнее панели: на нём нет кнопок. */
const IND_MIN_OPACITY = 30
const MIN_OPACITY = 60
const MAX_OPACITY = 100

export type MiniMode = 'panel' | 'indicator'

export interface MiniSettings {
  /** Прозрачность панели, %, 60–100. */
  opacity: number
  x?: number
  y?: number
  /** panel — переключатели и пинг; indicator — только что включено. */
  mode: MiniMode
  /** Индикатор закреплён: клики проходят сквозь него в игру, перетащить нельзя. */
  locked: boolean
  /** Отдельные прозрачность и место индикатора. */
  indOpacity: number
  ix?: number
  iy?: number
  /** Размер и экран панели при последнем сохранении места. */
  w?: number
  h?: number
  pDisplay?: DisplayInfo
  /** То же для индикатора. */
  iw?: number
  ih?: number
  iDisplay?: DisplayInfo
}

export interface MiniState {
  open: boolean
  opacity: number
  mode: MiniMode
  locked: boolean
  indOpacity: number
}

let win: BrowserWindow | null = null
let settings: MiniSettings | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let displayListening = false
/** Вид, с которым создано текущее окно (s.mode успевает смениться раньше). */
let winMode: MiniMode = 'panel'
/** Пока не вышло это время, события move считаем нашими же (setBounds), а не рукой пользователя. */
let ignoreMoveUntil = 0
/** Когда в последний раз менялись экраны: ОС сама двигает окна, это не выбор пользователя. */
let lastDisplayEventAt = 0
let displayTimer: ReturnType<typeof setTimeout> | null = null

const settingsFile = (): string => join(dataDir(), 'mini-window.json')

export function clampOpacity(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return MAX_OPACITY
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, n))
}

export function clampIndOpacity(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 90
  return Math.min(MAX_OPACITY, Math.max(IND_MIN_OPACITY, n))
}

const MIN_SIDE = 40
const MAX_SIDE = 700
const sideOk = (v: number | undefined): v is number => v !== undefined && v >= MIN_SIDE && v <= MAX_SIDE

function loadSettings(): MiniSettings {
  if (settings) return settings
  let raw: Partial<MiniSettings> = {}
  try {
    if (existsSync(settingsFile())) raw = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Partial<MiniSettings>
  } catch {
    raw = {}
  }
  const num = (v: unknown): number | undefined => (Number.isFinite(v) ? Math.round(v as number) : undefined)
  settings = {
    opacity: clampOpacity(raw.opacity ?? MAX_OPACITY),
    x: num(raw.x),
    y: num(raw.y),
    mode: raw.mode === 'indicator' ? 'indicator' : 'panel',
    locked: raw.locked !== false,
    indOpacity: clampIndOpacity(raw.indOpacity ?? 90),
    ix: num(raw.ix),
    iy: num(raw.iy),
    w: num(raw.w),
    h: num(raw.h),
    pDisplay: parseDisplayInfo(raw.pDisplay),
    iw: num(raw.iw),
    ih: num(raw.ih),
    iDisplay: parseDisplayInfo(raw.iDisplay)
  }
  return settings
}

function saveSettingsNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!settings) return
  try {
    writeFileAtomic(settingsFile(), JSON.stringify(settings))
  } catch (e) {
    appLog('warn', `[mini] не удалось сохранить настройки мини-окна: ${String(e)}`)
  }
}

function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}
function saveNow(): void {
  saveTimer = null
  saveSettingsNow()
}

// ---- место окна ---------------------------------------------------------------------

function displayInfos(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: { ...d.workArea }, scaleFactor: d.scaleFactor }))
}

function infoOf(d: Electron.Display): DisplayInfo {
  return { id: d.id, workArea: { ...d.workArea }, scaleFactor: d.scaleFactor }
}

const primaryId = (): number => screen.getPrimaryDisplay().id

function defaultSize(mode: MiniMode): { width: number; height: number } {
  return mode === 'indicator' ? { width: IND_WIDTH, height: IND_HEIGHT } : { width: WIDTH, height: HEIGHT }
}

/** Сохранённое место вида: координаты, размер и экран. */
function savedPlace(mode: MiniMode): { x: number; y: number; width: number; height: number; display?: DisplayInfo } | null {
  const s = loadSettings()
  const ind = mode === 'indicator'
  const x = ind ? s.ix : s.x
  const y = ind ? s.iy : s.y
  if (x === undefined || y === undefined) return null
  const w = ind ? s.iw : s.w
  const h = ind ? s.ih : s.h
  const def = defaultSize(mode)
  return { x, y, width: sideOk(w) ? w : def.width, height: sideOk(h) ? h : def.height, display: ind ? s.iDisplay : s.pDisplay }
}

/** Запомнить границы окна как место его вида. Запись на диск — через saveSoon. */
function rememberBounds(mode: MiniMode, b: Rect): void {
  const s = loadSettings()
  const display = infoOf(screen.getDisplayMatching(b))
  if (mode === 'indicator') {
    s.ix = b.x
    s.iy = b.y
    s.iw = b.width
    s.ih = b.height
    s.iDisplay = display
  } else {
    s.x = b.x
    s.y = b.y
    s.w = b.width
    s.h = b.height
    s.pDisplay = display
  }
}

/** Запомнить текущее место живого окна (перед закрытием, сменой вида, выходом). */
function captureWindow(w: BrowserWindow | null, mode: MiniMode): void {
  if (!w || w.isDestroyed() || w.isMinimized()) return
  if (Date.now() - lastDisplayEventAt < 1500) return
  rememberBounds(mode, w.getBounds())
}

/** Куда ставить окно этого вида при создании: сохранённое место, проверенное по экранам, либо по умолчанию. */
function startBounds(mode: MiniMode): Rect {
  const saved = savedPlace(mode)
  const displays = displayInfos()
  const size = saved ? { width: saved.width, height: saved.height } : defaultSize(mode)
  const placed = saved ? resolvePlacement(saved, size, displays, primaryId()) : null
  const pos = placed ?? defaultPlacement(size, displays, primaryId())
  return { x: pos.x, y: pos.y, width: size.width, height: size.height }
}

/** Границы, которые мы последний раз сами задали окну (при создании, по размеру содержимого, после смены экранов). */
let expected: Rect | null = null

function setBoundsQuiet(w: BrowserWindow, b: Rect): void {
  expected = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  ignoreMoveUntil = Date.now() + 400
  w.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) })
}

function emitChanged(): void {
  const state = getState()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) {
      try {
        w.webContents.send('mini:changed', state)
      } catch { /* окно закрывается */ }
    }
  }
}

function getState(): MiniState {
  const s = loadSettings()
  return { open: isMiniWindowOpen(), opacity: s.opacity, mode: s.mode, locked: s.locked, indOpacity: s.indOpacity }
}

export function isMiniWindowOpen(): boolean {
  return !!win && !win.isDestroyed()
}

/**
 * Экран отключили, подключили или сменили разрешение. Окно ставится заново по СОХРАНЁННОМУ месту,
 * а не по тому, куда его сдвинула система: если экран вернётся, окно вернётся на своё место.
 */
function onDisplayChanged(): void {
  lastDisplayEventAt = Date.now()
  if (displayTimer) clearTimeout(displayTimer)
  displayTimer = setTimeout(() => {
    displayTimer = null
    const w = win
    if (!w || w.isDestroyed()) return
    const cur = w.getBounds()
    const saved = savedPlace(winMode)
    const displays = displayInfos()
    const placed = saved ? resolvePlacement(saved, { width: cur.width, height: cur.height }, displays, primaryId()) : null
    const pos = placed ?? defaultPlacement(cur, displays, primaryId())
    if (pos.x !== cur.x || pos.y !== cur.y) setBoundsQuiet(w, { x: pos.x, y: pos.y, width: cur.width, height: cur.height })
    // Игра сменила разрешение экрана при входе в полноэкранный режим — заново встаём наверх.
    reassertTop(w)
    // Позже ОС ещё может двигать окно сама; пользовательские перемещения снова пишутся через 1,5 с.
    lastDisplayEventAt = Date.now()
  }, 300)
}

function listenDisplays(on: boolean): void {
  if (on === displayListening) return
  displayListening = on
  const fn = on ? screen.on.bind(screen) : screen.removeListener.bind(screen)
  fn('display-removed', onDisplayChanged)
  fn('display-added', onDisplayChanged)
  fn('display-metrics-changed', onDisplayChanged)
  if (!on && displayTimer) {
    clearTimeout(displayTimer)
    displayTimer = null
  }
}

/**
 * «Поверх всех» самого высокого обычного уровня. relativeLevel 1 — на ступень выше других
 * окон этого уровня (на macOS; на Windows уровень один — HWND_TOPMOST).
 */
function keepOnTop(w: BrowserWindow): void {
  w.setAlwaysOnTop(true, 'screen-saver', 1)
  if (process.platform === 'darwin') {
    // visibleOnFullScreen — показываться и в рабочем столе полноэкранного приложения.
    // skipTransformProcessType: без него Electron прячет значок LAZEYKA в Dock, пока окно открыто;
    // поверх полноэкранных приложений окно выводит тип 'panel' (задан при создании).
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }
}

// ---- удержание поверх игры -------------------------------------------------------------

/** Как часто заново утверждать «поверх всех», пока окно показано. */
const TOP_GUARD_MS = 2_000
let topGuard: { w: BrowserWindow; timer: ReturnType<typeof setInterval> } | null = null

/** Поднять окно наверх без отбора фокуса: игра могла встать выше, получив фокус. */
function reassertTop(w: BrowserWindow): void {
  if (w.isDestroyed() || !w.isVisible() || w.isMinimized()) return
  try {
    // Флаг «поверх всех» мог сбросить чужой код или смена режима экрана — ставим заново.
    // moveTop() поднимает окно в начало слоя «поверх всех» и не активирует его (фокус остаётся у игры).
    w.setAlwaysOnTop(true, 'screen-saver', 1)
    // moveTop на Windows передаёт текущие координаты — это не перемещение пользователем.
    ignoreMoveUntil = Date.now() + 400
    w.moveTop()
  } catch { /* окно закрывается */ }
}

function onAnyWindowBlur(): void {
  const w = win
  // Наше окно потеряло фокус — скорее всего, пользователь переключился в игру.
  if (w && !w.isDestroyed()) setTimeout(() => reassertTop(w), 150)
}

function startTopGuard(w: BrowserWindow): void {
  if (topGuard?.w === w) return
  stopTopGuard()
  const timer = setInterval(() => reassertTop(w), TOP_GUARD_MS)
  topGuard = { w, timer }
  app.on('browser-window-blur', onAnyWindowBlur)
}

/** Остановить удержание (для конкретного окна — только если таймер его). */
function stopTopGuard(w?: BrowserWindow): void {
  if (!topGuard || (w && topGuard.w !== w)) return
  clearInterval(topGuard.timer)
  topGuard = null
  app.removeListener('browser-window-blur', onAnyWindowBlur)
}

// ---- «Проверить»: подсветка рамки -------------------------------------------------------

const FLASH_MS = 5_000
let flashTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Показать окно (если закрыто — открыть) и на 5 с ярко подсветить его рамку, чтобы было видно, где оно.
 * На время подсветки окно становится непрозрачным. Пропуск кликов у закреплённого индикатора
 * не меняется — в игре он мешать не начнёт.
 */
export function flashMiniWindow(): void {
  if (!isMiniWindowOpen()) openMiniWindow()
  const w = win
  if (!w || w.isDestroyed()) return
  const send = (): void => {
    if (w.isDestroyed()) return
    reassertTop(w)
    w.setOpacity(1)
    try {
      w.webContents.send('mini:flash', FLASH_MS)
    } catch { /* окно закрывается */ }
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashTimer = null
      if (w.isDestroyed() || win !== w) return
      const s = loadSettings()
      w.setOpacity((winMode === 'indicator' ? s.indOpacity : s.opacity) / 100)
    }, FLASH_MS)
  }
  // Только что созданное окно ещё грузит страницу — подсветку отправляем после загрузки.
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(send, 300))
  else send()
}

export function openMiniWindow(): void {
  try {
    if (win && !win.isDestroyed()) {
      // showInactive: не забираем фокус у игры.
      if (!win.isVisible()) win.showInactive()
      startTopGuard(win)
      return
    }
    const mode = loadSettings().mode
    const indicator = mode === 'indicator'
    const start = startBounds(mode)
    winMode = mode
    expected = start
    win = new BrowserWindow({
      width: start.width,
      height: start.height,
      x: start.x,
      y: start.y,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // macOS: окно-панель видно поверх полноэкранных приложений и не активирует LAZEYKA при клике.
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      // Не забираем фокус у игры; клики по кнопкам при этом проходят.
      focusable: false,
      title: indicator ? 'LAZEYKA — индикатор' : 'LAZEYKA — мини-окно',
      icon,
      // У индикатора нет своего фона: видна только плашка со службами.
      transparent: indicator,
      hasShadow: !indicator,
      backgroundColor: indicator ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#eef1f4',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: true
      }
    })
    const w = win
    keepOnTop(w)
    w.setOpacity((indicator ? loadSettings().indOpacity : loadSettings().opacity) / 100)
    // Закреплённый индикатор не перехватывает мышь: клики уходят в то, что под ним.
    if (indicator && loadSettings().locked) w.setIgnoreMouseEvents(true)
    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return
      // Windows создаёт окно с координатами в масштабе основного экрана; на втором мониторе с другим
      // масштабом оно могло сместиться. Повторная установка границ ставит его туда, куда нужно.
      setBoundsQuiet(w, expected ?? start)
      w.showInactive()
      keepOnTop(w)
      startTopGuard(w)
    })
    // Удержание поверх игры — только пока окно показано.
    w.on('show', () => startTopGuard(w))
    w.on('hide', () => stopTopGuard(w))
    // Перемещение руками: запоминаем место сразу, на диск пишем через полсекунды покоя.
    const onMoved = (): void => {
      if (w.isDestroyed() || win !== w) return
      if (Date.now() < ignoreMoveUntil || Date.now() - lastDisplayEventAt < 1500) return
      rememberBounds(winMode, w.getBounds())
      saveSoon()
    }
    w.on('move', onMoved)
    w.on('moved', onMoved)
    // Закрытие: окно ещё живое, берём точное место и пишем на диск сразу.
    w.on('close', () => {
      if (win === w) {
        captureWindow(w, winMode)
        saveSettingsNow()
      }
    })
    w.on('closed', () => {
      // Таймер этого окна снимаем всегда, даже если окно уже заменено (смена вида).
      stopTopGuard(w)
      if (win === w) {
        win = null
        // Слушатели экранов снимаем только если за это время не открыто новое окно.
        listenDisplays(false)
        emitChanged()
      }
    })
    // Ссылки из заметок к релизам и т. п. — только http/https; переход окна на чужой адрес запрещён.
    hardenAppWindow(w)
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    listenDisplays(true)
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${ROUTE}`)
    } else {
      void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: ROUTE })
    }
    appLog('info', indicator ? '[mini] открыт индикатор' : '[mini] открыто мини-окно')
    emitChanged()
  } catch (e) {
    appLog('warn', `[mini] не удалось открыть мини-окно: ${String(e)}`)
  }
}

export function closeMiniWindow(): void {
  if (win && !win.isDestroyed()) win.close()
}

/** Показать, если закрыто; закрыть, если открыто. */
export function toggleMiniWindow(): void {
  if (isMiniWindowOpen()) closeMiniWindow()
  else openMiniWindow()
}

/** Вызвать при выходе из программы: сохранить позицию и закрыть окно без ожидания. */
export function closeMiniWindowOnQuit(): void {
  try {
    captureWindow(win, winMode)
    saveSettingsNow()
    listenDisplays(false)
    stopTopGuard()
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
    if (win && !win.isDestroyed()) win.destroy()
    win = null
  } catch { /* выходим */ }
}

/**
 * Размер окна по содержимому (его сообщает сам индикатор). Окно меняется вокруг якоря:
 * верхняя половина экрана — верхний край на месте, нижняя — нижний; правая — правый край, левая — левый.
 */
export function fitMiniWindow(width: number, height: number): void {
  const w = win
  if (!w || w.isDestroyed()) return
  const clamp = (v: number): number => Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, v)))
  const next = { width: clamp(width), height: clamp(height) }
  const cur = w.getBounds()
  if (next.width === cur.width && next.height === cur.height) return
  const b = anchoredResize(cur, next, displayInfos(), primaryId())
  setBoundsQuiet(w, b)
  // Новый размер и место — тоже выбор пользователя: следующее открытие начнётся с него.
  if (Date.now() - lastDisplayEventAt >= 1500) {
    rememberBounds(winMode, b)
    saveSoon()
  }
}

// ---- IPC ----------------------------------------------------------------------------

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

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, h(fn))
}

/** Смена вида окна. Открытое окно пересоздаётся (прозрачность задаётся при создании). */
function switchMode(next: MiniMode): void {
  const s = loadSettings()
  if (next === s.mode) return
  const wasOpen = !!win && !win.isDestroyed()
  const oldMode = s.mode
  let oldBounds: Rect | null = null
  if (wasOpen) {
    const old = win!
    // Место старого вида запоминаем до уничтожения: у каждого вида свои координаты.
    captureWindow(old, oldMode)
    oldBounds = old.getBounds()
    win = null
    old.destroy()
  }
  s.mode = next
  // У нового вида своего места ещё нет: берём то же место на экране, якорем к тому же углу.
  if (wasOpen && oldBounds && !savedPlace(s.mode)) {
    rememberBounds(s.mode, anchoredResize(oldBounds, defaultSize(s.mode), displayInfos(), primaryId()))
  }
  saveSettingsNow()
  if (wasOpen) openMiniWindow()
}

/** Сценарии: показать панель или индикатор либо скрыть окно. */
export function applyMiniFromScenario(action: 'panel' | 'indicator' | 'hide'): void {
  if (action === 'hide') {
    closeMiniWindow()
    return
  }
  switchMode(action)
  openMiniWindow()
  saveSoon()
  emitChanged()
}

export function registerMiniIpc(): void {
  handle('mini:open', () => {
    openMiniWindow()
    return getState()
  })
  handle('mini:close', () => {
    closeMiniWindow()
    return { ...getState(), open: false }
  })
  handle('mini:toggle', () => {
    toggleMiniWindow()
    return getState()
  })
  handle('mini:state', () => getState())
  handle('mini:getSettings', () => {
    const s = loadSettings()
    return { opacity: s.opacity, mode: s.mode, locked: s.locked, indOpacity: s.indOpacity }
  })
  handle('mini:setSettings', (patch) => {
    const p = (patch ?? {}) as { opacity?: unknown; mode?: unknown; locked?: unknown; indOpacity?: unknown }
    const s = loadSettings()
    const alive = (): boolean => !!win && !win.isDestroyed()
    if (p.opacity !== undefined) {
      s.opacity = clampOpacity(p.opacity)
      if (alive() && s.mode === 'panel') win!.setOpacity(s.opacity / 100)
    }
    if (p.indOpacity !== undefined) {
      s.indOpacity = clampIndOpacity(p.indOpacity)
      if (alive() && s.mode === 'indicator') win!.setOpacity(s.indOpacity / 100)
    }
    if (p.locked !== undefined) {
      s.locked = p.locked === true
      if (alive() && s.mode === 'indicator') win!.setIgnoreMouseEvents(s.locked)
    }
    if (p.mode === 'panel' || p.mode === 'indicator') switchMode(p.mode)
    saveSoon()
    emitChanged()
    return { opacity: s.opacity, mode: s.mode, locked: s.locked, indOpacity: s.indOpacity }
  })
  handle('mini:fit', (size) => {
    const v = (size ?? {}) as { width?: unknown; height?: unknown }
    const wd = Number(v.width)
    const ht = Number(v.height)
    if (Number.isFinite(wd) && Number.isFinite(ht)) fitMiniWindow(wd, ht)
  })
  handle('mini:flash', () => {
    flashMiniWindow()
    return getState()
  })
  handle('mini:openMain', async () => {
    const m = await import('../index')
    await m.showMainWindow()
  })
}
