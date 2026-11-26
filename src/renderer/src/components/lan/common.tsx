import { useState } from 'react'
import { Check, Copy, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

export function Card({
  title,
  hint,
  right,
  children,
  className,
  tour
}: {
  title: string
  hint?: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Метка для экскурсии по настройкам (data-tour). */
  tour?: string
}): React.ReactElement {
  return (
    <LzPanel data-tour={tour} className={cn('p-4', className)}>
      <LzSectionHead title={title} hint={hint} right={right} className="mb-3" />
      {children}
    </LzPanel>
  )
}

export function CopyButton({ text, label = 'Скопировать' }: { text: string; label?: string }): React.ReactElement {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 text-xs"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          })
          .catch(() => toast.error('Не удалось скопировать'))
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  )
}

export function Notice({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2 text-xs leading-relaxed',
        tone === 'warn' ? 'border-st-warn/30 bg-st-warn/[0.08] text-st-warn-text' : 'border-foreground/[0.07] bg-foreground/[0.035] text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}

/** Короткая подсказка рядом с QR: VPN на телефоне может не пускать к адресам домашней сети. */
export function PhoneVpnHint({ text, className }: { text: string; className?: string }): React.ReactElement {
  return (
    <p data-tour="lan-phone-vpn-hint" className={cn('flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground', className)}>
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-st-warn-text" />
      <span>{text}</span>
    </p>
  )
}
