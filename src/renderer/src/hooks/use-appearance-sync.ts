import { useEffect } from 'react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useAppearanceStore, resolveState } from '@renderer/lib/appearance/store'
import { startAppearanceRuntime } from '@renderer/lib/appearance/runtime'
import { applyResolved, writeBootCache } from '@renderer/lib/appearance/apply'
import { appearanceGetSystem, setNativeTheme } from '@renderer/utils/ipc'

/**
 * Главное окно: загружает оформление из конфига в хранилище один раз, дальше
 * изменения идут через хранилище (применение к документу и сохранение — в runtime.ts).
 * Тема и акцент Windows приходят событиями из главного процесса — без опроса.
 */
export function useAppearanceSync(): void {
  const { appConfig } = useAppConfig()
  const { setTheme } = useTheme()
  const loaded = useAppearanceStore((s) => s.loaded)
  const mode = useAppearanceStore((s) => s.mode)
  const follow = useAppearanceStore((s) => s.system.follow)

  useEffect(() => {
    startAppearanceRuntime()
  }, [])

  useEffect(() => {
    if (!appConfig || loaded) return
    useAppearanceStore.getState().hydrate(appConfig.appearance, appConfig.appTheme === 'light' ? 'light' : 'dark')
  }, [appConfig, loaded])

  useEffect(() => {
    if (!loaded) return
    setTheme(mode)
    // Пока включено «как в системе», окно не принудительно светлое/тёмное, а системное.
    setNativeTheme(follow ? 'system' : mode).catch(() => undefined)
  }, [loaded, mode, follow, setTheme])

  // Системная тема / акцент: один запрос при старте + события.
  useEffect(() => {
    if (!loaded) return
    const store = useAppearanceStore.getState()
    appearanceGetSystem()
      .then((i) => store.setSystemInfo(i))
      .catch(() => undefined)
    const off = window.electron.ipcRenderer.on('appearance:systemChanged', (_e, info: { dark: boolean; accent: string | null }) =>
      useAppearanceStore.getState().setSystemInfo(info)
    )
    return () => off()
  }, [loaded])

  // Аварийный сброс оформления на любой странице: Ctrl+Shift+R.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== 'KeyR') return
      e.preventDefault()
      toast('Сбросить оформление к теме «Тёмная»?', {
        id: 'appearance-reset',
        description: 'Свои сохранённые темы останутся.',
        duration: 10000,
        action: { label: 'Сбросить', onClick: () => useAppearanceStore.getState().emergencyReset() },
        cancel: { label: 'Отмена', onClick: () => undefined }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Окна без редактирования (окно обновления): просто применяют оформление из
 * конфига при каждом его обновлении. Ничего не сохраняют.
 */
export function useAppearanceFollow(): void {
  const { appConfig } = useAppConfig()
  const { setTheme } = useTheme()
  const cfg = appConfig?.appearance
  const legacy = appConfig?.appTheme

  useEffect(() => {
    if (!appConfig) return
    useAppearanceStore.getState().hydrate(cfg, legacy === 'light' ? 'light' : 'dark')
    const apply = (): void => {
      const r = resolveState(useAppearanceStore.getState())
      applyResolved(r)
      writeBootCache(r)
      setTheme(r.mode)
    }
    apply()
    if (!cfg?.system?.follow && !cfg?.system?.accent) return
    appearanceGetSystem()
      .then((i) => {
        useAppearanceStore.getState().setSystemInfo(i)
        apply()
      })
      .catch(() => undefined)
    const off = window.electron.ipcRenderer.on('appearance:systemChanged', (_e, i: { dark: boolean; accent: string | null }) => {
      useAppearanceStore.getState().setSystemInfo(i)
      apply()
    })
    return () => off()
  }, [appConfig, cfg, legacy, setTheme])
}
