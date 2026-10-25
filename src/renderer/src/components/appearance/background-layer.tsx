import React, { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isSafeCssValue } from '@renderer/lib/appearance/color'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { bgKind, bgUrl, getPoster } from '@renderer/lib/appearance/bg-media'

export { bgUrl }

const safe = (v: string, def: string): string => (isSafeCssValue(v) ? v : def)

/**
 * Нужно ли сейчас анимировать фон. Всё по событиям: видимость документа, сигнал
 * окна от главного процесса (hide/minimize/show/restore/focus/blur) и focus/blur.
 * Никаких таймеров. Пока окно скрыто (или не в фокусе при включённой паузе),
 * видео стоит на паузе, а GIF заменён неподвижным кадром — нагрузка ~0.
 */
function useBgActive(enabled: boolean, animate: boolean, pauseOnBlur: boolean): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    if (!enabled) return
    const onVis = (): void => setVisible(document.visibilityState !== 'hidden')
    const onFocus = (): void => setFocused(true)
    const onBlur = (): void => setFocused(false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const off = window.electron.ipcRenderer.on('window:visibility', (_e, kind: string) => {
      if (kind === 'hide' || kind === 'minimize') setVisible(false)
      else if (kind === 'show' || kind === 'restore') setVisible(true)
      else if (kind === 'focus') setFocused(true)
      else if (kind === 'blur') setFocused(false)
    })
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      off()
    }
  }, [enabled])
  return animate && visible && (!pauseOnBlur || focused)
}

function usePoster(name: string, wanted: boolean): string | null {
  const [poster, setPoster] = useState<{ name: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!wanted || !name) return
    let alive = true
    getPoster(name).then((src) => alive && setPoster({ name, src }))
    return () => {
      alive = false
    }
  }, [name, wanted])
  return poster && poster.name === name ? poster.src : null
}

const objectFit = (fit: AppearanceFit): React.CSSProperties['objectFit'] => (fit === 'contain' ? 'contain' : 'cover')

/**
 * Слой фона: одна фиксированная картинка / GIF / видео (или градиент) под всем
 * интерфейсом. Размытие и затемнение — статичные CSS-свойства. `staticOnly`
 * (предпросмотр) никогда не запускает второй декодер — только неподвижный кадр.
 */
const BackgroundLayerImpl: React.FC<{ settings: AppearanceSettings; staticOnly?: boolean; className?: string }> = ({
  settings: st,
  staticOnly,
  className
}) => {
  const kind = st.bgImage ? bgKind(st.bgImage) : null
  const animated = kind === 'animated' || kind === 'video'
  const active = useBgActive(animated && !staticOnly, st.bgAnimate, st.bgPauseOnBlur) && !staticOnly
  const needPoster = kind === 'video' ? Boolean(staticOnly) : kind === 'animated' && !active
  const poster = usePoster(st.bgImage, needPoster)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    if (active) v.play().catch(() => undefined)
    else v.pause()
  }, [active, st.bgImage])

  const hasImage = Boolean(st.bgImage)
  if (!hasImage && !st.bgGradient) return null

  // Фильтры — только на самой картинке / видео внутри этого слоя. Ни у body, ни у
  // контейнеров интерфейса filter и backdrop-filter нет, поэтому текст остаётся чётким.
  const filter: React.CSSProperties = {}
  if (hasImage) {
    const parts: string[] = []
    if (st.bgBlur > 0) parts.push(`blur(${st.bgBlur}px)`)
    if (st.bgBrightness !== 1) parts.push(`brightness(${st.bgBrightness})`)
    if (st.bgSaturation !== 1) parts.push(`saturate(${st.bgSaturation})`)
    if (parts.length) filter.filter = parts.join(' ')
    // Небольшое увеличение прячет светлую кайму по краям при размытии.
    if (st.bgBlur > 0) filter.transform = 'scale(1.05)'
  }

  let media: React.ReactNode = null
  if (hasImage && kind === 'video' && !staticOnly) {
    media = (
      <video
        ref={videoRef}
        src={bgUrl(st.bgImage)}
        muted
        loop
        playsInline
        preload="auto"
        autoPlay={active}
        disablePictureInPicture
        disableRemotePlayback
        controls={false}
        tabIndex={-1}
        className="absolute inset-0 size-full"
        style={{ objectFit: objectFit(st.bgFit), ...filter }}
        onLoadedData={() => active && videoRef.current?.play().catch(() => undefined)}
      />
    )
  } else {
    const style: React.CSSProperties = { ...filter }
    if (hasImage) {
      // Анимированный файл: живой, пока активен; иначе — неподвижный первый кадр.
      const src = kind === 'image' ? bgUrl(st.bgImage) : kind === 'animated' && active ? bgUrl(st.bgImage) : poster
      if (src) {
        style.backgroundImage = `url("${src}")`
        style.backgroundPosition = 'center'
        style.backgroundSize = st.bgFit === 'cover' ? 'cover' : st.bgFit === 'contain' ? 'contain' : 'auto'
        style.backgroundRepeat = st.bgFit === 'tile' ? 'repeat' : 'no-repeat'
      }
    } else {
      style.backgroundImage = `linear-gradient(${st.bgGradientAngle}deg, ${safe(st.bgGradientFrom, '#000')}, ${safe(st.bgGradientTo, '#000')})`
    }
    media = <div className="absolute inset-0" style={style} />
  }

  return (
    <div
      aria-hidden
      id={staticOnly ? undefined : 'app-bg'}
      className={`pointer-events-none inset-0 -z-10 overflow-hidden ${staticOnly ? 'absolute' : 'fixed'} ${className ?? ''}`}
      // Слой изолирован: его перерисовка не задевает интерфейс. Стиль меняется только вместе с настройками фона.
      style={{ contain: 'strict', willChange: 'transform', isolation: 'isolate' }}
    >
      {media}
      {hasImage && st.bgDim > 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: safe(st.bgDimColor, '#000'), opacity: st.bgDim }} />
      )}
    </div>
  )
}

export const BackgroundLayer = React.memo(BackgroundLayerImpl, (a, b) => {
  const x = a.settings
  const y = b.settings
  return (
    a.staticOnly === b.staticOnly &&
    a.className === b.className &&
    x.bgImage === y.bgImage && x.bgFit === y.bgFit && x.bgBlur === y.bgBlur && x.bgDim === y.bgDim &&
    x.bgBrightness === y.bgBrightness && x.bgSaturation === y.bgSaturation && x.bgDimColor === y.bgDimColor &&
    x.bgGradient === y.bgGradient && x.bgGradientFrom === y.bgGradientFrom && x.bgGradientTo === y.bgGradientTo &&
    x.bgGradientAngle === y.bgGradientAngle && x.bgAnimate === y.bgAnimate && x.bgPauseOnBlur === y.bgPauseOnBlur
  )
})

/** Фон главного окна: берёт настройки из хранилища. */
export const AppBackground: React.FC = () => {
  const settings = useAppearanceStore(useShallow((s) => s.settings))
  return <BackgroundLayer settings={settings} />
}
