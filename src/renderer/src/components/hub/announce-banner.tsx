import React, { useEffect } from 'react'
import { Megaphone, X } from 'lucide-react'
import { toast } from 'sonner'
import { openExternalUrl } from '@renderer/utils/ipc'
import { attachHubStore, useHubStore } from '@renderer/store/hub-store'
import { cn } from '@renderer/lib/utils'
import type { HubAnnounce } from '@renderer/utils/hub-api'
import { DON_PALETTE } from '@renderer/utils/hub-donations-api'

const LINK_RE = /https?:\/\/[^\s<>"']+/gi

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null
  } catch {
    return null
  }
}

/** Текст, в котором ссылки http/https кликабельны (открываются в браузере через IPC программы). */
export const Linkified: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0
    let url = m[0]
    const trail = /[.,;:!?)\]»]+$/.exec(url)
    if (trail) url = url.slice(0, -trail[0].length)
    const safe = safeUrl(url)
    if (start > last) parts.push(text.slice(last, start))
    if (safe) {
      parts.push(
        <button
          key={key++}
          type="button"
          onClick={() => openExternalUrl(safe).catch((e) => toast.error('Не удалось открыть ссылку', { description: e instanceof Error ? e.message : String(e) }))}
          className="cursor-pointer break-all text-primary underline underline-offset-2 hover:opacity-80"
        >
          {url}
        </button>
      )
    } else parts.push(url)
    last = start + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className={cn('whitespace-pre-wrap', className)}>{parts}</span>
}

const fmtDay = (t: number): string => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

/**
 * Одна плашка объявления — так она выглядит на главной. Без хранилища: её же показывает «Предпросмотр»
 * в панели автора. onClose не передан — кнопки «Закрыть» нет.
 */
export const AnnounceCard: React.FC<{ announce: Pick<HubAnnounce, 'text' | 're' | 'reAt' | 'emoji' | 'accent'>; onClose?: () => void; className?: string }> = ({ announce, onClose, className }) => {
  // Цвет акцента (Б12): полоса слева, значок и лёгкий фон. Без него — как раньше, в цвете темы.
  const hex = announce.accent && Object.prototype.hasOwnProperty.call(DON_PALETTE, announce.accent) ? DON_PALETTE[announce.accent] : null
  return (
  <div
    className={cn('relative flex items-start gap-3 overflow-hidden rounded-xl border p-4', !hex && 'border-primary/30 bg-primary/10', hex && 'pl-5', className)}
    style={hex ? { borderColor: `color-mix(in oklab, ${hex} 40%, transparent)`, backgroundColor: `color-mix(in oklab, ${hex} 10%, transparent)` } : undefined}
    role="status"
  >
    {hex && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: hex }} />}
    {announce.emoji ? (
      <span aria-hidden className="-mt-0.5 shrink-0 text-xl leading-none">
        {announce.emoji}
      </span>
    ) : (
      <Megaphone className={cn('mt-0.5 size-4 shrink-0', !hex && 'text-primary')} style={hex ? { color: hex } : undefined} />
    )}
    <div className="min-w-0 flex-1 select-text text-sm leading-snug">
      {announce.re && (
        <div className={cn('mb-0.5 text-[11px] font-medium', !hex && 'text-primary')} style={hex ? { color: `color-mix(in oklab, ${hex} 80%, var(--foreground))` } : undefined}>
          Дополнение{announce.reAt ? ` к объявлению от ${fmtDay(announce.reAt)}` : ''}
        </div>
      )}
      <Linkified text={announce.text} />
    </div>
    {onClose && (
      <button
        type="button"
        aria-label="Закрыть объявление"
        title="Закрыть: это объявление больше не покажется"
        onClick={onClose}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    )}
  </div>
  )
}

/**
 * Объявления автора на главной: все подходящие активные (до 3), новые сверху.
 * «Закрыть» у каждого своё: закрытое больше не показывается, остальные остаются.
 */
export const AnnounceBanner: React.FC<{ className?: string }> = ({ className }) => {
  useEffect(() => attachHubStore(), [])
  const announces = useHubStore((s) => s.announces)
  const dismiss = useHubStore((s) => s.dismissAnnounce)
  if (!announces.length) return null
  return (
    <div className={cn('space-y-2', className)}>
      {announces.map((a) => (
        <AnnounceCard key={a.id} announce={a} onClose={() => void dismiss(a.id)} />
      ))}
    </div>
  )
}
