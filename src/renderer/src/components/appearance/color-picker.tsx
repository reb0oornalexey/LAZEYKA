import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { RotateCcw } from 'lucide-react'
import {
  clamp,
  formatColor,
  hsvToRgb,
  parseColor,
  rgbToHsv,
  rgbaToHex,
  type HSVA,
  type RGBA
} from '@renderer/lib/appearance/color'
import { cn } from '@renderer/lib/utils'

const WHEEL = 188 // px, диаметр круга
const RING = 0.22 // толщина кольца относительно радиуса
const SQ = 90 // сторона квадрата «насыщенность / яркость»

const toHsva = (value: string, prev?: HSVA): HSVA => {
  const c = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 }
  const h = rgbToHsv(c)
  // У серых цветов оттенок не определён — сохраняем прежний, чтобы колесо не прыгало.
  if (prev && (h.s === 0 || h.v === 0)) h.h = prev.h
  if (prev && h.v === 0) h.s = prev.s
  return h
}

const Swatch: React.FC<{ color: string; className?: string }> = ({ color, className }) => (
  <span className={cn('cp-checker relative block overflow-hidden rounded-md', className)}>
    <span className="absolute inset-0" style={{ background: color }} />
  </span>
)

interface PickerProps {
  value: string
  /** Итоговое значение: по отпусканию мыши / Enter / закрытию окна. В хранилище попадает только оно. */
  onChange: (value: string) => void
  /** «Живое» значение во время перетаскивания (не чаще раза за кадр). Хранилище и React не трогает. */
  onLive?: (value: string) => void
  /** Вызывается при закрытии окна, если цвет менялся — для списка недавних. */
  onCommit?: (value: string) => void
  recent?: string[]
  defaultOpen?: boolean
  onClose?: () => void
  onReset?: () => void
  title?: string
  children?: React.ReactNode
  className?: string
}

