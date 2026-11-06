import type { ResolvedAppearance } from './resolve'
import { varsToCss } from './resolve'

const STYLE_ID = 'lazeyka-appearance'
const CUSTOM_ID = 'lazeyka-custom-theme'
const LIVE_ID = 'lazeyka-appearance-live'
export const BOOT_KEY = 'lazeyka.appearance.boot'

// Порядок в <head> (позже — важнее): оформление → пользовательский CSS-файл темы → «живое» перетаскивание.
const ORDER = [STYLE_ID, CUSTOM_ID, LIVE_ID]

function styleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    const later = ORDER.slice(ORDER.indexOf(id) + 1)
      .map((x) => document.getElementById(x))
      .find(Boolean)
    if (later) document.head.insertBefore(el, later)
    else document.head.appendChild(el)
  }
  return el
}

/** Пользовательский CSS темы (customTheme) всегда идёт ПОСЛЕ оформления и может его переопределить. */
export function setCustomThemeCss(css: string): void {
  const el = styleEl(CUSTOM_ID)
  if (el.textContent !== css) el.textContent = css
}

/** «Живые» переменные на время перетаскивания цвета: только то, что зависит от выбранного цвета. */
export function writeLiveCss(css: string): void {
  const el = styleEl(LIVE_ID)
  if (el.textContent !== css) el.textContent = css
}

/** Применяет оформление к документу: один <style> с переменными + классы на <html>. */
export function applyResolved(r: ResolvedAppearance): void {
  const el = styleEl(STYLE_ID)
  const css = varsToCss(':root', r.vars)
  if (el.textContent !== css) el.textContent = css
  const root = document.documentElement
  root.classList.toggle('dark', r.mode === 'dark')
  root.classList.toggle('light', r.mode === 'light')
  root.style.colorScheme = r.mode
  const anim = r.settings.animations
  root.classList.toggle('motion-off', anim === 'off')
  root.classList.toggle('motion-auto', anim === 'auto')
  root.classList.toggle('bg-glass', r.backdrop && r.settings.bgGlass)
  setUiStyles(root, r.settings.buttonStyle, r.settings.switchStyle, r.settings.cardStyle)
  const sh = typeof r.settings.uiShadow === 'number' ? r.settings.uiShadow : 0.6
  const bw = typeof r.settings.uiBorder === 'number' ? r.settings.uiBorder : 1
  root.style.setProperty('--ui-shadow', String(sh))
  root.style.setProperty('--ui-border-w', `${bw}px`)
  if (bw !== 1) root.setAttribute('data-ui-border', '')
  else root.removeAttribute('data-ui-border')
  const size = r.settings.buttonSize
  if (size === 'compact' || size === 'large') root.setAttribute('data-ui-btn-size', size)
  else root.removeAttribute('data-ui-btn-size')
}

/** Вид кнопок / переключателей / карточек — атрибуты на <html>, правила в main.css. */
function setUiStyles(root: HTMLElement, btn?: string, sw?: string, card?: string): void {
  const set = (name: string, v?: string): void => {
    if (v && v !== 'classic') root.setAttribute(name, v)
    else root.removeAttribute(name)
  }
  set('data-ui-btn', btn)
  set('data-ui-switch', sw)
  set('data-ui-card', card)
}

/** Кэш для мгновенного старта без мигания (читает boot.ts до рендера). */
export function writeBootCache(r: ResolvedAppearance): void {
  try {
    localStorage.setItem(
      BOOT_KEY,
      JSON.stringify({
        mode: r.mode,
        css: varsToCss(':root', r.vars),
        anim: r.settings.animations,
        ui: [r.settings.buttonStyle, r.settings.switchStyle, r.settings.cardStyle]
      })
    )
  } catch {
    /* noop */
  }
}

export function applyBootCache(): void {
  try {
    const raw = localStorage.getItem(BOOT_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as { mode?: string; css?: string; anim?: string; ui?: unknown }
    if (typeof d.css !== 'string' || !/^:root\{[^{}<>]*\}$/.test(d.css)) return
    styleEl(STYLE_ID).textContent = d.css
    const root = document.documentElement
    if (d.mode === 'light' || d.mode === 'dark') {
      root.classList.toggle('dark', d.mode === 'dark')
      root.classList.toggle('light', d.mode === 'light')
      root.style.colorScheme = d.mode
    }
    root.classList.toggle('motion-off', d.anim === 'off')
    root.classList.toggle('motion-auto', d.anim === 'auto')
    if (Array.isArray(d.ui)) {
      const ok = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z]{1,12}$/.test(v) ? v : undefined)
      setUiStyles(root, ok(d.ui[0]), ok(d.ui[1]), ok(d.ui[2]))
    }
  } catch {
    /* noop */
  }
}
