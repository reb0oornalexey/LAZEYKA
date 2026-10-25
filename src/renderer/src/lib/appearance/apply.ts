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
}

/** Кэш для мгновенного старта без мигания (читает boot.ts до рендера). */
export function writeBootCache(r: ResolvedAppearance): void {
  try {
    localStorage.setItem(
      BOOT_KEY,
      JSON.stringify({ mode: r.mode, css: varsToCss(':root', r.vars), anim: r.settings.animations })
    )
  } catch {
    /* noop */
  }
}

export function applyBootCache(): void {
  try {
    const raw = localStorage.getItem(BOOT_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as { mode?: string; css?: string; anim?: string }
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
  } catch {
    /* noop */
  }
}
