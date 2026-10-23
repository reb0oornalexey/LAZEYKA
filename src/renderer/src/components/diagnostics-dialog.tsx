import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Stethoscope, Wrench, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  zapretFixDiagnostic,
  zapretRunDiagnostics,
  type DiagnosticItem,
  type DiagnosticReport
} from '@renderer/utils/ipc'

/** Окно «Почему может не работать?»: запускает диагностику и показывает результат по пунктам. */
export function DiagnosticsDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyFix, setBusyFix] = useState<string | null>(null)

  const run = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setReport(await zapretRunDiagnostics())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void run()
  }, [open, run])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const applyFix = async (item: DiagnosticItem): Promise<void> => {
    if (busyFix || !item.fixAction) return
    setBusyFix(item.fixAction)
    const id = toast.loading(`Выполняем: ${item.fixLabel ?? 'исправление'}…`)
    try {
      const res = await zapretFixDiagnostic(item.fixAction)
      toast.success(res.message, { id })
      await run()
    } catch (e) {
      toast.error('Не удалось выполнить действие', { id, description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyFix(null)
    }
  }

  const problems = report ? report.items.filter((i) => i.status !== 'ok').length : 0
  const notAdmin = report?.items.some((i) => i.id === 'admin' && i.status !== 'ok') ?? false
  // Сначала проблемы, потом то, что в порядке (порядок внутри групп сохраняется).
  const sorted = report
    ? [...report.items].sort((a, b) => Number(a.status === 'ok') - Number(b.status === 'ok'))
    : []

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="diagnostics"
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
              <Stethoscope className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black leading-tight tracking-tight">Почему может не работать?</h2>
                <p className="text-xs text-muted-foreground">
                  Проверяем права, драйвер, службы Windows, порты и файл hosts.
                </p>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={onClose}
                className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 pb-4">
              {loading && !report && (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Проверяю систему…
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                  Не удалось выполнить диагностику: {error}
                </div>
              )}
              {report && (
                <div
                  className={cn(
                    'rounded-xl border px-4 py-2.5 text-xs font-medium',
                    problems === 0
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {problems === 0
                    ? 'Проблем не найдено.'
                    : `Найдено пунктов, требующих внимания: ${problems}.`}
                  {notAdmin && ' Без прав администратора результат может быть неточным.'}
                </div>
              )}
              {sorted.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-2.5 sm:flex-row sm:items-center sm:justify-between',
                    item.status === 'ok' && 'border-border/50 bg-background/50',
                    item.status === 'warn' && 'border-yellow-500/30 bg-yellow-500/5',
                    item.status === 'error' && 'border-destructive/30 bg-destructive/5'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    {item.status === 'ok' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />}
                    {item.status === 'warn' && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-500" />}
                    {item.status === 'error' && <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                    <div className="min-w-0 select-text">
                      <div className="text-xs font-medium text-foreground">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground">{item.message}</div>
                    </div>
                  </div>
                  {item.fixAction && item.fixLabel && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void applyFix(item)}
                      disabled={!!busyFix}
                      className="h-7 shrink-0 gap-1.5 self-end text-[11px] sm:self-center"
                    >
                      {busyFix === item.fixAction ? <Loader2 className="size-3 animate-spin" /> : <Wrench className="size-3" />}
                      {item.fixLabel}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/50 bg-card/70 px-6 py-3.5">
              <Button variant="outline" size="sm" onClick={() => void run()} disabled={loading} className="gap-1.5 text-xs">
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                {loading ? 'Проверяю…' : 'Проверить снова'}
              </Button>
              <Button onClick={onClose}>Закрыть</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
