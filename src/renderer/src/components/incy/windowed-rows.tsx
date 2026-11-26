import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Простое «окно» для длинного списка строк одинаковой высоты.
 *
 * Пока строк немного (до `threshold`), список рисуется как раньше, целиком.
 * Когда их сотни (подписка на 300–500 серверов), в DOM остаются только строки,
 * видимые в прокручиваемом контейнере, плюс запас сверху и снизу. Остальное
 * место занимает пустой блок той же высоты, поэтому полоса прокрутки и
 * положение карточек не меняются. Высота строки меряется по первой
 * отрисованной строке, промежуток задаёт вызывающий (совпадает с space-y-*).
 */
interface Props<T> {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  /** Промежуток между строками, px (space-y-2 → 8). */
  gap: number
  /** Высота строки до первого замера, px. */
  estimate: number
  /** Сколько строк рисовать без окна. */
  threshold?: number
  /** Запас за краями видимой области, px. */
  overscan?: number
  /** Класс блока со строками (тот же, что у обычного списка: отступы между строками). */
  className?: string
}

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if (oy === 'auto' || oy === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

export function WindowedRows<T>({
  items,
  getKey,
  renderItem,
  gap,
  estimate,
  threshold = 80,
  overscan = 600,
  className
}: Props<T>): React.ReactElement {
  const windowed = items.length > threshold
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(estimate)
  const [range, setRange] = useState<[number, number]>([0, Math.min(items.length, 30)])
  const stride = rowH + gap
  const count = items.length

  const update = useCallback((): void => {
    const outer = outerRef.current
    if (!outer) return
    const parent = scrollParentOf(outer)
    const rect = outer.getBoundingClientRect()
    const viewTop = parent ? parent.getBoundingClientRect().top : 0
    const viewBottom = parent ? viewTop + parent.clientHeight : window.innerHeight
    const from = Math.max(0, Math.floor((viewTop - rect.top - overscan) / stride))
    const to = Math.min(count, Math.max(from, Math.ceil((viewBottom - rect.top + overscan) / stride)))
    setRange((p) => (p[0] === from && p[1] === to ? p : [from, to]))
  }, [count, stride, overscan])

  // Подписка на прокрутку и изменение размера только в режиме окна.
  useEffect(() => {
    if (!windowed) return
    const parent = scrollParentOf(outerRef.current)
    let raf = 0
    const schedule = (): void => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          update()
        })
    }
    update()
    const target: HTMLElement | Window = parent ?? window
    target.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Карточки выше по странице сворачиваются и разворачиваются: следим за размером контейнера.
    const ro = parent ? new ResizeObserver(schedule) : null
    if (parent && ro) ro.observe(parent.firstElementChild ?? parent)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [windowed, update])

  // Настоящая высота строки — по первой отрисованной строке.
  useLayoutEffect(() => {
    if (!windowed) return
    const first = innerRef.current?.firstElementChild as HTMLElement | null
    if (!first) return
    const h = first.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH) > 0.05) setRowH(h)
  })

  if (!windowed) return <>{items.map((it) => <Fragment key={getKey(it)}>{renderItem(it)}</Fragment>)}</>

  const from = Math.min(range[0], count)
  const to = Math.min(Math.max(range[1], from), count)
  const total = count * rowH + Math.max(0, count - 1) * gap
  return (
    <div ref={outerRef} style={{ position: 'relative', height: total }}>
      <div ref={innerRef} className={className} style={{ position: 'absolute', left: 0, right: 0, top: from * stride }}>
        {items.slice(from, to).map((it) => (
          <Fragment key={getKey(it)}>{renderItem(it)}</Fragment>
        ))}
      </div>
    </div>
  )
}
