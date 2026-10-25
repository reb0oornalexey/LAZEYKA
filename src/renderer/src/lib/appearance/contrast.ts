import { formatColor, parseColor, type RGBA } from './color'
import { contrast, flatten, readableOn } from './contrast-core'

export { contrast, flatten, readableOn }

export function contrastRatio(fg: RGBA, bg: RGBA, canvas: RGBA = { r: 0, g: 0, b: 0, a: 1 }): number {
  const b = flatten(bg, canvas)
  return contrast(fg, b)
}

/** Читаемый текст для данного фона (почти-белый или почти-чёрный). */
export function pickReadable(bg: string, canvas?: string): string {
  const b = parseColor(bg) ?? { r: 0, g: 0, b: 0, a: 1 }
  const c = canvas ? (parseColor(canvas) ?? { r: 0, g: 0, b: 0, a: 1 }) : { r: 0, g: 0, b: 0, a: 1 }
  return formatColor(readableOn(flatten(b, c)))
}

import { CONTRAST_PAIRS, type ContrastPair } from './pairs'

export { CONTRAST_PAIRS }
export type { ContrastPair }

export const PAIRS_BY_KEY: ReadonlyMap<string, ContrastPair[]> = (() => {
  const m = new Map<string, ContrastPair[]>()
  for (const p of CONTRAST_PAIRS) {
    for (const k of [p.fg, p.bg]) m.set(k, [...(m.get(k) ?? []), p])
  }
  return m
})()
