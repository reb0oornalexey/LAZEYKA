import { useEffect, useState } from 'react'
import { Loader2, Download, Sparkles, X } from 'lucide-react'
import {
  appCheckUpdate,
  appInstallUpdate,
  appDismissUpdate,
  type AppUpdateInfo
} from '@renderer/utils/ipc'
import { Button } from '@renderer/components/ui/button'
import { useAppConfig } from '@renderer/hooks/use-app-config'

const POLL_INTERVAL_MS = 60 * 60 * 1000 // 1 h

export default function AppUpdateOverlay(): React.ReactElement | null {
  const { appConfig } = useAppConfig()
  const [info, setInfo] = useState<AppUpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

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
    try {
      await appInstallUpdate(info.assetUrl, info.latest)
      // Main process will quit LAZEYKA within ~1 s. We just keep the
      // spinner up; user perceives "downloading… closing…".
    } catch (e) {
      setInstalling(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleLater = async (): Promise<void> => {
    if (!info?.tag) {
      setClosing(true)
      return
    }
    setClosing(true)
    try {
      await appDismissUpdate(info.tag)
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
          onClick={handleLater}
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
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={handleLater}
            disabled={installing}
          >
            Позже
          </Button>
          <Button onClick={handleInstall} disabled={installing}>
            {installing ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Загрузка…
              </>
            ) : (
              <>
                <Download className="size-4 mr-2" />
                Установить
              </>
            )}
          </Button>
        </div>

        <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          LAZEYKA закроется на 5–10 секунд для установки и запустится снова автоматически.
          Все настройки и конфиги сохраняются.
        </div>
      </div>
    </div>
  )
}
