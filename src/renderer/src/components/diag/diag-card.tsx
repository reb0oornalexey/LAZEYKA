import React from 'react'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn } from '@renderer/lib/utils'
import type { Tone } from '@renderer/utils/diag-api'

/** Карточка страницы «Диагностика»: заголовок, подсказка, кнопка справа (язык «Сигнал»). */
export const DiagCard: React.FC<{
  icon?: React.ReactNode
  title: string
  hint: string
  sub?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  tour?: string
}> = ({ title, hint, sub, action, children, tour }) => (
  <LzPanel data-tour={tour} className="space-y-3 p-4">
    <LzSectionHead title={title} hint={hint} sub={sub} right={action} />
    {children}
  </LzPanel>
)

export const TONE_BOX: Record<Tone, string> = {
  ok: 'border-primary/30 bg-primary/[0.06]',
  warn: 'border-st-warn/40 bg-st-warn/[0.08]',
  bad: 'border-st-err/45 bg-st-err/[0.08]',
  info: 'border-foreground/[0.08] bg-foreground/[0.03]'
}
export const TONE_DOT: Record<Tone, string> = { ok: 'bg-primary', warn: 'bg-st-warn', bad: 'bg-st-err', info: 'bg-muted-foreground' }

/** Список строк с цветной точкой. */
export const ToneList: React.FC<{ items: { kind: Tone; text: string }[] }> = ({ items }) => (
  <ul className="space-y-1.5 text-xs">
    {items.map((it, i) => (
      <li key={i} className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[it.kind])} />
        <span>{it.text}</span>
      </li>
    ))}
  </ul>
)
