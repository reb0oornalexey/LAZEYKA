/**
 * Расчёт места мини-окна. Чистые функции без Electron: их проверяют отдельным node-скриптом.
 *
 * Все числа — в «логических» пикселях Electron (DIP), как у screen.getAllDisplays().workArea
 * и у BrowserWindow.getBounds(). Поэтому разный масштаб мониторов (100 %, 150 %) отдельного
 * пересчёта не требует: окно задано в тех же единицах, что и рабочая область.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  /** Рабочая область без панели задач и меню. Координаты могут быть отрицательными. */
  workArea: Rect
  scaleFactor: number
}

export interface SavedPlace {
  x: number
  y: number
  /** Экран, на котором окно стояло при сохранении. Нет — запись от старой версии. */
  display?: DisplayInfo
}

export interface Size {
  width: number
  height: number
}

export interface Placement {
  x: number
  y: number
  /** exact — сохранённое место подошло как есть; moved — пришлось сдвинуть. */
  kind: 'exact' | 'moved'
  reason?: 'display-gone' | 'resolution-changed' | 'off-screen'
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Окно целиком лежит внутри области. */
export function rectInside(r: Rect, area: Rect): boolean {
  return r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height
}

/** Расстояние от прямоугольника до области (0 — пересекаются). */
export function rectDistance(r: Rect, area: Rect): number {
  const dx = Math.max(area.x - (r.x + r.width), r.x - (area.x + area.width), 0)
  const dy = Math.max(area.y - (r.y + r.height), r.y - (area.y + area.height), 0)
  return Math.hypot(dx, dy)
}

function overlapArea(r: Rect, area: Rect): number {
  const w = Math.min(r.x + r.width, area.x + area.width) - Math.max(r.x, area.x)
  const h = Math.min(r.y + r.height, area.y + area.height) - Math.max(r.y, area.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Ближайший к окну экран: сначала по площади пересечения, потом по расстоянию. */
export function nearestDisplay(r: Rect, displays: DisplayInfo[], primaryId?: number): DisplayInfo | null {
  let best: DisplayInfo | null = null
  let bestOverlap = -1
  let bestDist = Infinity
  for (const d of displays) {
    const o = overlapArea(r, d.workArea)
    const dist = rectDistance(r, d.workArea)
    const better =
      o > bestOverlap ||
      (o === bestOverlap && dist < bestDist) ||
      (o === bestOverlap && dist === bestDist && best && d.id === primaryId && best.id !== primaryId)
    if (better) {
      best = d
      bestOverlap = o
      bestDist = dist
    }
  }
  return best
}

/** Тот же экран, что был при сохранении: по номеру, а если номер сменился — по границам и масштабу. */
export function findSavedDisplay(saved: DisplayInfo, displays: DisplayInfo[]): DisplayInfo | null {
  const byId = displays.find((d) => d.id === saved.id)
  if (byId) return byId
  return displays.find((d) => d.scaleFactor === saved.scaleFactor && sameRect(d.workArea, saved.workArea)) ?? null
}

function clampInto(x: number, y: number, size: Size, area: Rect): { x: number; y: number } {
  const maxX = area.x + area.width - size.width
  const maxY = area.y + area.height - size.height
  // Окно больше области — прижимаем к левому верхнему углу.
  const cx = Math.max(area.x, Math.min(x, Math.max(area.x, maxX)))
  const cy = Math.max(area.y, Math.min(y, Math.max(area.y, maxY)))
  return { x: Math.round(cx), y: Math.round(cy) }
}

/**
 * Куда поставить окно при открытии.
 *  - Сохранённое место целиком видно и экран тот же — берём его как есть.
 *  - Экран отключили или сменилось разрешение — переносим на ближайший экран, сохраняя
 *    отступ от того же угла (правая половина — от правого края, нижняя — от нижнего).
 *  - Сохранённого места нет — null, вызывающий берёт место по умолчанию.
 */
export function resolvePlacement(saved: SavedPlace | null | undefined, size: Size, displays: DisplayInfo[], primaryId?: number): Placement | null {
  if (!saved || !isNum(saved.x) || !isNum(saved.y)) return null
  if (displays.length === 0) return { x: saved.x, y: saved.y, kind: 'exact' }
  const rect: Rect = { x: saved.x, y: saved.y, width: size.width, height: size.height }
  const fits = displays.some((d) => rectInside(rect, d.workArea))
  const savedDisplay = saved.display ? findSavedDisplay(saved.display, displays) : null
  const areaChanged = Boolean(saved.display && savedDisplay && !sameRect(savedDisplay.workArea, saved.display.workArea))

  if (fits && !areaChanged) return { x: saved.x, y: saved.y, kind: 'exact' }

  const oldArea = saved.display?.workArea
  const target = savedDisplay ?? nearestDisplay(rect, displays, primaryId)
  if (!target) return null
  const area = target.workArea

  let x: number
  let y: number
  if (oldArea) {
    // Отступ от ближайших вертикального и горизонтального краёв старой области.
    const left = rect.x + size.width / 2 < oldArea.x + oldArea.width / 2
    const top = rect.y + size.height / 2 < oldArea.y + oldArea.height / 2
    const dx = Math.max(0, left ? rect.x - oldArea.x : oldArea.x + oldArea.width - (rect.x + size.width))
    const dy = Math.max(0, top ? rect.y - oldArea.y : oldArea.y + oldArea.height - (rect.y + size.height))
    x = left ? area.x + dx : area.x + area.width - size.width - dx
    y = top ? area.y + dy : area.y + area.height - size.height - dy
  } else {
    // От старой версии экран неизвестен: просто возвращаем окно в видимую область.
    x = rect.x
    y = rect.y
  }
  const p = clampInto(x, y, size, area)
  return { x: p.x, y: p.y, kind: 'moved', reason: savedDisplay ? 'resolution-changed' : saved.display ? 'display-gone' : 'off-screen' }
}

/** Место по умолчанию: правый верхний угол основного экрана. */
export function defaultPlacement(size: Size, displays: DisplayInfo[], primaryId?: number, margin = 16): { x: number; y: number } {
  const d = displays.find((x) => x.id === primaryId) ?? displays[0]
  if (!d) return { x: 0, y: 0 }
  const a = d.workArea
  return clampInto(a.x + a.width - size.width - margin, a.y + margin, size, a)
}

/**
 * Новые границы окна при смене размера. Верхняя половина экрана — верхний край на месте, окно растёт вниз;
 * нижняя — на месте нижний край, окно растёт вверх. По горизонтали так же: правая половина — правый край на месте.
 * Делится рабочая область того экрана, где стоит центр окна.
 */
export function anchoredResize(bounds: Rect, next: Size, displays: DisplayInfo[], primaryId?: number): Rect {
  const w = Math.round(next.width)
  const h = Math.round(next.height)
  const d = nearestDisplay(bounds, displays, primaryId)
  if (!d) return { x: bounds.x, y: bounds.y, width: w, height: h }
  const a = d.workArea
  const right = bounds.x + bounds.width / 2 > a.x + a.width / 2
  const bottom = bounds.y + bounds.height / 2 > a.y + a.height / 2
  const x = right ? bounds.x + bounds.width - w : bounds.x
  const y = bottom ? bounds.y + bounds.height - h : bounds.y
  // Окно, стоявшее целиком на экране, после изменения размера с экрана не выходит.
  if (rectInside(bounds, a)) {
    const p = clampInto(x, y, { width: w, height: h }, a)
    return { x: p.x, y: p.y, width: w, height: h }
  }
  return { x: Math.round(x), y: Math.round(y), width: w, height: h }
}

/** Разбор сохранённого снимка экрана из json. Всё сомнительное — undefined. */
export function parseDisplayInfo(v: unknown): DisplayInfo | undefined {
  const r = v as Partial<DisplayInfo> | null
  const a = r?.workArea as Partial<Rect> | undefined
  if (!r || !a || !isNum(r.id) || !isNum(r.scaleFactor)) return undefined
  if (!isNum(a.x) || !isNum(a.y) || !isNum(a.width) || !isNum(a.height) || a.width <= 0 || a.height <= 0) return undefined
  return { id: r.id, scaleFactor: r.scaleFactor, workArea: { x: a.x, y: a.y, width: a.width, height: a.height } }
}
