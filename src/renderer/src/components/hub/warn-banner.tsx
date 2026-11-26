import React, { useEffect, useMemo } from 'react'
import { Check, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { attachHubStore, useHubStore } from '@renderer/store/hub-store'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import { Linkified } from './announce-banner'

const fmtDate = (at: number): string => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/**
 * Плашка вверху окна поверх любого раздела: предупреждение (жёлтое или красное) или сообщение о
 * блокировке, пока человек не нажал «Понятно». После нажатия плашка уходит, а сообщение остаётся в
 * колокольчике с отметкой «прочитано». Сеть — только сам «Понятно» (POST /ack), без опросов.
 */
export const WarnBanner: React.FC<{ className?: string }> = ({ className }) => {
  useEffect(() => attachHubStore(), [])
  const notes = useHubStore((s) => s.notes)
  const list = useMemo(() => notes.filter((n) => (n.kind === 'warn' || n.kind === 'ban') && !n.ack), [notes])
  const ack = useHubStore((s) => s.ackWarning)
  if (!list.length) return null
  // Самое новое сверху; остальные — следующими, после «Понятно».
  const n = [...list].sort((a, b) => b.at - a.at)[0]
  return (
    <div className={cn('sticky top-0 z-30 px-4 pb-3', className)} data-tour="hub-warning">
      <WarnCard kind={n.kind === 'ban' ? 'ban' : 'warn'} lvl={n.lvl} text={n.text} at={n.at} more={list.length - 1} onAck={() => void ack(n.id)} className="mx-auto max-w-5xl shadow-lg" />
    </div>
  )
}

/** Сама плашка предупреждения (без хранилища): её же показывает предпросмотр в «Админке». */
export const WarnCard: React.FC<{
  kind: 'warn' | 'ban'
  lvl?: 'yellow' | 'red'
  text: string
  at: number
  more?: number
  onAck?: () => void
  className?: string
}> = ({ kind, lvl, text, at, more = 0, onAck, className }) => {
  const yellow = kind === 'warn' && lvl === 'yellow'
  const Icon = kind === 'ban' ? ShieldAlert : TriangleAlert
  const head = kind === 'ban' ? 'Отправка с этой установки отключена' : yellow ? 'Предупреждение от автора' : 'Строгое предупреждение от автора'
  return (
    <div role="alert" className={cn('overflow-hidden rounded-xl border-2 bg-background', yellow ? 'border-st-warn/70' : 'border-st-err/70', className)}>
      <div className={cn('flex items-start gap-3 p-3.5', yellow ? 'bg-st-warn/[0.14]' : 'bg-st-err/[0.13]')}>
        <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', yellow ? 'bg-st-warn/25 text-st-warn-text' : 'bg-st-err/25 text-st-err-text')}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn('text-sm font-black', yellow ? 'text-st-warn-text' : 'text-st-err-text')}>{head}</span>
            <span className="text-[11px] text-muted-foreground">{fmtDate(at)}</span>
            <Hint text="Личное сообщение от автора LAZEYKA для этой установки. Пользоваться программой можно как обычно. «Понятно» скрывает плашку и сообщает автору, что вы прочитали; сообщение останется в колокольчике." />
            {more > 0 && <span className="text-[11px] text-muted-foreground">ещё {more}</span>}
          </div>
          <div className="mt-1 max-h-48 select-text overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
            <Linkified text={text} />
          </div>
        </div>
        <Button
          size="sm"
          variant={yellow ? 'outline' : 'destructive'}
          className={cn('shrink-0 self-center', yellow && 'border-st-warn/60')}
          onClick={onAck}
          disabled={!onAck}
        >
          <Check /> Понятно
        </Button>
      </div>
    </div>
  )
}
