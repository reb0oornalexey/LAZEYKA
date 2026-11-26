import { useAppearanceStore } from './store'
import { tokenHex } from './probe'
import { autoFixAll } from './contrast-state'
import { hexToRgba, oklchToRgb, rgbToOklch, rgbaToHex } from './contrast-core'

/**
 * Быстрые акценты и «гармоничные цвета от акцента» для вкладки «Цвета».
 * Всё меняется обычными правками цветов (applyTokens — один шаг истории), хранение не трогается.
 */

const deg = (d: number): number => (d * Math.PI) / 180
const ok = (l: number, c: number, h: number): string => rgbaToHex(oklchToRgb({ l, c, h }))

/** Оттенки быстрых акцентов (градусы OKLCH) и их подписи. */
const HUES: [string, number][] = [
  ['Мятный', 158],
  ['Бирюзовый', 192],
  ['Голубой', 230],
  ['Синий', 262],
  ['Индиго', 282],
  ['Фиолетовый', 305],
  ['Розовый', 350],
  ['Красный', 22],
  ['Оранжевый', 52],
  ['Янтарный', 82]
]

/** Акценты под текущий режим: на тёмной теме светлее, на светлой — темнее (чтобы читались на панелях). */
export function accentPresets(mode: 'light' | 'dark'): { name: string; color: string }[] {
  return HUES.map(([name, h]) => ({ name, color: mode === 'dark' ? ok(0.76, 0.16, deg(h)) : ok(0.56, 0.17, deg(h)) }))
}

/** Поверхности и текст, которые получают оттенок акцента (только основные цвета вкладки «Цвета»). */
const TINT: { key: string; dark: number; light: number }[] = [
  { key: 'background', dark: 0.022, light: 0.012 },
  { key: 'card', dark: 0.024, light: 0.01 },
  { key: 'sidebar', dark: 0.022, light: 0.012 },
  { key: 'border', dark: 0.035, light: 0.025 },
  { key: 'text-header', dark: 0.012, light: 0.02 },
  { key: 'text-title', dark: 0.012, light: 0.02 },
  { key: 'foreground', dark: 0.01, light: 0.018 },
  { key: 'muted-foreground', dark: 0.025, light: 0.03 }
]

/**
 * Подобрать фон, панели, меню, рамки и текст в тон акценту: светлота каждого цвета сохраняется,
 * меняется только оттенок (слегка). Затем читаемость проверяется и при необходимости исправляется.
 */
export function harmonizeFromAccent(): void {
  const s = useAppearanceStore.getState()
  const acc = hexToRgba(tokenHex('primary'))
  if (!acc) return
  const h = rgbToOklch(acc).h
  const dark = s.mode === 'dark'
  const patch: Record<string, string> = {}
  for (const t of TINT) {
    const c = hexToRgba(tokenHex(t.key))
    if (!c) continue
    const o = rgbToOklch(c)
    patch[t.key] = ok(o.l, dark ? t.dark : t.light, h)
  }
  s.applyTokens(patch)
  autoFixAll()
}
