import { useAppearanceStore, snapshotOf } from './store'
import { effectiveTokens } from './resolve'
import { CONTRAST_PAIRS, type ContrastPair } from './contrast'
import { ADVANCED_PAIRS } from './pairs'

export { ADVANCED_PAIRS }
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

/** На что ложится фон пары: другая поверхность (кнопка на панели) или то, что под панелями. */
function under(eff: Record<string, string>, pair: ContrastPair, bd: { canvas: Rgba; opacity: number }): Rgba {
  return pair.on ? surface(eff, pair.on, bd) : bd.canvas
}

/** Фактический цвет фона пары. */
function pairBg(eff: Record<string, string>, pair: ContrastPair, bd: { canvas: Rgba; opacity: number }): Rgba {
  if (!pair.on) return surface(eff, pair.bg, bd)
  const c = rgba(valueOf(eff, pair.bg)) ?? BLACK
  return flatten(c, under(eff, pair, bd))
}

function ratioOf(s: State, eff: Record<string, string>, pair: ContrastPair): number | null {
  const fg = rgba(valueOf(eff, pair.fg))
  if (!fg) return null
  return contrast(fg, pairBg(eff, pair, backdrop(s, eff)))
}

/**
 * Фон задан обычным цветом? У некоторых элементов по умолчанию градиент (например, фон
 * уведомления об ошибке) — его одним числом не оценить, такие пары пропускаем.
 */
function plainColor(eff: Record<string, string>, key: string): boolean {
  if (eff[key] !== undefined) return !/gradient|url\(/i.test(eff[key])
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${key}`)
  return !/gradient|url\(/i.test(raw)
}

function failingList(s: State, pairs: ContrastPair[]): Failing[] {
  const eff = effOf(s)
  const out: Failing[] = []
  for (const p of pairs) {
    if (!plainColor(eff, p.bg)) continue
    const r = ratioOf(s, eff, p)
    if (r != null && r < p.min) out.push({ pair: p, ratio: r })
  }
  return out
}

/** Все проблемные пары за один проход: по ключу цвета (худшая пара) и общее число. */
export function failingMap(
  s: State,
  pairs: ContrastPair[] = CONTRAST_PAIRS
): { byKey: Map<string, Failing>; total: number; list: Failing[] } {
  const eff = effOf(s)
  const bd = backdrop(s, eff)
  const byKey = new Map<string, Failing>()
  const list: Failing[] = []
  let total = 0
  for (const p of pairs) {
    if (!plainColor(eff, p.bg)) continue
    const fg = rgba(valueOf(eff, p.fg))
    if (!fg) continue
    const r = contrast(fg, pairBg(eff, p, bd))
    if (r >= p.min) continue
    total++
    list.push({ pair: p, ratio: r })
    for (const key of [p.fg, p.bg]) {
      const cur = byKey.get(key)
      if (!cur || r < cur.ratio) byKey.set(key, { pair: p, ratio: r })
    }
  }
  return { byKey, total, list }
}

const hexOf = (c: Rgba): string => formatColor({ r: c.r, g: c.g, b: c.b, a: c.a })

/**
 * Исправляет ТОЛЬКО цвет строки `key`: у текста меняется светлота (оттенок сохраняется),
 * у фона — светлота фона. Контраст считается против фактического фона.
 */
export function autoFixToken(key: string, pair: ContrastPair): void {
  releaseSystemAccent(key)
  const s = useAppearanceStore.getState()
  const eff = effOf(s)
  const bd = backdrop(s, eff)
  if (key === pair.fg) {
    const fg = rgba(valueOf(eff, pair.fg))
    if (!fg) return
    const bg = pairBg(eff, pair, bd)
    s.setToken(key, hexOf(solveForeground(fg, bg, pair.min)))
  } else {
    const bg = rgba(valueOf(eff, pair.bg))
    const fg = rgba(valueOf(eff, pair.fg))
    if (!bg || !fg) return
    const panel = !pair.on && PANEL.has(pair.bg)
    s.setToken(key, hexOf(solveBackground(bg, fg, under(eff, pair, bd), panel ? bd.opacity : 1, pair.min)))
  }
}

/** Токены, которые перекрывает акцент Windows (его правки иначе не видны). */
const ACCENT_KEYS = new Set(['primary', 'primary-foreground', 'ring', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-ring'])

/** Если правим цвет акцента, а включён акцент Windows, — переносим его в свой цвет, иначе правка не видна. */
function releaseSystemAccent(key: string): void {
  const s = useAppearanceStore.getState()
  if (!ACCENT_KEYS.has(key) || !s.system.accent || !s.systemAccent) return
  const acc = s.systemAccent
  s.setSystem({ accent: false })
  if (!s.tokens.primary) useAppearanceStore.getState().setToken('primary', acc)
}

function pairRatio(pair: ContrastPair): number | null {
  const s = useAppearanceStore.getState()
  return ratioOf(s, effOf(s), pair)
}

/** Фактический контраст пары для показа в интерфейсе; null — фон не одноцветный (градиент), оценить нельзя. */
export function pairRatioShown(pairs: ContrastPair[]): (number | null)[] {
  const s = useAppearanceStore.getState()
  const eff = effOf(s)
  return pairs.map((p) => (plainColor(eff, p.bg) ? ratioOf(s, eff, p) : null))
}

/**
 * «Исправить всё»: по каждой плохой паре сначала правим цвет текста/акцента;
 * если это не помогло (цвет перекрыт или упёрся в предел) — правим фон пары.
 */
export function autoFixAll(pairs: ContrastPair[] = CONTRAST_PAIRS): void {
  for (let pass = 0; pass < 4; pass++) {
    const list = failingList(useAppearanceStore.getState(), pairs)
    if (list.length === 0) return
    for (const f of list) {
      const before = pairRatio(f.pair)
      if (before == null || before >= f.pair.min) continue
      const order = f.pair.prefer === 'bg' ? [f.pair.bg, f.pair.fg] : [f.pair.fg, f.pair.bg]
      releaseSystemAccent(order[0])
      autoFixToken(order[0], f.pair)
      const after = pairRatio(f.pair)
      if (after != null && after >= f.pair.min) continue
      releaseSystemAccent(order[1])
      autoFixToken(order[1], f.pair)
    }
  }
}
