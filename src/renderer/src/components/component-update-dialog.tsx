import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, ChevronDown, Download, ExternalLink, History, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import ZapretIcon from '@renderer/components/zapret-icon'
import TelegramIcon from '@renderer/components/telegram-icon'
import { ReleaseBody } from '@renderer/components/update-window'
import { cn } from '@renderer/lib/utils'
import {
  componentReleaseHistory,
  openExternalUrl,
  type ComponentReleaseNote,
  type UpdatableComponent
} from '@renderer/utils/ipc'

const PAGE_SIZE = 6

const META: Record<UpdatableComponent, { name: string; author: string; repo: string }> = {
  zapret: { name: 'Zapret', author: 'Flowseal', repo: 'https://github.com/Flowseal/zapret-discord-youtube' },
  tgws: { name: 'TgWsProxy', author: 'Flowseal', repo: 'https://github.com/Flowseal/tg-ws-proxy' }
}

/** Конкретная версия для установки (откат или выбор из списка). */
export interface InstallTarget {
  assetUrl: string
  version: string
}

/** Что окну нужно знать об обновлении — общее у Zapret и TgWsProxy. */
export interface ComponentUpdateInfoLike {
  installed?: string
  latest?: string
  hasUpdate: boolean
  assetSize?: number
  publishedAt?: string
  releaseUrl?: string
}

