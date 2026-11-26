import React, { useEffect, useRef, useState } from 'react'
import { Video } from 'lucide-react'
import { isSafeCssValue } from '@renderer/lib/appearance/color'
import { bgKind } from '@renderer/lib/appearance/bg-media'
import { getThemeThumb } from '@renderer/lib/appearance/theme-thumb'

const safe = (v: string, def: string): string => (isSafeCssValue(v) ? v : def)

/** Есть ли у темы свой фон (картинка, GIF, видео или градиент). */
export const themeHasBackdrop = (st: AppearanceSettings | undefined): st is AppearanceSettings =>
  Boolean(st && (st.bgImage || st.bgGradient))

/** Размытие задаётся для окна шириной ~1000 px; плитка в ~7 раз уже. */
const BLUR_SCALE = 0.14

/**
 * Миниатюра фона: грузится, только когда плитка появилась на экране, и один раз
 * (дальше из кэша). `done` — попытка завершена (для запасного значка у видео).
 */
function useLazyThumb(name: string, ref: React.RefObject<HTMLElement | null>): { src: string | null; done: boolean } {
  const [state, setState] = useState<{ name: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!name) return
    const el = ref.current
    let alive = true
    let io: IntersectionObserver | null = null
    const load = (): void => {
      getThemeThumb(name).then((src) => alive && setState({ name, src }))
    }
    if (!el || typeof IntersectionObserver === 'undefined') load()
    else {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect()
            io = null
            load()
          }
        },
        { rootMargin: '200px' }
      )
      io.observe(el)
    }
    return () => {
      alive = false
      io?.disconnect()
    }
  }, [name, ref])
  const mine = state && state.name === name ? state : null
  return { src: mine?.src ?? null, done: Boolean(mine) }
}

/**
 * Фон под мини-макетом темы: та же картинка (уменьшенная), размытие, яркость,
 * насыщенность и затемнение, что задаёт тема. Видео — только неподвижный первый
 * кадр; если кадр не снялся — цвет фона темы и значок «видео».
 */
export const ThemeBackdrop: React.FC<{ settings: AppearanceSettings; canvas: string }> = ({ settings: st, canvas }) => {
  const ref = useRef<HTMLDivElement>(null)
  const { src, done } = useLazyThumb(st.bgImage, ref)
  const hasImage = Boolean(st.bgImage)

  const filters: string[] = []
  if (hasImage) {
    if (st.bgBlur > 0) filters.push(`blur(${(st.bgBlur * BLUR_SCALE).toFixed(1)}px)`)
    if (st.bgBrightness !== 1) filters.push(`brightness(${st.bgBrightness})`)
    if (st.bgSaturation !== 1) filters.push(`saturate(${st.bgSaturation})`)
  }
  const videoFallback = hasImage && done && !src && bgKind(st.bgImage) === 'video'

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden" style={{ background: canvas }} aria-hidden>
      {hasImage ? (
        src && (
          <img
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full"
            style={{
              objectFit: st.bgFit === 'contain' ? 'contain' : 'cover',
              filter: filters.length ? filters.join(' ') : undefined,
              transform: st.bgBlur > 0 ? 'scale(1.05)' : undefined
            }}
          />
        )
      ) : (
        <span
          className="absolute inset-0"
          style={{ background: `linear-gradient(${st.bgGradientAngle}deg, ${safe(st.bgGradientFrom, '#000')}, ${safe(st.bgGradientTo, '#000')})` }}
        />
      )}
      {hasImage && st.bgDim > 0 && (
        <span className="absolute inset-0" style={{ backgroundColor: safe(st.bgDimColor, '#000'), opacity: st.bgDim }} />
      )}
      {videoFallback && (
        <span className="absolute right-[4px] bottom-[3px] z-10 flex size-[14px] items-center justify-center rounded-[3px] bg-black/55 text-white">
          <Video className="size-[9px]" />
        </span>
      )}
    </div>
  )
}
