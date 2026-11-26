import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { attachHubStore, useHubStore } from '@renderer/store/hub-store'
import { cn } from '@renderer/lib/utils'
import { NoteItem } from './replies-inbox'
import { NoteDialog } from './note-dialog'

const PANEL_W = 360

/**
 * Колокольчик в шапке: число непрочитанных и выпадающий список уведомлений
 * (ответы автора, решения по темам, объявления). Видно со всех разделов.
 */
export const HubBell: React.FC = () => {
  useEffect(() => attachHubStore(), [])
  const notes = useHubStore((s) => s.notes)
  const unread = useHubStore((s) => s.unread)
  const markRead = useHubStore((s) => s.markNotesRead)
  const clear = useHubStore((s) => s.clearNotes)
  const navigate = useNavigate()
  const open = useHubStore((s) => s.bellOpen)
  const setOpen = useHubStore((s) => s.setBellOpen)
  const focusNote = useHubStore((s) => s.focusNote)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 56, right: 8 })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Что было непрочитанным в момент открытия — подсвечиваем до закрытия.
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  // Открыли не кнопкой (а «Открыть» во всплывающем сообщении) — тоже запоминаем непрочитанные.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) setFreshIds(new Set(useHubStore.getState().notes.filter((n) => !n.read).map((n) => n.id)))
    wasOpen.current = open
  }, [open])

  // Нужное сообщение — прокрутить к нему и мигнуть рамкой.
  useEffect(() => {
    if (!open || !focusNote) return
    const t = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(focusNote)}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      el.classList.add('ring-2', 'ring-primary')
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1600)
    }, 180)
    return () => clearTimeout(t)
  }, [open, focusNote])

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (panel.current?.contains(t) || btn.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  const toggle = (): void => setOpen(!open)

  // Открытая панель — значит, человек увидел: через секунду отмечаем прочитанным.
  useEffect(() => {
    if (!open || unread === 0) return
    const t = setTimeout(() => void markRead(), 1200)
    return () => clearTimeout(t)
  }, [open, unread, markRead])

  return (
    <>
      <button
        ref={btn}
        type="button"
        data-tour="hub-bell"
        onClick={toggle}
        aria-label={unread ? `Уведомления: непрочитанных ${unread}` : 'Уведомления'}
        title={unread ? `Уведомления: новых ${unread}` : 'Уведомления'}
        className={cn(
          'app-nodrag relative inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
          open && 'bg-foreground/[0.06] text-foreground',
          // Есть непрочитанное — колокольчик цветной, его видно краем глаза.
          unread > 0 && !open && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
        )}
      >
        <Bell key={unread} className={cn('size-4.5', unread > 0 && !open && 'origin-top animate-[bell-ring_.65s_ease-in-out]')} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-bold text-primary-foreground ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <NoteDialog />
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panel}
              key="hub-bell"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              role="dialog"
              aria-label="Уведомления"
              style={{ top: pos.top, right: pos.right, width: PANEL_W }}
              className="fixed z-[90] flex max-h-[min(520px,75vh)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
            >
              <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2">
                <span className="text-sm font-semibold">Уведомления</span>
                <button
                  type="button"
                  onClick={() => void markRead()}
                  disabled={unread === 0}
                  title="Отметить всё прочитанным"
                  className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40"
                >
                  <CheckCheck className="size-3.5" /> Прочитано
                </button>
                <button
                  type="button"
                  onClick={() => void clear()}
                  disabled={notes.length === 0}
                  title="Удалить все уведомления"
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive disabled:cursor-default disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" /> Очистить
                </button>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
                {notes.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Уведомлений нет. Здесь появятся объявления автора, ответы на ваши отчёты и идеи, решения по вашим темам.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {notes.map((n) => (
                      <NoteItem key={n.id} note={n} fresh={freshIds.has(n.id) || !n.read} compact onOpen={() => setOpen(false)} />
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate('/support')
                }}
                className="cursor-pointer border-t border-border/50 bg-card/60 px-3 py-2 text-center text-xs font-medium text-primary transition hover:bg-card"
              >
                Все сообщения
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
