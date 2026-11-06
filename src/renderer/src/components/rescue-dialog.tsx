import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, Undo2, Wrench, X, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { rescueFix, rescueRun, type RescueAction, type RescueItem } from '@renderer/utils/ipc'

/**
 * Мастер «Ничего не открывается»: проверки по шагам и кнопка «Исправить» у
 * каждой проблемы. После исправления, если оно что-то поменяло, появляется
 * «Откатить» — вернуть как было.
 */
export default function RescueDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const [items, setItems] = useState<RescueItem[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, { message: string; ok: boolean; undo?: RescueAction }>>({})

  const run = async (): Promise<void> => {
    setChecking(true)
    setItems(null)
    try {
      setItems(await rescueRun())
    } catch {
      setItems([])
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (open) {
      setDone({})
      void run()
    }
  }, [open])

  const act = async (id: string, a: RescueAction): Promise<void> => {
    setBusy(id)
    try {
      const r = await rescueFix(a)
      setDone((d) => ({ ...d, [id]: { message: r.message, ok: r.success, undo: r.undo } }))
    } catch (e) {
      setDone((d) => ({ ...d, [id]: { message: e instanceof Error ? e.message : String(e), ok: false } }))
    } finally {
      setBusy(null)
    }
  }

  if (!open || typeof document === 'undefined') return null
  const problems = items?.filter((i) => i.status !== 'ok').length ?? 0

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="flex max-h-[min(680px,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div>
            <div className="flex items-center gap-2 text-lg font-black">
              <Wrench className="size-5 text-primary" />
              Ничего не открывается?
            </div>
            <div className="text-xs text-muted-foreground">
              {checking
                ? 'Проверяю интернет, DNS, сайты и VPN…'
                : items
                  ? problems
                    ? `Найдено проблем: ${problems}. Нажмите «Исправить» — без вашего нажатия ничего не меняется.`
                    : 'Всё в порядке — проблем не найдено.'
                  : ''}
            </div>
          </div>
          <button type="button" className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06]" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-4 custom-scrollbar">
          {checking &&
            Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/[0.04]" />)}
          {items?.map((it, idx) => {
            const d = done[it.id]
            return (
              <div
                key={it.id}
                className={cn(
                  'rounded-xl border px-3.5 py-3',
                  it.status === 'ok' ? 'border-border bg-card/40' : it.status === 'fail' ? 'border-st-err/40 bg-st-err/[0.06]' : 'border-st-warn/40 bg-st-warn/[0.06]'
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-bold text-muted-foreground">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {it.status === 'ok' ? (
                        <CheckCircle2 className="size-4 text-st-ok-text" />
                      ) : it.status === 'fail' ? (
                        <XCircle className="size-4 text-st-err-text" />
                      ) : (
                        <AlertTriangle className="size-4 text-st-warn-text" />
                      )}
                      {it.title}
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{it.message}</div>
                    {d && <div className={cn('mt-1.5 text-[11.5px] font-semibold', d.ok ? 'text-st-ok-text' : 'text-st-err-text')}>{d.message}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {it.fix && !d?.ok && (
                      <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={() => void act(it.id, it.fix!)}>
                        {busy === it.id ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
                        {it.fix.label}
                      </Button>
                    )}
                    {d?.undo && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy !== null} onClick={() => void act(it.id, d.undo!)}>
                        <Undo2 className="size-3.5" />
                        {d.undo.label}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/50 bg-card/70 px-5 py-3">
          <Button variant="ghost" size="sm" disabled={checking || busy !== null} onClick={() => void run()}>
            <RotateCw className={cn('size-3.5', checking && 'animate-spin')} />
            Проверить снова
          </Button>
          <Button size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
