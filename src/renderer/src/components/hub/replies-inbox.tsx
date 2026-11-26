import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, ChevronDown, RefreshCw, X } from 'lucide-react'
import { NoteKindIcon, accentHex, noteKindOf } from './note-kind'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { attachHubStore, useHubStore } from '@renderer/store/hub-store'
import { cn } from '@renderer/lib/utils'
import { Hint } from '@renderer/components/prematch/hint'
import type { HubNote } from '@renderer/utils/hub-api'

const fmtDate = (at: number): string =>
  new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

const SHOWN = 5

/**
 * Одно сообщение в списке: значок типа (свой цвет), заголовок, дата, начало текста.
 * Нажатие открывает окно с сообщением целиком; «×» удаляет.
 */
export const NoteItem: React.FC<{ note: HubNote; fresh: boolean; compact?: boolean; onOpen?: () => void }> = ({ note, fresh, compact, onOpen }) => {
  const remove = useHubStore((s) => s.removeNote)
  const show = useHubStore((s) => s.showNote)
  const k = noteKindOf(note)
  const hex = accentHex(note)
  const isWarn = note.kind === 'warn' || note.kind === 'ban'
  const open = (): void => {
    onOpen?.()
    show(note.id)
  }
  return (
    <li
      data-note-id={note.id}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      title="Открыть сообщение"
      className={cn(
        'group relative flex cursor-pointer gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 transition-colors',
        fresh ? 'border-border bg-card/80 hover:bg-card' : 'border-border/50 bg-background/40 hover:bg-card/60'
      )}
      style={hex ? { backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${hex} ${fresh ? 10 : 6}%, transparent), transparent 70%)` } : undefined}
    >
      {/* Полоса слева: у непрочитанного, у объявления с цветом и у предупреждения без «Понятно» — всегда. */}
      {(fresh || hex || (isWarn && !note.ack)) && <span className={cn('absolute inset-y-0 left-0 w-1', !hex && k.bar)} style={hex ? { background: hex } : undefined} />}
      <NoteKindIcon kind={note.kind} lvl={note.lvl} accent={note.accent} className={compact ? 'size-8' : 'size-9'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={cn('min-w-0 truncate font-semibold', fresh ? 'text-foreground' : 'text-foreground/80')}>
            {note.emoji && <span className="mr-1">{note.emoji}</span>}
            {note.title || k.label}
          </span>
          {fresh && <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">новое</span>}
          {isWarn && note.ack && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground" title="Вы нажали «Понятно»">
              <CheckCheck className="size-3" /> прочитано
            </span>
          )}
          <span className="ml-auto shrink-0">{fmtDate(note.at)}</span>
          <button
            type="button"
            aria-label="Удалить сообщение"
            title="Удалить"
            onClick={(e) => {
              e.stopPropagation()
              void remove(note.id)
            }}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-50 transition hover:bg-destructive/15 hover:text-destructive hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
        <div className={cn('mt-0.5 text-[13px] leading-snug', compact ? 'line-clamp-2' : 'line-clamp-3', fresh ? 'text-foreground' : 'text-muted-foreground')}>{note.text}</div>
      </div>
    </li>
  )
}

/**
 * Карточка «Ответы автора»: ответы и решения по темам. Последние 5, остальные — «Показать все».
 * Показанные на экране сообщения отмечаются прочитанными (подсветка остаётся до ухода со страницы).
 */
export const RepliesInbox: React.FC<{ className?: string; hideWhenEmpty?: boolean }> = ({ className, hideWhenEmpty = true }) => {
  useEffect(() => attachHubStore(), [])
  const notes = useHubStore((s) => s.notes)
  const markRead = useHubStore((s) => s.markNotesRead)
  const checking = useHubStore((s) => s.checking)
  const checkNow = useHubStore((s) => s.checkNow)
  const [all, setAll] = useState(false)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const seen = useRef(new Set<string>())

  const replies = useMemo(() => notes.filter((n) => n.kind !== 'announce'), [notes])
  const visible = all ? replies : replies.slice(0, SHOWN)

  useEffect(() => {
    const add = replies.filter((r) => !r.read && !seen.current.has(r.id)).map((r) => r.id)
    if (add.length) {
      add.forEach((id) => seen.current.add(id))
      setFresh((prev) => new Set([...prev, ...add]))
    }
  }, [replies])

  // Прочитанными считаются только показанные на экране.
  const unreadShown = visible.filter((r) => !r.read).map((r) => r.id)
  const key = unreadShown.join(',')
  useEffect(() => {
    if (!key) return
    const t = setTimeout(() => void markRead(key.split(',')), 1500)
    return () => clearTimeout(t)
  }, [key, markRead])

  const check = async (): Promise<void> => {
    const reached = await checkNow()
    if (reached) toast.success('Проверено', { description: 'Новые ответы и объявления, если они есть, уже показаны.' })
    else toast.error('Сервер не ответил', { description: 'Проверьте подключение к интернету и попробуйте позже.' })
  }

  if (replies.length === 0 && hideWhenEmpty) return null
  return (
    <div className={cn('ui-card relative rounded-2xl border border-border bg-card p-4', className)} data-tour="support-replies">
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-[14px] font-bold text-[color:var(--text-title)]">Ответы автора</h3>
        <Hint text="Ответы на отчёты, идеи и решения по отправленным темам. Программа проверяет их примерно через 10 секунд после запуска, при разворачивании окна и раз в 30 минут; кнопка «Проверить» спрашивает сразу. Новое приходит уведомлением, колокольчик в шапке показывает непрочитанное." />
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void check()} disabled={checking} title="Спросить сервер прямо сейчас">
          <RefreshCw className={cn(checking && 'animate-spin')} /> Проверить
        </Button>
      </div>
      {replies.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ответов пока нет.</p>
      ) : (
        <>
          <ul className={cn('space-y-2', all && 'custom-scrollbar max-h-[420px] overflow-y-auto pr-1')}>
            {visible.map((r) => (
              <NoteItem key={r.id} note={r} fresh={fresh.has(r.id) || !r.read} />
            ))}
          </ul>
          {replies.length > SHOWN && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
              <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} />
              {all ? 'Свернуть' : `Показать все (${replies.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
