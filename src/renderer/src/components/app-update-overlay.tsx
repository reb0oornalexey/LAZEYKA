import { useEffect, useState } from 'react'
import { Loader2, Download, Sparkles, X } from 'lucide-react'
import {
  appCheckUpdate,
  appInstallUpdate,
  appCancelUpdateDownload,
  appDismissUpdate,
  type AppUpdateInfo,
  type AppUpdateProgress
} from '@renderer/utils/ipc'
import { Button } from '@renderer/components/ui/button'
import { useAppConfig } from '@renderer/hooks/use-app-config'

const POLL_INTERVAL_MS = 60 * 60 * 1000 // 1 h

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/** «осталось ~2 мин» — в минутах и секундах, без ложной точности. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} с`
  const min = Math.floor(seconds / 60)
  const sec = Math.round(seconds % 60)
  return sec > 0 ? `${min} мин ${sec} с` : `${min} мин`
}

export default function AppUpdateOverlay(): React.ReactElement | null {
  const { appConfig } = useAppConfig()
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)

  // Gate both the initial check and the hourly poll behind the user's
  // "Проверять обновления LAZEYKA" setting (Settings → Запуск). Default
  // stays true (opt-out, not opt-in) to match existing behaviour for
  // people who never touch the toggle — this only changes things for
  // people who explicitly turned it off, e.g. because they build LAZEYKA
  // themselves from source with local patches and don't want to be
  // nudged toward the upstream prebuilt installer, which would silently
  // overwrite those patches.
  const autoCheckUpdate = appConfig?.autoCheckUpdate ?? true

  useEffect(() => {
    if (appConfig === undefined) return undefined // config not loaded yet
    if (!autoCheckUpdate) {
      setInfo(null)
      return undefined
    }
    let cancelled = false
    const check = async (force = false): Promise<void> => {
      try {
        const next = await appCheckUpdate(force)
        if (cancelled) return
        setInfo(next)
      } catch {
        /* noop — silent in background */
      }
    }
    check(false)
    const id = window.setInterval(() => check(true), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [autoCheckUpdate, appConfig === undefined])

  // Главный процесс проверяет обновления сам и присылает результат сюда.
  // Своего опроса выше уже недостаточно: при скрытом окне Chromium душит
  // таймеры, а после разворота окна по клику на уведомление показать
  // обновление надо сразу, не дожидаясь следующего часа.
  useEffect(() => {
    const onPush = (_e: unknown, next: AppUpdateInfo): void => {
      setInfo(next)
      // Человек мог закрыть окно раньше; раз главный процесс зовёт снова —
      // значит, отсрочка кончилась и прятать больше нечего.
      if (!next.dismissed) setClosing(false)
    }
    window.electron.ipcRenderer.on('app:updateAvailable', onPush)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('app:updateAvailable')
    }
  }, [])

  // Ход загрузки. Без него окно показывало вечный спиннер: 220 МБ качаются
  // минутами, и отличить «идёт» от «зависло» было невозможно.
  useEffect(() => {
    const onProgress = (_e: unknown, p: AppUpdateProgress): void => {
      setProgress(p)
      if (p.state === 'error' || p.state === 'cancelled') {
        setInstalling(false)
        if (p.state === 'error' && p.message) setError(p.message)
      }
    }
    window.electron.ipcRenderer.on('app:updateProgress', onProgress)
    return () => {
      window.electron.ipcRenderer.removeAllListeners('app:updateProgress')
    }
  }, [])

  const visible =
    !!info &&
    info.hasUpdate &&
    !!info.assetUrl &&
    !info.dismissed &&
    !closing

  const handleInstall = async (): Promise<void> => {
    if (!info?.assetUrl) return
    setInstalling(true)
    setError(null)
    setProgress(null)
    try {
      await appInstallUpdate(info.assetUrl, info.latest)
      // Main process will quit LAZEYKA within ~1 s. We just keep the
      // spinner up; user perceives "downloading… closing…".
    } catch (e) {
      setInstalling(false)
      const msg = e instanceof Error ? e.message : String(e)
      // Отмену человек сделал сам — сообщать ему об этом как об ошибке незачем.
      setError(msg.includes('отменена') ? null : msg)
    }
  }

  /**
   * «Позже» — тишина на сутки, не навсегда.
   *
   * Раньше эта кнопка записывала тег в конфиг без срока, и окно больше не
   * появлялось до следующего релиза. Для тех, кто держит LAZEYKA в трее, это
   * означало, что про обновление они не узнают вовсе.
   */
  const handleLater = async (forever = false): Promise<void> => {
    if (!info?.tag) {
      setClosing(true)
      return
    }
    setClosing(true)
    try {
      await appDismissUpdate(info.tag, forever)
    } catch {
      /* noop — dismissal is a soft signal */
    }
  }

  if (!visible || !info) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}
    >
      {/* Card uses the same theme tokens as the rest of the UI: bg-popover
          and text-popover-foreground resolve to white-on-dark in dark mode
          and dark-on-white in light mode automatically via next-themes.
          No hard-coded green / white anywhere — the modal now blends with
          whatever theme the user has picked under Settings. */}
      <div className="relative w-[min(560px,92vw)] rounded-2xl border border-primary/30 bg-card/95 backdrop-blur-2xl text-card-foreground shadow-[0_0_50px_rgba(0,0,0,0.8)] p-6 sm:p-8">
        <button
          type="button"
          onClick={() => { void handleLater(false) }}
          disabled={installing}
          aria-label="Закрыть"
          className="absolute top-3 right-3 size-8 inline-flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className="shrink-0 size-12 rounded-xl bg-primary/20 border border-primary/30 inline-flex items-center justify-center text-primary shadow-[0_0_15px_rgba(99,102,241,0.25)]">
            <Sparkles className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xl sm:text-2xl font-bold leading-tight text-foreground">
              Доступно обновление LAZEYKA
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Текущая версия: <span className="font-mono">v{info.installed}</span>
              {info.latest ? (
                <>
                  {'  →  '}
                  <span className="font-mono font-semibold text-foreground">v{info.latest}</span>
                </>
              ) : null}
            </div>
            {info.releaseNotes ? (
              <div className="mt-4 max-h-44 overflow-y-auto rounded-lg border border-border bg-muted/50 p-3 text-sm whitespace-pre-wrap leading-relaxed">
                {info.releaseNotes}
              </div>
            ) : null}
            {error ? (
              <div className="mt-3 text-sm text-destructive">
                Не удалось установить обновление: {error}
              </div>
            ) : null}

            {/* Ход загрузки. Установщик весит больше двухсот мегабайт, и без
                цифр перед глазами минуты ожидания читаются как зависание. */}
            {installing && progress ? (
              <div className="mt-4 space-y-1.5">
                <div className="h-2 w-full rounded-full bg-foreground/[0.08] overflow-hidden">
                  <div
                    className={
                      progress.percent === null
                        ? 'h-full w-1/3 bg-primary animate-pulse'
                        : 'h-full bg-primary transition-[width] duration-300'
                    }
                    style={
                      progress.percent === null ? undefined : { width: `${progress.percent}%` }
                    }
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono tabular-nums">
                  <span>
                    {progress.state === 'installing'
                      ? 'Запуск установщика…'
                      : progress.totalBytes
                        ? `${formatMb(progress.receivedBytes)} / ${formatMb(progress.totalBytes)} МБ`
                        : `${formatMb(progress.receivedBytes)} МБ`}
                  </span>
                  <span>
                    {progress.state === 'downloading' && progress.bytesPerSecond > 0
                      ? `${formatMb(progress.bytesPerSecond)} МБ/с${
                          progress.etaSeconds !== null
                            ? ` · осталось ${formatEta(progress.etaSeconds)}`
                            : ''
                        }`
                      : ''}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          {/* Отказ от версии насовсем — отдельным, неброским действием.
              Он остаётся доступным тем, кто правда не хочет обновляться, но
              больше не срабатывает случайно при нажатии «Позже». */}
          <button
            type="button"
            onClick={() => { void handleLater(true) }}
            disabled={installing}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Пропустить эту версию
          </button>

          <div className="flex items-center gap-2">
            {/* Во время загрузки «Позже» превращается в «Отменить»: прервать
                двухсотмегабайтную закачку должно быть можно, не закрывая
                приложение. Недокачанный файл при этом удаляется. */}
            {installing ? (
              <Button
                variant="ghost"
                onClick={() => { void appCancelUpdateDownload().catch(() => {}) }}
                disabled={progress?.state === 'installing'}
              >
                Отменить
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => { void handleLater(false) }}>
                Позже
              </Button>
            )}
            <Button onClick={handleInstall} disabled={installing}>
              {installing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {progress?.percent !== null && progress?.percent !== undefined
                    ? `${Math.round(progress.percent)}%`
                    : 'Загрузка…'}
                </>
              ) : (
                <>
                  <Download className="size-4 mr-2" />
                  Установить
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          «Позже» — напомним через сутки. Установщик весит около 220 МБ; при обрыве связи
          загрузка продолжится с того же места. LAZEYKA закроется на 5–10 секунд для установки
          и запустится снова автоматически. Все настройки и конфиги сохраняются.
        </div>
      </div>
    </div>
  )
}
