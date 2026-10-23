import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ExternalLink, History, Loader2, RefreshCw, X } from 'lucide-react'
import { ReleaseBody } from '@renderer/components/update-window'
import { cn } from '@renderer/lib/utils'
import { appGetReleaseHistory, openExternalUrl, type AppReleaseNote } from '@renderer/utils/ipc'

const PAGE_SIZE = 10
/** Больше релизов не подгружаем — окно не должно превращаться в бесконечную ленту. */
const MAX_NOTES = 30

function formatDate(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function Note({ note, defaultOpen }: { note: AppReleaseNote; defaultOpen: boolean }): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const date = formatDate(note.publishedAt)
  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        note.installed ? 'border-primary/40 bg-primary/[0.06]' : 'border-border/60 bg-card/60'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('font-mono text-sm font-bold', note.installed ? 'text-primary' : 'text-foreground')}>
            v{note.version}
          </span>
          {note.installed && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
              Ваша версия
            </span>
          )}
          {date && <span className="text-[11px] text-muted-foreground">{date}</span>}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="-mt-1 px-4 pb-4">
          <ReleaseBody body={note.body} />
          {note.url && (
            <button
              type="button"
              onClick={() => void openExternalUrl(note.url!)}
              className="mt-3 inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              Релиз на GitHub <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Окно «Что нового в LAZEYKA»: релизы с GitHub от новых к старым. */
export function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const [notes, setNotes] = useState<AppReleaseNote[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(async (p: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const list = await appGetReleaseHistory(p, PAGE_SIZE)
      setNotes((prev) => {
        const seen = new Set(prev.map((n) => n.tag))
        return p === 1 ? list : [...prev, ...list.filter((n) => !seen.has(n.tag))]
      })
      setHasMore(list.length >= PAGE_SIZE && p * PAGE_SIZE < MAX_NOTES)
      setPage(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && notes.length === 0) void loadPage(1)
  }, [open, notes.length, loadPage])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="changelog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative flex max-h-[min(640px,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
          >
            <div className="flex items-center gap-3 px-6 pb-3 pt-5">
              <History className="size-5 text-primary" />
              <h2 className="flex-1 text-lg font-black tracking-tight">Что нового в LAZEYKA</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={onClose}
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 select-text space-y-2.5 overflow-y-auto px-6 pb-5">
              {notes.map((n, i) => (
                <Note key={n.tag} note={n} defaultOpen={n.installed || i === 0} />
              ))}
              {loading && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Загружаю список версий с GitHub…
                </div>
              )}
              {error && !loading && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                  {error}
                  <button
                    type="button"
                    onClick={() => void loadPage(notes.length === 0 ? 1 : page + 1)}
                    className="ml-2 inline-flex cursor-pointer items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    <RefreshCw className="size-3" /> Повторить
                  </button>
                </div>
              )}
              {!loading && !error && hasMore && notes.length > 0 && (
                <button
                  type="button"
                  onClick={() => void loadPage(page + 1)}
                  className="w-full cursor-pointer rounded-xl border border-dashed border-border/70 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  Показать более ранние версии
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/** Номер версии LAZEYKA, по клику открывающий «Что нового». */
export function AppVersionButton({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="Что нового"
        onClick={() => setOpen(true)}
        className={cn('cursor-pointer text-left underline-offset-2 hover:underline', className)}
      >
        {children}
      </button>
      <ChangelogDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
