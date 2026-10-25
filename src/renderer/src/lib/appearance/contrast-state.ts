import { useAppearanceStore, snapshotOf } from './store'
import { effectiveTokens } from './resolve'
import { CONTRAST_PAIRS, type ContrastPair } from './contrast'
import { parseColor, formatColor } from './color'
import { getAverage } from './bg-media'
import { tokenHex } from './probe'
import {
  contrast,
  effectiveBackground,
  flatten,
  solveBackground,
  solveForeground,
  type Rgba
} from './contrast-core'

type State = ReturnType<typeof useAppearanceStore.getState>

const PANEL = new Set(['background', 'card', 'sidebar', 'muted', 'secondary'])
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

const valueOf = (eff: Record<string, string>, key: string): string => eff[key] ?? tokenHex(key)
const rgba = (v: string): Rgba | null => {
  const c = parseColor(v)
  return c ? { r: c.r, g: c.g, b: c.b, a: c.a } : null
}

function effOf(s: State): Record<string, string> {
  return effectiveTokens(snapshotOf(s), s.custom, s.system.accent ? s.systemAccent : null)
}

/** Что лежит под панелями: без обоев — фон приложения; с обоями — затемнение поверх среднего цвета картинки. */
function backdrop(s: State, eff: Record<string, string>): { canvas: Rgba; opacity: number } {
  const st = s.settings
  const appBg = flatten(rgba(valueOf(eff, 'background')) ?? BLACK, BLACK)
  if (!st.bgImage && !st.bgGradient) return { canvas: appBg, opacity: 1 }
  let avg: Rgba | null = st.bgImage ? getAverage(st.bgImage) : null
  if (!avg && st.bgGradient) {
    const a = rgba(st.bgGradientFrom)
    const b = rgba(st.bgGradientTo)
    if (a && b) avg = { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2, a: 1 }
  }
  avg = avg ?? { r: 128, g: 128, b: 128, a: 1 }
  const k = st.bgBrightness
  avg = { r: Math.min(255, avg.r * k), g: Math.min(255, avg.g * k), b: Math.min(255, avg.b * k), a: 1 }
  const canvas = effectiveBackground({
    panel: BLACK,
    appBg,
    wallpaperAverage: avg,
    dimColor: rgba(st.bgDimColor) ?? BLACK,
    dim: st.bgDim,
    panelOpacity: 0
  })
  return { canvas, opacity: st.panelOpacity }
}

/** Фактический цвет поверхности: цвет токена с учётом прозрачности панели над тем, что под ней. */
function surface(eff: Record<string, string>, key: string, bd: { canvas: Rgba; opacity: number }): Rgba {
  const c = rgba(valueOf(eff, key)) ?? BLACK
  const a = PANEL.has(key) ? c.a * bd.opacity : c.a
  return flatten({ ...c, a }, bd.canvas)
}

export interface Failing {
  pair: ContrastPair
  ratio: number
}

function ratioOf(s: State, eff: Record<string, string>, pair: ContrastPair): number | null {
  const fg = rgba(valueOf(eff, pair.fg))
  if (!fg) return null
  const bd = backdrop(s, eff)
  const bg = surface(eff, pair.bg, bd)
  return contrast(fg, bg)
}

function failingList(s: State): Failing[] {
  const eff = effOf(s)
  const out: Failing[] = []
  for (const p of CONTRAST_PAIRS) {
    const r = ratioOf(s, eff, p)
    if (r != null && r < p.min) out.push({ pair: p, ratio: r })
  }
  return out
}

/** Все проблемные пары за один проход: по ключу цвета (худшая пара) и общее число. */
export function failingMap(s: State): { byKey: Map<string, Failing>; total: number } {
  const eff = effOf(s)
  const bd = backdrop(s, eff)
  const byKey = new Map<string, Failing>()
  let total = 0
  for (const p of CONTRAST_PAIRS) {
    const fg = rgba(valueOf(eff, p.fg))
    if (!fg) continue
    const r = contrast(fg, surface(eff, p.bg, bd))
    if (r >= p.min) continue
    total++
    for (const key of [p.fg, p.bg]) {
      const cur = byKey.get(key)
      if (!cur || r < cur.ratio) byKey.set(key, { pair: p, ratio: r })
    }
  }
  return { byKey, total }
}

const hexOf = (c: Rgba): string => formatColor({ r: c.r, g: c.g, b: c.b, a: c.a })

/**
 * Исправляет ТОЛЬКО цвет строки `key`: у текста меняется светлота (оттенок сохраняется),
 * у фона — светлота фона. Контраст считается против фактического фона.
 */
export function autoFixToken(key: string, pair: ContrastPair): void {
  const s = useAppearanceStore.getState()
  const eff = effOf(s)
  const bd = backdrop(s, eff)
  if (key === pair.fg) {
    const fg = rgba(valueOf(eff, pair.fg))
    if (!fg) return
    const bg = surface(eff, pair.bg, bd)
    s.setToken(key, hexOf(solveForeground(fg, bg, pair.min)))
  } else {
    const bg = rgba(valueOf(eff, pair.bg))
    const fg = rgba(valueOf(eff, pair.fg))
    if (!bg || !fg) return
    const panel = PANEL.has(pair.bg)
    s.setToken(key, hexOf(solveBackground(bg, fg, bd.canvas, panel ? bd.opacity : 1, pair.min)))
  }
}

/** «Исправить всё»: правим цвета текста/акцентов (колонка fg) по каждой плохой паре. */
export function autoFixAll(): void {
  for (let pass = 0; pass < 2; pass++) {
    const list = failingList(useAppearanceStore.getState())
    if (list.length === 0) return
    // Для одного и того же текстового цвета берём самый тёмный/светлый вариант из нужных.
    const done = new Set<string>()
    for (const f of list) {
      if (done.has(f.pair.fg)) continue
      done.add(f.pair.fg)
      autoFixToken(f.pair.fg, f.pair)
    }
  }
}
