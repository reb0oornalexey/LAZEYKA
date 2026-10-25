import React, { memo, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ImageOff, ImagePlus, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import { ColorPicker, Swatch } from './color-picker'
import { Ctl, InfoTip, SectionCard, Segmented, SliderRow } from './section'
import { cn } from '@renderer/lib/utils'
import { useAppearanceStore } from '@renderer/lib/appearance/store'
import { BUILTIN_WALLPAPERS } from '@renderer/lib/appearance/wallpapers'
import { bgKind, bgUrl, getPoster, isBuiltin } from '@renderer/lib/appearance/bg-media'
import { applyThemeFromWallpaper } from '@renderer/lib/appearance/wallpaper-theme'
import { appearanceListBackgrounds, appearancePickBackground, appearanceRemoveBackground } from '@renderer/utils/ipc'
import { builtinById } from '@renderer/lib/appearance/wallpapers'

/** Картинка для плитки: у встроенных — сама, у своих — неподвижный кадр (у видео и GIF тоже). */
function useThumb(name: string): string | null {
  const [src, setSrc] = useState<{ name: string; src: string | null } | null>(null)
  useEffect(() => {
    if (isBuiltin(name)) return
    let alive = true
    if (bgKind(name) === 'image') {
      // Обычная картинка грузится прямо из защищённой папки, декодирование — браузером.
      return
    }
    getPoster(name).then((p) => alive && setSrc({ name, src: p }))
    return () => {
      alive = false
    }
  }, [name])
  if (isBuiltin(name)) return builtinById(name)?.src ?? null
  if (bgKind(name) === 'image') return bgUrl(name)
  return src && src.name === name ? src.src : null
}

const tileBase =
  'group relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border-2 bg-background text-left transition-all duration-150 hover:-translate-y-0.5 hover:brightness-110'
const tileOn = 'border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_28%,transparent),0_0_18px_color-mix(in_oklab,var(--primary)_35%,transparent)]'

const Tile = memo(function Tile({
  name,
  caption,
  selected,
  onSelect,
  onRemove
}: {
  name: string
  caption: string
  selected: boolean
  onSelect: (name: string) => void
  onRemove?: (name: string) => void
}) {
  const src = useThumb(name)
  return (
    <div className="group relative">
      <button type="button" onClick={() => onSelect(name)} className={cn(tileBase, selected ? tileOn : 'border-border hover:border-primary/60')}>
        {src && <img src={src} alt="" draggable={false} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1 text-[11px] leading-tight font-medium text-white truncate">
          {caption}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          title="Удалить файл"
          onClick={() => onRemove(name)}
          className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
})

function SolidColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-1 text-xs">
      <span>{label}</span>
      <ColorPicker value={value} onChange={onChange} title={label}>
        <button type="button" className="block h-5 w-8 cursor-pointer rounded-md border border-border">
          <Swatch color={value} className="size-full rounded-[5px]" />
        </button>
      </ColorPicker>
    </div>
  )
}

const CALLOUT_KEY = 'lazeyka.appearance.calloutSeen'
const seenCallout = (): boolean => {
  try {
    return localStorage.getItem(CALLOUT_KEY) === '1'
  } catch {
    return false
  }
}

export const WallpaperCard: React.FC = () => {
  const st = useAppearanceStore(useShallow((s) => s.settings))
  const setSettings = useAppearanceStore((s) => s.setSettings)
  const [files, setFiles] = useState<string[]>([])
  const [more, setMore] = useState(false)
  const [seen, setSeen] = useState(seenCallout)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    appearanceListBackgrounds()
      .then(setFiles)
      .catch(() => undefined)
  }, [])
  useEffect(refresh, [refresh])

  const select = useCallback(
    (name: string) => {
      const s = useAppearanceStore.getState().settings
      // Цвета не трогаем: только обои. Прозрачность панелей нужна, чтобы фон вообще был виден.
      useAppearanceStore.getState().setSettings({ bgImage: name, panelOpacity: s.panelOpacity >= 1 ? 0.8 : s.panelOpacity })
    },
    []
  )
  const remove = useCallback(
    async (name: string) => {
      try {
        await appearanceRemoveBackground(name)
        if (useAppearanceStore.getState().settings.bgImage === name) useAppearanceStore.getState().setSettings({ bgImage: '' })
        refresh()
      } catch (e) {
        toast.error('Не удалось удалить файл', { description: e instanceof Error ? e.message : String(e) })
      }
    },
    [refresh]
  )
  const upload = async (): Promise<void> => {
    try {
      const name = await appearancePickBackground()
      if (name) {
        select(name)
        refresh()
      }
    } catch (e) {
      toast.error('Не удалось выбрать картинку', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  const suggest = async (): Promise<void> => {
    try {
      localStorage.setItem(CALLOUT_KEY, '1')
    } catch {
      /* noop */
    }
    setSeen(true)
    setBusy(true)
    await applyThemeFromWallpaper(st.bgImage)
    setBusy(false)
  }

  const hasBg = Boolean(st.bgImage)
  const builtin = isBuiltin(st.bgImage)
  const animated = hasBg && bgKind(st.bgImage) !== 'image'

  return (
    <SectionCard
      icon={ImagePlus}
      title="Фон"
      tip="PNG, JPG, WebP, GIF, MP4 или WebM. Картинка до 25 МБ (крупнее экрана — уменьшится), GIF и анимированный WebP до 30 МБ, видео до 50 МБ. Файл копируется в папку данных программы."
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,170px))] gap-1.5">
        <button
          type="button"
          onClick={() => setSettings({ bgImage: '' })}
          className={cn(tileBase, 'flex flex-col items-center justify-center gap-1 bg-[#0b0d10] text-white/80', !hasBg ? tileOn : 'border-border hover:border-primary/60')}
        >
          <ImageOff className="size-4" />
          <span className="text-[10px] font-medium">Без фона</span>
        </button>
        {BUILTIN_WALLPAPERS.map((w) => (
          <Tile key={w.id} name={w.id} caption={`${w.category} · ${w.name}`} selected={st.bgImage === w.id} onSelect={select} />
        ))}
        {files.map((f) => (
          <Tile key={f} name={f} caption={bgKind(f) === 'video' ? 'Видео' : bgKind(f) === 'animated' ? 'Анимация' : 'Моё'} selected={st.bgImage === f} onSelect={select} onRemove={remove} />
        ))}
      </div>
      <Button size="sm" variant="outline" className="mt-2 w-full border-primary text-primary hover:bg-primary/10" onClick={upload}>
        <ImagePlus /> Загрузить свою картинку
      </Button>

      {hasBg && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/60 bg-primary/5 px-2.5 py-2">
          <span className="relative shrink-0">
            <Sparkles className="size-4 text-primary" />
            {!seen && <span className="absolute -top-1 -right-1 size-2 animate-[pulse_1.2s_ease-in-out_3] rounded-full bg-primary" />}
          </span>
          <span className="min-w-0 flex-1 text-xs leading-snug">
            {builtin ? 'Для этих обоев тема уже готова' : 'Сделать тему под этот фон — подберём все цвета автоматически'}
          </span>
          <Button size="xs" onClick={suggest} disabled={busy}>
            {builtin ? 'Применить подобранную тему' : 'Подобрать'}
          </Button>
        </div>
      )}

      {(hasBg || st.bgGradient) && (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3">
          <SliderRow id="setting:bgBlur" label="Размытие" value={st.bgBlur} min={0} max={40} step={1} format={(v) => `${Math.round(v)} px`} onChange={(v) => setSettings({ bgBlur: v })} />
          <SliderRow id="setting:bgDim" label="Затемнение" value={st.bgDim} min={0} max={0.9} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings({ bgDim: v })} />
          <SliderRow
            id="setting:panelOpacity"
            label="Прозрачность панелей"
            value={1 - st.panelOpacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setSettings({ panelOpacity: Math.round((1 - v) * 100) / 100 })}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="mt-2 flex w-full cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
        Ещё настройки фона
      </button>
      {more && (
        <div className="mt-1 space-y-1.5">
          {hasBg && (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-3">
                <SliderRow id="setting:bgBrightness" label="Яркость" value={st.bgBrightness} min={0.5} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings({ bgBrightness: v })} />
                <SliderRow id="setting:bgSaturation" label="Насыщенность" value={st.bgSaturation} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setSettings({ bgSaturation: v })} />
              </div>
              <SolidColorRow label="Цвет затемнения" value={st.bgDimColor} onChange={(v) => setSettings({ bgDimColor: v })} />
              <Ctl id="setting:bgFit" className="flex items-center justify-between px-1 text-xs">
                <span>Режим</span>
                <Segmented
                  value={st.bgFit}
                  options={[
                    { id: 'cover', label: 'Заполнить' },
                    { id: 'contain', label: 'Вписать' },
                    { id: 'tile', label: 'Плитка' }
                  ]}
                  onChange={(v) => setSettings({ bgFit: v })}
                />
              </Ctl>
            </>
          )}
          {animated && (
            <>
              <div className="flex items-center justify-between px-1 text-xs">
                <span>Анимация фона</span>
                <Switch size="sm" checked={st.bgAnimate} onCheckedChange={(v) => setSettings({ bgAnimate: v })} />
              </div>
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="flex items-center gap-1">
                  Пауза без фокуса <InfoTip text="Когда окно свёрнуто или скрыто в трей, видео ставится на паузу, а GIF заменяется неподвижным кадром." />
                </span>
                <Switch size="sm" checked={st.bgPauseOnBlur} onCheckedChange={(v) => setSettings({ bgPauseOnBlur: v })} />
              </div>
            </>
          )}
          {hasBg && (
            <div className="flex items-center justify-between px-1 text-xs">
              <span className="flex items-center gap-1">
                Стекло <InfoTip text="Размывает то, что за панелями. Красиво, но нагружает видеокарту — по умолчанию выключено." />
              </span>
              <Switch size="sm" checked={st.bgGlass} onCheckedChange={(v) => setSettings({ bgGlass: v })} />
            </div>
          )}
          {!hasBg && (
            <>
              <div className="flex items-center justify-between px-1 text-xs">
                <span>Градиент вместо сплошного фона</span>
                <Switch size="sm" checked={st.bgGradient} onCheckedChange={(v) => setSettings({ bgGradient: v })} />
              </div>
              {st.bgGradient && (
                <>
                  <SolidColorRow label="Начало" value={st.bgGradientFrom} onChange={(v) => setSettings({ bgGradientFrom: v })} />
                  <SolidColorRow label="Конец" value={st.bgGradientTo} onChange={(v) => setSettings({ bgGradientTo: v })} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </SectionCard>
  )
}
