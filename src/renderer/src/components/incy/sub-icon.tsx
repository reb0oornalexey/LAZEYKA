import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Globe, ImagePlus, Star } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'

interface IconInfo {
  icon: string | null
  custom: boolean
  from?: string
}

type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string }
const ipc = <T,>(ch: string, ...args: unknown[]): Promise<T> =>
  (window.electron.ipcRenderer.invoke(ch, ...args) as Promise<IpcResult<T>>).then((r) => {
    if (!r || !r.ok) throw new Error((r as { message?: string })?.message ?? 'Ошибка')
    return r.value
  })

// Общий для всех значков на странице: один запрос, обновление по событию из main.
let cache: Record<string, IconInfo> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
function reload(): Promise<void> {
  loading = ipc<Record<string, IconInfo>>('incy:subIcons')
    .then((v) => {
      cache = v
      listeners.forEach((f) => f())
    })
    .catch(() => void 0)
  return loading
}
let subscribed = false
function useIcons(): Record<string, IconInfo> {
  const [, force] = useState(0)
  useEffect(() => {
    const f = (): void => force((n) => n + 1)
    listeners.add(f)
    if (!subscribed) {
      subscribed = true
      window.electron.ipcRenderer.on('incy:subIconsChanged', () => void reload())
    }
    if (!cache && !loading) void reload()
    return () => {
      listeners.delete(f)
    }
  }, [])
  return cache ?? {}
}

/**
 * Значок провайдера у подписки. Картинка — с сайта или из Telegram провайдера (ссылки из подписки);
 * нет картинки — звёздочка, как раньше. Нажатие — свой значок, вернуть с сайта или звёздочку.
 */
export const SubIcon: React.FC<{ subId: string; title: string; size?: 'sm' | 'md'; readOnly?: boolean }> = ({ subId, title, size = 'md', readOnly }) => {
  const icons = useIcons()
  const info = icons[subId]
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const px = size === 'sm' ? 'size-4' : 'size-5'

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-subicon-menu]')) setMenu(null)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])

  const set = async (v: string | null): Promise<void> => {
    setMenu(null)
    try {
      await ipc('incy:subIconSet', subId, v)
      if (v === null) toast.success('Ищу значок на сайте провайдера…')
    } catch (e) {
      toast.error('Значок не изменён', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const onFile = (f: File | undefined): void => {
    if (!f) return
    if (f.size > 512 * 1024) {
      toast.error('Картинка слишком большая', { description: 'Нужен файл до 512 КБ.' })
      return
    }
    const r = new FileReader()
    r.onload = () => void set(String(r.result))
    r.readAsDataURL(f)
  }

  const hint = info?.custom
    ? 'Свой значок. Нажмите, чтобы сменить'
    : info?.icon
      ? `Значок провайдера${info.from ? ` (${info.from.replace(/^https?:\/\//, '').replace(/\/$/, '')})` : ''}. Нажмите, чтобы сменить`
      : 'Значок провайдера не найден. Нажмите, чтобы поставить свой'

  if (readOnly) {
    return info?.icon ? (
      <img src={info.icon} alt="" draggable={false} className={cn('shrink-0 rounded-md object-cover', px)} />
    ) : (
      <Star className="size-3.5 shrink-0 text-muted-foreground" />
    )
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={hint}
        aria-label={`Значок подписки «${title}»`}
        onClick={(e) => {
          e.stopPropagation()
          const r = btn.current?.getBoundingClientRect()
          if (r) setMenu({ x: r.left, y: r.bottom + 4 })
        }}
        className={cn('inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md transition hover:ring-2 hover:ring-primary/40', px)}
      >
        {info?.icon ? (
          <img src={info.icon} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <Star className="size-4 fill-st-warn text-st-warn-text" />
        )}
      </button>
      <input ref={pickRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/svg+xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {menu &&
        createPortal(
          <div
            data-subicon-menu
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            className="fixed z-[95] w-60 overflow-hidden rounded-xl border border-border bg-popover p-1 text-xs shadow-lg"
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Значок подписки</div>
            <button type="button" role="menuitem" onClick={() => pickRef.current?.click()} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-primary/10">
              <ImagePlus className="size-3.5" /> Выбрать свою картинку…
            </button>
            <button type="button" role="menuitem" onClick={() => void set(null)} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-primary/10">
              <Globe className="size-3.5" /> Взять с сайта провайдера
            </button>
            <button type="button" role="menuitem" onClick={() => void set('star')} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-primary/10">
              <Star className="size-3.5" /> Звёздочка
            </button>
            <p className="px-2.5 pb-1.5 pt-1 text-[10.5px] leading-snug text-muted-foreground">
              Значок берётся с сайта или из Telegram провайдера по ссылкам из подписки — при её обновлении, не чаще раза в неделю.
            </p>
          </div>,
          document.body
        )}
    </>
  )
}
