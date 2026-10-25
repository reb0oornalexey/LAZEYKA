import { DARK_TOKENS, LIGHT_TOKENS } from './palettes'
import { parseColor } from './color'

export interface AppearancePreset {
  id: string
  name: string
  mode: AppearanceMode
  tokens: Record<string, string>
}

export const DEFAULT_SETTINGS: AppearanceSettings = {
  fontScale: 1,
  fontFamily: 'onest',
  fontCustom: '',
  radius: 0.75,
  density: 'normal',
  animations: 'on',
  sidebarWidth: 212,
  bgImage: '',
  bgFit: 'cover',
  bgBlur: 0,
  bgDim: 0.3,
  bgBrightness: 1,
  bgSaturation: 1,
  bgGlass: false,
  bgDimColor: '#000000',
  panelOpacity: 1,
  bgGradient: false,
  bgGradientFrom: '#0b0d10',
  bgGradientTo: '#1b2a4a',
  bgGradientAngle: 135,
  bgAnimate: true,
  bgPauseOnBlur: true
}

export interface Seed {
  bg: string
  card: string
  popover: string
  raised: string
  muted: string
  border: string
  input: string
  fg: string
  mutedFg: string
  sidebar: string
  sidebarFg: string
  primary: string
  primaryFg: string
  deep: string
}

const rgba = (hex: string, a: number): string => {
  const c = parseColorHex(hex)
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
}
function parseColorHex(hex: string): [number, number, number] {
  const c = parseColor(hex)
  return c ? [c.r, c.g, c.b] : [0, 0, 0]
}

export function derive(base: Record<string, string>, s: Seed): Record<string, string> {
  return {
    ...base,
    background: s.bg,
    foreground: s.fg,
    card: s.card,
    'card-foreground': s.fg,
    popover: s.popover,
    'popover-foreground': s.fg,
    primary: s.primary,
    'primary-foreground': s.primaryFg,
    secondary: s.raised,
    'secondary-foreground': s.fg,
    muted: s.muted,
    'muted-foreground': s.mutedFg,
    accent: s.raised,
    'accent-foreground': s.fg,
    border: s.border,
    input: s.input,
    stroke: s.border,
    ring: s.primary,
    'stroke-power-off': s.input,
    'gradient-start-power-off': s.raised,
    'gradient-end-power-off': s.card,
    'stroke-power-on': s.primary,
    'gradient-start-power-on': s.primary,
    'gradient-end-power-on': s.deep,
    'profile-active': rgba(s.primary, 0.14),
    'stroke-profile-active': s.primary,
    'profile-inactive': s.muted,
    'stroke-profile-inactive': s.input,
    'chart-1': s.primary,
    sidebar: s.sidebar,
    'sidebar-foreground': s.sidebarFg,
    'sidebar-primary': s.primary,
    'sidebar-primary-foreground': s.primaryFg,
    'sidebar-accent': s.raised,
    'sidebar-accent-foreground': s.fg,
    'sidebar-border': s.border,
    'sidebar-ring': s.primary
  }
}

export const BUILTIN_PRESETS: AppearancePreset[] = [
  { id: 'dark', name: 'Тёмная', mode: 'dark', tokens: { ...DARK_TOKENS } },
  { id: 'light', name: 'Светлая', mode: 'light', tokens: { ...LIGHT_TOKENS } },
  {
    id: 'graphite',
    name: 'Графит',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#101012', card: '#17171a', popover: '#1b1b1f', raised: '#212126', muted: '#1a1a1e',
      border: '#2a2a30', input: '#33333a', fg: '#ececf0', mutedFg: '#8e8e99', sidebar: '#0c0c0e',
      sidebarFg: '#c8c8d0', primary: '#e4e4ea', primaryFg: '#101012', deep: '#9a9aa6'
    })
  },
  {
    id: 'midnight',
    name: 'Полночь',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#0a1020', card: '#101a30', popover: '#131e36', raised: '#19264a', muted: '#0f182b',
      border: '#1f2d4d', input: '#2a3b63', fg: '#e6edff', mutedFg: '#8393b8', sidebar: '#080d1a',
      sidebarFg: '#bcc8e6', primary: '#5b8cff', primaryFg: '#040a1a', deep: '#2f5fd6'
    })
  },
  {
    id: 'emerald',
    name: 'Изумруд',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#08130f', card: '#0e1d17', popover: '#112219', raised: '#173025', muted: '#0c1913',
      border: '#1c3427', input: '#264537', fg: '#e4f5ec', mutedFg: '#85a595', sidebar: '#060f0b',
      sidebarFg: '#bcd8c8', primary: '#34d399', primaryFg: '#03150d', deep: '#059669'
    })
  },
  {
    id: 'sunset',
    name: 'Закат',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#140c0a', card: '#1e1311', popover: '#231815', raised: '#2f1e19', muted: '#1a100e',
      border: '#3a251e', input: '#4a2f26', fg: '#fbeee6', mutedFg: '#b39284', sidebar: '#100908',
      sidebarFg: '#e0c6b8', primary: '#ff8a3d', primaryFg: '#1a0a02', deep: '#e0561a'
    })
  },
  {
    id: 'purple',
    name: 'Пурпур',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#0f0a18', card: '#170f26', popover: '#1c132e', raised: '#271a40', muted: '#130d20',
      border: '#2f2150', input: '#3d2b66', fg: '#f1eafe', mutedFg: '#9d8cbf', sidebar: '#0b0713',
      sidebarFg: '#cfc2ec', primary: '#b07cff', primaryFg: '#12061f', deep: '#7c3aed'
    })
  },
  {
    id: 'amoled',
    name: 'AMOLED чёрный',
    mode: 'dark',
    tokens: derive(DARK_TOKENS, {
      bg: '#000000', card: '#0a0a0a', popover: '#0e0e0e', raised: '#161616', muted: '#0a0a0a',
      border: '#1a1a1a', input: '#262626', fg: '#f2f2f2', mutedFg: '#8a8a8a', sidebar: '#000000',
      sidebarFg: '#c8c8c8', primary: '#4ce896', primaryFg: '#03130b', deep: '#1f9d63'
    })
  },
  {
    id: 'sky',
    name: 'Небо',
    mode: 'light',
    tokens: derive(LIGHT_TOKENS, {
      bg: '#eaf2fb', card: '#ffffff', popover: '#ffffff', raised: '#dde9f6', muted: '#e3edf8',
      border: '#d3e0ef', input: '#c4d5e8', fg: '#0f1b2d', mutedFg: '#53657c', sidebar: '#f5f9fe',
      sidebarFg: '#1c2b40', primary: '#1d6fe0', primaryFg: '#ffffff', deep: '#1450b0'
    })
  }
]

export const DEFAULT_PRESET_ID = 'dark'

export function getBuiltinPreset(id: string): AppearancePreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id)
}

export const FONT_OPTIONS: { id: string; label: string; stack: string | null }[] = [
  { id: 'onest', label: 'Onest (по умолчанию)', stack: null },
  { id: 'system', label: 'Системный', stack: "system-ui, 'Segoe UI', sans-serif" },
  { id: 'segoe', label: 'Segoe UI', stack: "'Segoe UI', sans-serif" },
  { id: 'arial', label: 'Arial', stack: "Arial, 'Helvetica Neue', sans-serif" },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', sans-serif" },
  { id: 'georgia', label: 'Georgia (с засечками)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'consolas', label: 'Consolas (моноширинный)', stack: "Consolas, 'Cascadia Mono', 'Courier New', monospace" },
  { id: 'custom', label: 'Свой шрифт…', stack: null }
]