function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function formatDate(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function NoteCard({
  note,
  isLatest,
  isNewer,
  defaultOpen,
  isDowngrade,
  busy,
  componentName,
  onInstallVersion
}: {
  note: ComponentReleaseNote
  isLatest: boolean
  isNewer: boolean
  defaultOpen: boolean
  /** Эта версия старее установленной. */
  isDowngrade: boolean
  /** Идёт установка — кнопки заблокированы. */
  busy: boolean
  componentName: string
  onInstallVersion: (note: ComponentReleaseNote) => void
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const [confirming, setConfirming] = useState(false)
  const date = formatDate(note.publishedAt)
  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        isLatest ? 'border-primary/40 bg-primary/[0.06]' : 'border-border/60 bg-card/60'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('font-mono text-sm font-bold', isLatest ? 'text-primary' : 'text-foreground')}>
            v{note.version}
          </span>
          {isLatest && isNewer && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
              Новое
            </span>
          )}
          {!isLatest && isNewer && (
            <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
              Тоже войдёт
            </span>
          )}
          {note.installed && (
            <span className="rounded-full border border-st-ok/40 bg-st-ok/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-st-ok-text">
              Установлена
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
          {!note.installed && note.assetUrl && (
            <div className="mt-3">
              {confirming ? (
                <div className="rounded-lg border border-st-warn/30 bg-st-warn/10 p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    {isDowngrade ? `Откатить ${componentName} до v${note.version}?` : `Установить ${componentName} v${note.version}?`}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {componentName} ненадолго перезапустится. Настройки и списки сохранятся.
                    {isDowngrade && ' Баннер обновления потом снова предложит новую версию — это нормально.'}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setConfirming(false)
                        onInstallVersion(note)
                      }}
                    >
                      Да, установить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => (isDowngrade ? setConfirming(true) : onInstallVersion(note))}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Download className="size-3" />
                  Установить эту версию
                </Button>
              )}
            </div>
          )}
          {note.url && (
            <button
              type="button"
              onClick={() => void openExternalUrl(note.url!)}
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              Релиз на GitHub автора <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  component: UpdatableComponent
  open: boolean
  info: ComponentUpdateInfoLike | null
  /**
   * Установка — та же, что раньше висела на кнопке «Обновить». Без аргумента —
   * последняя версия; с аргументом — выбранная (откат на старую). Ошибку бросает наружу.
   */
  onInstall: (target?: InstallTarget) => Promise<void>
  /** «Позже» — не напоминать об этой версии. */
  onLater?: () => void
  onClose: () => void
}

/**
 * Окно обновления компонента (Zapret / TgWsProxy) — в стиле окна обновления
 * LAZEYKA: версии «было → станет» и список изменений от автора с GitHub.
 */
export default function ComponentUpdateDialog({
  component,
  open,
  info,
  onInstall,
  onLater,
  onClose
}: Props): React.ReactElement | null {
  const meta = META[component]
  const Icon = component === 'zapret' ? ZapretIcon : TelegramIcon
  const [notes, setNotes] = useState<ComponentReleaseNote[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (p: number): Promise<void> => {
      setLoading(true)
      setNotesError(null)
      try {
        const list = await componentReleaseHistory(component, p, PAGE_SIZE)
        setNotes((prev) => {
          const seen = new Set(prev.map((n) => n.tag))
          return p === 1 ? list : [...prev, ...list.filter((n) => !seen.has(n.tag))]
        })
        setHasMore(list.length >= PAGE_SIZE)
        setPage(p)
      } catch (e) {
        setNotesError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [component]
  )

  useEffect(() => {
    if (!open) return
    setError(null)
    setStep(null)
    void loadPage(1)
  }, [open, loadPage])

  // Шаги установки (например, докачка зависимостей TgWsProxy).
  useEffect(() => {
    if (!open) return
    const onStep = (_e: unknown, p: { component: string; message: string }): void => {
      if (p?.component === component) setStep(p.message)
    }
    window.electron.ipcRenderer.on('component:updateStep', onStep)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('component:updateStep')
    }
  }, [open, component])

  // Esc закрывает окно, но не во время установки.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !installing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, installing, onClose])

  const installed = info?.installed
  const latest = info?.latest ?? notes[0]?.version
  const hasUpdate = !!info?.hasUpdate
  const newerCount = useMemo(
    () => (installed ? notes.filter((n) => cmpVersion(n.version, installed) > 0).length : 0),
    [notes, installed]
  )
  const publishedAt = formatDate(info?.publishedAt ?? notes[0]?.publishedAt)

  const handleInstall = async (target?: InstallTarget): Promise<void> => {
    setInstalling(true)
    setError(null)
    setStep(null)
    try {
      await onInstall(target)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="component-update"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !installing) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative flex max-h-[min(640px,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
          >
            <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[28rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[90px]" />

            {/* Шапка */}
            <div className="relative z-10 flex items-start gap-4 px-6 pb-4 pt-5">
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl" />
                <div className="relative flex size-14 items-center justify-center rounded-2xl border border-primary/40 bg-card/80">
                  <Icon className="size-7 text-primary" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
                  <Sparkles className="size-3.5" />
                  {hasUpdate ? 'Доступно обновление' : 'Что нового'}
                </div>
                <h2 className="mt-0.5 text-xl font-black leading-tight tracking-tight">
                  {hasUpdate ? `Вышел ${meta.name} ${latest ?? ''}` : `${meta.name} ${installed ?? ''}`}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {hasUpdate && latest ? (
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <span className="rounded-md border border-border/70 bg-card/70 px-1.5 py-0.5">
                        {installed ? `v${installed}` : 'встроенная'}
                      </span>
                      <ArrowRight className="size-3 text-primary" />
                      <span className="rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5 font-bold text-primary">
                        v{latest}
                      </span>
                    </span>
                  ) : (
                    <span className="font-medium text-st-ok-text">У вас последняя версия</span>
                  )}
                  {publishedAt && <span>· {publishedAt}</span>}
                  {hasUpdate && newerCount > 1 && <span>· новых версий: {newerCount}</span>}
                  <span>· автор {meta.author}</span>
                </div>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                disabled={installing}
                onClick={onClose}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Список изменений автора */}
            <div className="relative z-10 min-h-0 flex-1 select-text overflow-y-auto px-6 pb-4">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <History className="size-3.5" />
                Список изменений от автора
              </div>
              <div className="space-y-2.5">
                {notes.map((n, i) => (
                  <NoteCard
                    key={n.tag}
                    note={n}
                    isLatest={i === 0}
                    isNewer={!installed || cmpVersion(n.version, installed) > 0}
                    defaultOpen={i === 0 || (!!installed && cmpVersion(n.version, installed) > 0 && i < 3)}
                    isDowngrade={!!installed && cmpVersion(n.version, installed) < 0}
                    busy={installing}
                    componentName={meta.name}
                    onInstallVersion={(note) =>
                      note.assetUrl && void handleInstall({ assetUrl: note.assetUrl, version: note.version })
                    }
                  />
                ))}
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Загружаю список изменений с GitHub…
                  </div>
                )}
                {notesError && !loading && (
                  <div className="rounded-xl border border-st-warn/30 bg-st-warn/10 px-4 py-3 text-xs text-st-warn-text">
                    {notesError}
                    <button
                      type="button"
                      onClick={() => void loadPage(notes.length === 0 ? 1 : page + 1)}
                      className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                    >
                      <RefreshCw className="size-3" /> Повторить
                    </button>
                  </div>
                )}
                {!loading && !notesError && hasMore && notes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void loadPage(page + 1)}
                    className="w-full cursor-pointer rounded-xl border border-dashed border-border/70 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    Показать более ранние версии
                  </button>
                )}
              </div>
            </div>

            {/* Низ */}
            <div className="relative z-10 shrink-0 border-t border-border/50 bg-card/70 px-6 py-4">
              {error && <div className="mb-3 text-xs text-destructive">Не удалось обновить: {error}</div>}
              {installing && (
                <div className="mb-3 space-y-1.5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-primary to-st-ok" />
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {step ?? `Скачиваю и проверяю ${meta.name}…`}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void openExternalUrl(info?.releaseUrl ?? meta.repo)}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                >
                  Открыть на GitHub <ExternalLink className="size-3" />
                </button>
                <div className="flex items-center gap-2">
                  {hasUpdate ? (
                    <>
                      <Button
                        variant="ghost"
                        disabled={installing}
                        onClick={() => {
                          onLater?.()
                          onClose()
                        }}
                      >
                        Позже
                      </Button>
                      <Button onClick={() => void handleInstall()} disabled={installing} className="min-w-40 font-semibold">
                        {installing ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Устанавливаю…
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 size-4" />
                            Обновить до {latest}
                          </>
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={onClose}>Закрыть</Button>
                  )}
                </div>
              </div>
              {hasUpdate && !installing && (
                <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                  {component === 'zapret'
                    ? 'Zapret остановится на пару секунд и запустится с новой сборкой. Ваши списки и выбранная стратегия сохраняются.'
                    : 'Прокси Telegram перезапустится на пару секунд. Новая версия проверяется во встроенном Python до замены — если что-то не так, останется прежняя.'}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
