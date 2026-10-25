import { VALID_KEYS } from './tokens'
import { DEPENDANTS } from './dependants'
import { deriveFor } from './derive'
import { formatColor, hslToRgb, isSafeCssValue, parseColor, rgbToHsl, withAlpha } from './color'
import { readableOn } from './contrast-core'
import { DARK_TOKENS, LIGHT_TOKENS } from './palettes'
import { DEFAULT_PRESET_ID, DEFAULT_SETTINGS, FONT_OPTIONS, getBuiltinPreset } from './presets'

/** Изменяемая часть оформления — то, что попадает в историю отмены. */
export interface AppearanceSnapshot {
  presetId: string
  mode: AppearanceMode
  tokens: Record<string, string>
  settings: AppearanceSettings
}

export interface ResolvedAppearance {
  mode: AppearanceMode
  vars: Record<string, string>
  backdrop: boolean
  settings: AppearanceSettings
}

const FONT_PREFIX = "'Twemoji Country Flags', "
const FONT_SUFFIX = ", 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

/** Поверхности, у которых при обоях применяется «прозрачность панелей». */
export const PANEL_KEYS = ['background', 'card', 'sidebar', 'muted', 'secondary'] as const

/** Базовые токены выбранного пресета (без правок пользователя). */
export function baseTokens(presetId: string, custom: CustomAppearanceTheme[]): Record<string, string> {
  const c = custom.find((x) => x.id === presetId)
  if (c) return { ...(c.mode === 'light' ? LIGHT_TOKENS : DARK_TOKENS), ...c.tokens }
  const p = getBuiltinPreset(presetId) ?? getBuiltinPreset(DEFAULT_PRESET_ID)!
  return p.tokens
}

/** Акцент Windows → набор токенов акцента. */
export function accentTokens(accent: string): Record<string, string> {
  const c = parseColor(accent)
  if (!c) return {}
  const hsl = rgbToHsl(c)
  const deep = formatColor(hslToRgb({ ...hsl, l: hsl.l * 0.7 }))
  const fg = formatColor({ ...readableOn({ ...c, a: 1 }), a: 1 })
  return {
    primary: accent,
    'primary-foreground': fg,
    ring: accent,
    'sidebar-primary': accent,
    'sidebar-primary-foreground': fg,
    'sidebar-ring': accent,
    'stroke-power-on': accent,
    'gradient-start-power-on': accent,
    'gradient-end-power-on': deep,
    'profile-active': withAlpha(accent, 0.14),
    'stroke-profile-active': accent,
    'chart-1': accent
  }
}

/** Всё, что считается от изменённых пользователем смысловых цветов. */
export function derivedFromOverrides(overrides: Record<string, string>, base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const card = overrides['card'] ?? base['card'] ?? '#12151a'
  for (const key of Object.keys(DEPENDANTS)) {
    const v = overrides[key]
    if (v) Object.assign(out, deriveFor(key, v, { card }))
  }
  return out
}

export function effectiveTokens(
  s: AppearanceSnapshot,
  custom: CustomAppearanceTheme[],
  accent?: string | null
): Record<string, string> {
  const base = { ...baseTokens(s.presetId, custom), ...(accent ? accentTokens(accent) : {}) }
  return { ...base, ...derivedFromOverrides(s.tokens, base), ...s.tokens }
}

export function fontStack(settings: AppearanceSettings): string | null {
  const opt = FONT_OPTIONS.find((f) => f.id === settings.fontFamily)
  if (!opt || opt.id === 'onest') return null
  if (opt.id === 'custom') {
    const name = settings.fontCustom.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
    return name ? `${FONT_PREFIX}'${name}', sans-serif${FONT_SUFFIX}` : null
  }
  return opt.stack ? `${FONT_PREFIX}${opt.stack}${FONT_SUFFIX}` : null
}

export function hasBackdrop(s: AppearanceSettings): boolean {
  return Boolean(s.bgImage) || s.bgGradient
}

/** Применяет «прозрачность панелей» к значениям поверхностей (только при обоях). */
export function withPanelAlpha(
  vars: Record<string, string>,
  eff: Record<string, string>,
  st: AppearanceSettings
): void {
  if (!hasBackdrop(st)) return
  if (eff['background'] && '--background' in vars) vars['--app-canvas'] = eff['background']
  if (st.panelOpacity >= 1) return
  for (const k of PANEL_KEYS) {
    const v = `--${k}`
    if (v in vars && eff[k]) vars[v] = withAlpha(eff[k], st.panelOpacity)
  }
}

export function resolveAppearance(
  s: AppearanceSnapshot,
  custom: CustomAppearanceTheme[],
  accent?: string | null
): ResolvedAppearance {
  const eff = effectiveTokens(s, custom, accent)
  const st = s.settings
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(eff)) {
    if (VALID_KEYS.has(k) && isSafeCssValue(v)) vars[`--${k}`] = v
  }
  if (st.radius !== DEFAULT_SETTINGS.radius) vars['--radius'] = `${st.radius}rem`
  if (st.fontScale !== 1) vars['--ui-font-scale'] = String(st.fontScale)
  const stack = fontStack(st)
  if (stack) vars['--font-sans'] = stack
  if (st.density === 'compact') vars['--spacing'] = '0.23rem'
  else if (st.density === 'comfortable') vars['--spacing'] = '0.27rem'
  if (st.sidebarWidth !== DEFAULT_SETTINGS.sidebarWidth) vars['--sidebar-width'] = `${st.sidebarWidth}px`
  withPanelAlpha(vars, eff, st)
  return { mode: s.mode, vars, backdrop: hasBackdrop(st), settings: st }
}

export function varsToCss(selector: string, vars: Record<string, string>): string {
  let out = `${selector}{`
  for (const [k, v] of Object.entries(vars)) out += `${k}:${v};`
  return out + '}'
}

/**
 * Переменные для «живого» перетаскивания: только выбранный цвет и то, что от него зависит.
 */
export function liveVars(
  key: string,
  value: string,
  s: AppearanceSnapshot,
  custom: CustomAppearanceTheme[],
  accent?: string | null
): Record<string, string> {
  const base = { ...baseTokens(s.presetId, custom), ...(accent ? accentTokens(accent) : {}) }
  const card = key === 'card' ? value : (s.tokens['card'] ?? base['card'] ?? '#12151a')
  const eff: Record<string, string> = { [key]: value, ...deriveFor(key, value, { card }) }
  // Явные правки пользователя зависимых значений важнее производных.
  for (const k of Object.keys(eff)) if (k !== key && s.tokens[k] !== undefined) delete eff[k]
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(eff)) if (VALID_KEYS.has(k) && isSafeCssValue(v)) vars[`--${k}`] = v
  withPanelAlpha(vars, { ...base, ...eff }, s.settings)
  return vars
}
