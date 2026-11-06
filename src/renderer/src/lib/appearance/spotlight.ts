/**
 * Свечение за курсором на карточках («Стекло» и «Неон» в Оформлении).
 * Один обработчик на весь документ; координаты — CSS-переменные карточки.
 * При других стилях ничего не делает.
 */
const CARD = '.cyber-card, [data-slot="card"], .ui-card, .ui-glow'
let last: HTMLElement | null = null
let raf = 0
let px = 0
let py = 0

function active(): boolean {
  const v = document.documentElement.getAttribute('data-ui-card')
  return v === 'glass' || v === 'neon'
}

function frame(): void {
  raf = 0
  const el = document.elementFromPoint(px, py)?.closest(CARD) as HTMLElement | null
  if (last && last !== el) last.style.setProperty('--spot-o', '0')
  last = el
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${px - r.left}px`)
  el.style.setProperty('--my', `${py - r.top}px`)
  el.style.setProperty('--spot-o', '1')
}

export function installSpotlight(): void {
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!active()) {
        if (last) last.style.setProperty('--spot-o', '0')
        last = null
        return
      }
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(frame)
    },
    { passive: true }
  )
  document.addEventListener('pointerleave', () => {
    if (last) last.style.setProperty('--spot-o', '0')
    last = null
  })
}
