import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { motion } from 'motion/react'
import { useTheme } from 'next-themes'
import {
  ArrowRight,
  ChevronDown,
  Download,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import logoDark from '@renderer/assets/logo.png'
import logoLight from '@renderer/assets/logo_white.png'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  appCheckUpdate,
  appInstallUpdate,
  appCancelUpdateDownload,
  appDismissUpdate,
  appGetReleaseHistory,
  updateWindowClose,
  updateWindowOpenMain,
  openExternalUrl,
  type AppReleaseNote,
  type AppUpdateInfo,
  type AppUpdateProgress
} from '@renderer/utils/ipc'

const PAGE_SIZE = 4

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} с`
  const min = Math.floor(seconds / 60)
  const sec = Math.round(seconds % 60)
  return sec > 0 ? `${min} мин ${sec} с` : `${min} мин`
}

function formatDate(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Сравнение версий «1.1.10» > «1.1.9». */
function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Первый заголовок «# LAZEYKA 1.1.8» дублирует шапку карточки — убираем. */
function cleanBody(body: string): string {
  return body.replace(/^\s*#\s+[^\n]*\n+/, '').trim()
}

/** Markdown заметок к релизу в стиле приложения. */
function ReleaseBody({ body }: { body: string }): React.ReactElement {
  const text = cleanBody(body)
  if (!text) return <p className="text-xs text-muted-foreground">Описание к этой версии не добавлено.</p>
  return (
    <div className="text-[13px] leading-relaxed text-foreground/90 space-y-2">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h3 className="text-sm font-bold text-foreground mt-3 first:mt-0">{children}</h3>,
          h2: ({ children }) => (
            <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary mt-4 first:mt-0 mb-1.5">
              <span className="h-px w-3 bg-primary/60" />
              {children}
            </h4>
          ),
          h3: ({ children }) => <h5 className="text-xs font-semibold text-foreground mt-3 mb-1">{children}</h5>,
          p: ({ children }) => <p className="text-[13px] text-foreground/85">{children}</p>,
          ul: ({ children }) => <ul className="space-y-1.5">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1.5 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => (
            <li className="relative pl-4 text-[13px] text-foreground/85">
              <span className="absolute left-0 top-[0.6em] size-1.5 rounded-full bg-primary/70 shadow-[0_0_6px_var(--primary)]" />
              {children}
            </li>
          ),
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-foreground/[0.08] px-1 py-0.5 font-mono text-[11px]">{children}</code>
          ),
          a: ({ href, children }) => (
            <button
              type="button"
              className="text-primary underline underline-offset-2 hover:opacity-80"
              onClick={() => href && void openExternalUrl(href)}
            >
              {children}
            </button>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ReleaseCard({
  note,
  isLatest,
  isNewer,
  defaultOpen
}: {
  note: AppReleaseNote
  isLatest: boolean
  isNewer: boolean
  defaultOpen: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const date = formatDate(note.publishedAt)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border transition-colors',
        isLatest
          ? 'border-primary/40 bg-primary/[0.06] shadow-[0_0_24px_-10px_var(--primary)]'
          : 'border-border/60 bg-card/60'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 min-w-0 flex-wrap">
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
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-500">
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
        <div className="px-4 pb-4 -mt-1">
          <ReleaseBody body={note.body} />
          {note.url && (
            <button
              type="button"
              onClick={() => void openExternalUrl(note.url!)}
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
            >
              Страница релиза на GitHub <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  )
}

/**
 * Отдельное окно обновления (маршрут #/update-window). Открывается главным
 * процессом при запуске программы, если вышла новая версия, а также по
 * уведомлению, из трея и по кнопкам «Проверить обновления».
 */
export default function UpdateWindow(): React.ReactElement {
  const { appConfig } = useAppConfig()
  const { setTheme, resolvedTheme } = useTheme()
  const logo = resolvedTheme === 'light' ? logoLight : logoDark

  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const [notes, setNotes] = useState<AppReleaseNote[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingNotes, setLoadingNotes] = useState(true)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = appConfig?.appTheme
    if (t) setTheme(t)
  }, [appConfig?.appTheme, setTheme])

  const loadInfo = useCallback(async (): Promise<void> => {
    try {
      setInfo(await appCheckUpdate(false))
    } catch {
      /* без сети покажем то, что есть */
    }
  }, [])

  const loadPage = useCallback(async (p: number): Promise<void> => {
    setLoadingNotes(true)
    setNotesError(null)
    try {
      const list = await appGetReleaseHistory(p, PAGE_SIZE)
      setNotes((prev) => {
        const seen = new Set(prev.map((n) => n.tag))
        return p === 1 ? list : [...prev, ...list.filter((n) => !seen.has(n.tag))]
      })
      setHasMore(list.length >= PAGE_SIZE)
      setPage(p)
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingNotes(false)
    }
  }, [])

  useEffect(() => {
    void loadInfo()
    void loadPage(1)
    const onRefresh = (): void => {
      void loadInfo()
    }
    const onPush = (_e: unknown, next: AppUpdateInfo): void => setInfo(next)
    const onProgress = (_e: unknown, p: AppUpdateProgress): void => {
      setProgress(p)
      if (p.state === 'error' || p.state === 'cancelled') {
        setInstalling(false)
        if (p.state === 'error' && p.message) setError(p.message)
      }
    }
    window.electron.ipcRenderer.on('app:updateWindowRefresh', onRefresh)
    window.electron.ipcRenderer.on('app:updateAvailable', onPush)
    window.electron.ipcRenderer.on('app:updateProgress', onProgress)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('app:updateWindowRefresh')
      window.electron.ipcRenderer.removeAllListeners('app:updateAvailable')
      window.electron.ipcRenderer.removeAllListeners('app:updateProgress')
    }
  }, [loadInfo, loadPage])

  const hasUpdate = !!info?.hasUpdate && !!info.assetUrl
  const latestVersion = info?.latest ?? notes[0]?.version
  const installedVersion = info?.installed ?? notes.find((n) => n.installed)?.version
  const publishedAt = formatDate(info?.publishedAt ?? notes[0]?.publishedAt)

  /** Сколько версий человек пропустил: все, что новее установленной. */
  const newerCount = useMemo(
    () => (installedVersion ? notes.filter((n) => cmpVersion(n.version, installedVersion) > 0).length : 0),
    [notes, installedVersion]
  )

  const handleInstall = async (): Promise<void> => {
    if (!info?.assetUrl) return
    setInstalling(true)
    setError(null)
    setProgress(null)
    try {
      await appInstallUpdate(info.assetUrl, info.latest)
    } catch (e) {
      setInstalling(false)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('отменена') ? null : msg)
    }
  }

  const handleLater = async (forever: boolean): Promise<void> => {
    try {
      if (info?.tag) await appDismissUpdate(info.tag, forever)
    } catch {
      /* мягкий сигнал — закрываем в любом случае */
    }
    void updateWindowClose()
  }

  const percent = progress?.percent ?? null

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
      {/* Фоновое свечение в фирменном цвете. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-72 w-72 rounded-full bg-emerald-500/10 blur-[100px]" />

      {/* Заголовок окна: перетаскивание + закрыть. */}
      <div className="app-drag relative z-10 flex h-10 shrink-0 items-center justify-between pl-4 pr-1.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
          <img src={logo} alt="" draggable={false} className="size-4 object-contain" />
          LAZEYKA · Обновление
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          // Закрытие во время загрузки отменяет её: иначе через несколько
          // минут программа внезапно закрывалась и ставила обновление.
          onClick={() =>
            void (installing
              ? appCancelUpdateDownload()
                  .catch(() => void 0)
                  .then(() => updateWindowClose())
              : handleLater(false))
          }
          className="app-nodrag inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Шапка. */}
      <div className="relative z-10 shrink-0 px-6 pb-5 pt-2">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative shrink-0"
          >
            <div className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl" />
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/40 bg-card/80 shadow-[0_0_30px_-6px_var(--primary)]">
              <img src={logo} alt="LAZEYKA" draggable={false} className="size-10 object-contain" />
            </div>
          </motion.div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
              <Sparkles className="size-3.5" />
              {hasUpdate ? 'Доступно обновление' : 'Что нового'}
            </div>
            <h1 className="mt-0.5 text-2xl font-black leading-tight tracking-tight">
              {hasUpdate ? `Вышла LAZEYKA ${latestVersion ?? ''}` : `LAZEYKA ${installedVersion ?? ''}`}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {hasUpdate && installedVersion && latestVersion ? (
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <span className="rounded-md border border-border/70 bg-card/70 px-1.5 py-0.5">v{installedVersion}</span>
                  <ArrowRight className="size-3 text-primary" />
                  <span className="rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5 font-bold text-primary">
                    v{latestVersion}
                  </span>
                </span>
              ) : (
                <span className="text-emerald-500 font-medium">У вас последняя версия</span>
              )}
              {publishedAt && <span>· {publishedAt}</span>}
              {hasUpdate && info?.assetSize ? <span>· {formatMb(info.assetSize)} МБ</span> : null}
              {hasUpdate && newerCount > 1 && <span>· новых версий: {newerCount}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Лента изменений. */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-4 select-text">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <History className="size-3.5" />
          История изменений
        </div>
        <div className="space-y-2.5">
          {notes.map((n, i) => (
            <ReleaseCard
              key={n.tag}
              note={n}
              isLatest={i === 0}
              isNewer={!!installedVersion && cmpVersion(n.version, installedVersion) > 0}
              defaultOpen={i === 0}
            />
          ))}

          {loadingNotes && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загружаю историю версий…
            </div>
          )}

          {notesError && !loadingNotes && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
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

          {!loadingNotes && !notesError && hasMore && notes.length > 0 && (
            <button
              type="button"
              onClick={() => void loadPage(page + 1)}
              className="w-full rounded-xl border border-dashed border-border/70 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary cursor-pointer"
            >
              Показать более ранние версии
            </button>
          )}
        </div>
      </div>

      {/* Низ: загрузка и действия. */}
      <div className="relative z-10 shrink-0 border-t border-border/50 bg-card/70 px-6 py-4 ">
        {error && <div className="mb-3 text-xs text-destructive">Не удалось установить обновление: {error}</div>}

        {installing && (
          <div className="mb-3 space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
              <div
                className={cn(
                  'h-full rounded-full bg-gradient-to-r from-primary to-emerald-500',
                  percent === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-300'
                )}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
              <span>
                {progress?.state === 'installing'
                  ? 'Запуск установщика…'
                  : progress?.totalBytes
                    ? `${formatMb(progress.receivedBytes)} / ${formatMb(progress.totalBytes)} МБ`
                    : progress
                      ? `${formatMb(progress.receivedBytes)} МБ`
                      : 'Подключаюсь…'}
              </span>
              <span>
                {progress?.state === 'downloading' && progress.bytesPerSecond > 0
                  ? `${formatMb(progress.bytesPerSecond)} МБ/с${
                      progress.etaSeconds !== null ? ` · осталось ${formatEta(progress.etaSeconds)}` : ''
                    }`
                  : ''}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-start gap-1">
            {hasUpdate && !installing && (
              <button
                type="button"
                onClick={() => void handleLater(true)}
                className="text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Пропустить эту версию
              </button>
            )}
            <button
              type="button"
              onClick={() => void updateWindowOpenMain()}
              className="text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              Открыть LAZEYKA
            </button>
          </div>

          <div className="flex items-center gap-2">
            {hasUpdate ? (
              <>
                {installing ? (
                  <Button
                    variant="ghost"
                    onClick={() => void appCancelUpdateDownload().catch(() => {})}
                    disabled={progress?.state === 'installing'}
                  >
                    Отменить
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => void handleLater(false)}>
                    Позже
                  </Button>
                )}
                <Button
                  onClick={() => void handleInstall()}
                  disabled={installing}
                  className="min-w-40 font-semibold shadow-[0_0_24px_-6px_var(--primary)]"
                >
                  {installing ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {percent !== null ? `${Math.round(percent)}%` : 'Загрузка…'}
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 size-4" />
                      Обновить до {latestVersion}
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={() => void updateWindowClose()}>Закрыть</Button>
            )}
          </div>
        </div>

        {hasUpdate && !installing && (
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
            LAZEYKA закроется на 5–10 секунд и запустится снова. Все настройки, узлы и списки сохраняются.
            «Позже» — напомним при следующем запуске.
          </p>
        )}
      </div>
    </div>
  )
}
