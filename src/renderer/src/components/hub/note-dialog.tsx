import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, CheckCheck, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useHubStore } from '@renderer/store/hub-store'
import { HubModal } from './modal'
import { Linkified } from './announce-banner'
import { NoteKindIcon, accentHex, goToNoteTarget, noteKindOf } from './note-kind'
import { cn } from '@renderer/lib/utils'

const fmtDate = (at: number): string =>
  new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Окно одного уведомления: тип (цвет и значок), дата, текст целиком со ссылками и действия.
 * Открывается нажатием на сообщение в колокольчике, на странице поддержки и «Открыть» во всплывающем
 * сообщении. Одно на всю программу — смонтировано в шапке рядом с колокольчиком.
 */
export const NoteDialog: React.FC = () => {
  const id = useHubStore((s) => s.openNote)
  const note = useHubStore((s) => s.notes.find((n) => n.id === s.openNote) ?? null)
  const close = useHubStore((s) => s.closeNote)
  const remove = useHubStore((s) => s.removeNote)
  const markRead = useHubStore((s) => s.markNotesRead)
  const ack = useHubStore((s) => s.ackWarning)
  const navigate = useNavigate()

  // Открыл — значит прочитал.
  useEffect(() => {
    if (note && !note.read) void markRead([note.id])
  }, [note, markRead])
  // Сообщение удалили (или его нет) — окно закрываем.
  useEffect(() => {
    if (id && !note) close()
  }, [id, note, close])

  const k = note ? noteKindOf(note) : null
  const hex = note ? accentHex(note) : null
  const isWarn = note?.kind === 'warn' || note?.kind === 'ban'
  return (
    <HubModal
      open={Boolean(note)}
      onClose={close}
      title={`${note?.emoji ? note.emoji + ' ' : ''}${note?.title || k?.label || 'Уведомление'}`}
      subtitle={note ? `${k?.label} · ${fmtDate(note.at)}` : undefined}
      className="max-w-lg"
      footer={
        note &&
        k && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-muted-foreground hover:text-destructive"
              onClick={() => {
                void remove(note.id)
                close()
              }}
            >
              <Trash2 /> Удалить
            </Button>
            {isWarn && note.ack && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <CheckCheck className="size-3.5" /> прочитано
              </span>
            )}
            <Button variant="outline" size="sm" onClick={close}>
              Закрыть
            </Button>
            {isWarn && !note.ack && (
              <Button
                size="sm"
                onClick={() => {
                  void ack(note.id)
                  close()
                }}
              >
                <Check /> Понятно
              </Button>
            )}
            {k.path && (
              <Button
                size="sm"
                onClick={() => {
                  close()
                  goToNoteTarget(navigate, k.path, k.anchor)
                }}
              >
                {k.go} <ArrowRight />
              </Button>
            )}
          </>
        )
      }
    >
      {note && k && (
        <>
          <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/50 p-3">
            <NoteKindIcon kind={note.kind} lvl={note.lvl} accent={note.accent} className="size-9" />
            <p className="pt-0.5 text-xs leading-snug text-muted-foreground">{k.hint}</p>
          </div>
          <div
            className={cn('select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed', (hex || isWarn) && 'rounded-r-xl border-l-4 py-2 pl-3 pr-2', isWarn && (note.kind === 'warn' && note.lvl === 'yellow' ? 'border-st-warn bg-st-warn/[0.06]' : 'border-st-err bg-st-err/[0.06]'))}
            style={hex ? { borderLeftColor: hex, backgroundColor: `color-mix(in oklab, ${hex} 7%, transparent)` } : undefined}
          >
            <Linkified text={note.text} />
          </div>
        </>
      )}
    </HubModal>
  )
}
