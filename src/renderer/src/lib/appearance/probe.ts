let ctx: CanvasRenderingContext2D | null = null

/**
 * Превращает любое CSS-значение цвета (в том числе var(--x), color-mix, oklch) в #rrggbb[aa]:
 * браузер сам считает значение, мы читаем пиксель.
 */
export function cssToHex(cssValue: string): string {
  try {
    const el = document.createElement('span')
    el.style.color = cssValue
    el.style.display = 'none'
    document.documentElement.appendChild(el)
    const computed = getComputedStyle(el).color
    el.remove()
    ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return '#000000'
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    const h = (n: number): string => n.toString(16).padStart(2, '0')
    return `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ''}`
  } catch {
    return '#000000'
  }
}

/** Текущее вычисленное значение переменной `--key` как #hex. */
export const tokenHex = (key: string): string => cssToHex(`var(--${key})`)