export const ColorPicker: React.FC<PickerProps> = ({ value, onChange, onLive, onCommit, recent = [], defaultOpen, onClose, onReset, title, children, className }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [hsva, setHsva] = useState<HSVA>(() => toHsva(value))
  const [hexText, setHexText] = useState('')
  const emitted = useRef(value)
  const dirty = useRef(false)
  const liveRaf = useRef(0)
  const cb = useRef({ onChange, onLive, onCommit })
  cb.current = { onChange, onLive, onCommit }

  // Значение изменили снаружи (сброс, отмена) — подтягиваем в окно.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value
      setHsva((p) => toHsva(value, p))
    }
  }, [value])

  const rgb: RGBA = hsvToRgb(hsva)
  const current = formatColor(rgb)
  useEffect(() => setHexText(rgbaToHex(rgb).toUpperCase()), [current])

  /** Зафиксировать результат: одна запись в хранилище (и один шаг истории). */
  const commit = useCallback((): void => {
    if (liveRaf.current) {
      cancelAnimationFrame(liveRaf.current)
      liveRaf.current = 0
    }
    if (dirty.current) {
      dirty.current = false
      cb.current.onChange(emitted.current)
      cb.current.onCommit?.(emitted.current)
    }
  }, [])

  const emit = useCallback((next: HSVA) => {
    setHsva(next)
    emitted.current = formatColor(hsvToRgb(next))
    dirty.current = true
    // Во время перетаскивания обновляется только одна CSS-переменная, раз в кадр.
    if (cb.current.onLive && !liveRaf.current) {
      liveRaf.current = requestAnimationFrame(() => {
        liveRaf.current = 0
        cb.current.onLive?.(emitted.current)
      })
    }
  }, [])

  useEffect(() => commit, [commit])

  const setRgb = (patch: Partial<RGBA>): void => emit(toHsva(formatColor({ ...rgb, ...patch }), hsva))

  const handleOpen = (o: boolean): void => {
    setOpen(o)
    if (o) {
      dirty.current = false
      setHsva((p) => toHsva(value, p))
    } else {
      commit()
      onClose?.()
    }
  }

  // --- Кольцо оттенка ---
  const ringRef = useRef<HTMLDivElement>(null)
  const dragRing = useRef(false)
  const hueFromEvent = (e: React.PointerEvent): { h: number; onRing: boolean } => {
    const r = ringRef.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const dist = Math.hypot(dx, dy)
    let h = (Math.atan2(dy, dx) * 180) / Math.PI + 90
    if (h < 0) h += 360
    return { h, onRing: dist >= (WHEEL / 2) * (1 - RING) - 4 }
  }
  const onRingDown = (e: React.PointerEvent): void => {
    const { h, onRing } = hueFromEvent(e)
    if (!onRing) return
    dragRing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    emit({ ...hsva, h })
  }
  const onRingMove = (e: React.PointerEvent): void => {
    if (dragRing.current) emit({ ...hsva, h: hueFromEvent(e).h })
  }

  // --- Квадрат S/V ---
  const sqRef = useRef<HTMLDivElement>(null)
  const dragSq = useRef(false)
  const svFromEvent = (e: React.PointerEvent): HSVA => {
    const r = sqRef.current!.getBoundingClientRect()
    return {
      ...hsva,
      s: clamp((e.clientX - r.left) / r.width, 0, 1),
      v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1)
    }
  }
  const onSqDown = (e: React.PointerEvent): void => {
    dragSq.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    emit(svFromEvent(e))
  }
  const onSqMove = (e: React.PointerEvent): void => {
    if (dragSq.current) emit(svFromEvent(e))
  }

  const R = WHEEL / 2
  const mid = R * (1 - RING / 2)
  const ang = ((hsva.h - 90) * Math.PI) / 180
  const hueThumb = { left: R + Math.cos(ang) * mid, top: R + Math.sin(ang) * mid }
  const pure = formatColor(hsvToRgb({ h: hsva.h, s: 1, v: 1, a: 1 }))
  const opaque = rgbaToHex({ ...rgb, a: 1 })

  const commitHex = (): void => {
    const c = parseColor(hexText.startsWith('#') ? hexText : `#${hexText}`)
    if (c) {
      emit(toHsva(formatColor(c), hsva))
      commit()
    } else setHexText(rgbaToHex(rgb).toUpperCase())
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>
        {children ?? (
          <button type="button" title={title} className={cn('block h-7 w-9 shrink-0 cursor-pointer rounded-md border border-border', className)}>
            <Swatch color={value} className="h-full w-full rounded-[5px]" />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[200] w-[264px] select-none rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl outline-none"
        >
          <div className="mx-auto" style={{ width: WHEEL, height: WHEEL }}>
            <div
              ref={ringRef}
              className="relative size-full touch-none rounded-full"
              style={{
                background: 'conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                WebkitMask: `radial-gradient(circle, transparent ${(1 - RING) * 100 - 1}%, #000 ${(1 - RING) * 100}%)`,
                mask: `radial-gradient(circle, transparent ${(1 - RING) * 100 - 1}%, #000 ${(1 - RING) * 100}%)`
              }}
              onPointerDown={onRingDown}
              onPointerMove={onRingMove}
              onPointerUp={() => {
                dragRing.current = false
                commit()
              }}
            />
          </div>
          {/* Слой поверх кольца: ползунок оттенка и квадрат S/V. */}
          <div className="pointer-events-none relative mx-auto" style={{ width: WHEEL, height: WHEEL, marginTop: -WHEEL }}>
            <span
              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              style={{ left: hueThumb.left, top: hueThumb.top, background: pure }}
            />
            <div
              ref={sqRef}
              className="pointer-events-auto absolute touch-none overflow-hidden rounded-md"
              style={{
                width: SQ,
                height: SQ,
                left: (WHEEL - SQ) / 2,
                top: (WHEEL - SQ) / 2,
                backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`
              }}
              onPointerDown={onSqDown}
              onPointerMove={onSqMove}
              onPointerUp={() => {
                dragSq.current = false
                commit()
              }}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaque }}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border" title="Было → стало">
              <Swatch color={value === current ? current : value} className="h-7 w-7 rounded-none" />
              <Swatch color={current} className="h-7 w-7 rounded-none" />
            </div>
            <input
              value={hexText}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => e.key === 'Enter' && commitHex()}
              spellCheck={false}
              maxLength={9}
              className="select-text h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs uppercase outline-none focus:border-primary"
              aria-label="HEX"
            />
            {onReset && (
              <button
                type="button"
                title="Вернуть значение пресета"
                onClick={() => {
                  dirty.current = false
                  onReset()
                }}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {(
              [
                ['R', 'r', `linear-gradient(to right, rgb(0,${rgb.g},${rgb.b}), rgb(255,${rgb.g},${rgb.b}))`],
                ['G', 'g', `linear-gradient(to right, rgb(${rgb.r},0,${rgb.b}), rgb(${rgb.r},255,${rgb.b}))`],
                ['B', 'b', `linear-gradient(to right, rgb(${rgb.r},${rgb.g},0), rgb(${rgb.r},${rgb.g},255))`]
              ] as const
            ).map(([label, k, bg]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-3 text-[11px] font-semibold text-muted-foreground">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={rgb[k]}
                  onChange={(e) => setRgb({ [k]: Number(e.target.value) })}
                  onPointerUp={commit}
                  onKeyUp={commit}
                  className="cp-range"
                  style={{ background: bg }}
                />
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[k]}
                  onChange={(e) => setRgb({ [k]: clamp(Math.round(Number(e.target.value) || 0), 0, 255) })}
                  onBlur={commit}
                  className="select-text h-6 w-12 rounded-md border border-border bg-background px-1 text-center text-xs outline-none focus:border-primary"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-3 text-[11px] font-semibold text-muted-foreground">A</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(rgb.a * 100)}
                onChange={(e) => setRgb({ a: Number(e.target.value) / 100 })}
                onPointerUp={commit}
                onKeyUp={commit}
                className="cp-range cp-checker"
                style={{ backgroundImage: `linear-gradient(to right, transparent, ${opaque}), linear-gradient(45deg, #c8c8c8 25%, transparent 25%, transparent 75%, #c8c8c8 75%), linear-gradient(45deg, #c8c8c8 25%, transparent 25%, transparent 75%, #c8c8c8 75%)`, backgroundSize: '100% 100%, 8px 8px, 8px 8px', backgroundPosition: '0 0, 0 0, 4px 4px' }}
              />
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(rgb.a * 100)}%</span>
            </div>
          </div>

          {recent.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] text-muted-foreground">Недавние</div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => {
                      emit(toHsva(c, hsva))
                      commit()
                    }}
                    className="size-5 cursor-pointer rounded border border-border"
                  >
                    <Swatch color={c} className="size-full rounded-[3px]" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { Swatch }
