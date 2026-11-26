import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { appRelaunch, appResetSettings, appCheckUpdateNow, appRefreshOnlineCount, profileExport, profileImport, type AppUpdateInfo } from '@renderer/utils/ipc'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import BasePage from '@renderer/components/base/base-page'
import { platform, version } from '@renderer/utils/init'
import HotkeysCard from '@renderer/components/hotkeys-card'
import SoundCard from '@renderer/components/sound-card'
import { DiscordCard } from '@renderer/components/streamer/discord-card'
import { useStreamerStore } from '@renderer/store/streamer-store'
import { miniState, onMiniChanged } from '@renderer/utils/mini-api'
import { getSoundVolume, soundsVersion, subscribeSounds } from '@renderer/lib/sound'
import { useTourTab } from '@renderer/lib/tour-focus'
import { LaunchHero } from '@renderer/components/settings/launch-hero'
import { SettingsNav, SearchResults } from '@renderer/components/settings/settings-nav'
import { BackupGroup, LaunchGroup, UpdatesGroup } from '@renderer/components/settings/basic-groups'
import { MiniWindowGroup } from '@renderer/components/settings/mini-window-group'
import { MacServiceGroup } from '@renderer/components/settings/mac-service-group'
import { NotifyGroup } from '@renderer/components/settings/e6-groups'
import { GROUPS, resolveGroup, searchCatalog, type CatalogEntry, type SettingsGroupId } from '@renderer/components/settings/settings-catalog'

/*
 * «Настройки» на языке «Сигнал» (Е5).
 *
 * Сверху пульт — цепочка запуска крупными плитками-переключателями и чипы
 * (обновления, трей, клавиши, профиль). Ниже слева поиск и список групп,
 * справа одна открытая группа: вместо длинной простыни — одна карточка за раз.
 * Открытая группа запоминается (как раньше запоминалось раскрытие секций).
 *
 * Переходы: ?open=<группа или старый id секции>&focus=<data-tour или id строки>
 * открывают группу и подсвечивают строку. Экскурсия открывает группу полем tab
 * шага (старые id controls / overlay / backup тоже понимаются).
 */

const isMac = platform === 'darwin'
const GROUP_KEY = 'lazeyka.settings.group'
const groups = GROUPS.filter((g) => !g.only || g.only === platform)

/** Built-in горячие клавиши (как в hotkeys-card.tsx; Telegram-прокси — только Windows). */
const HOTKEY_FIELDS: (keyof AppConfig)[] = [
  'incyToggleShortcut',
  'incyBestNodeShortcut',
  'exitlagToggleShortcut',
  'zapretToggleShortcut',
  'zapretRestartShortcut',
  ...(isMac ? [] : (['tgwsToggleShortcut'] as (keyof AppConfig)[])),
  'showWindowShortcut',
  'prematchToggleShortcut',
  'miniWindowShortcut',
  'muteSoundsShortcut',
  'restartAppShortcut'
]

function readGroup(): SettingsGroupId {
  try {
    const v = localStorage.getItem(GROUP_KEY)
    if (v && groups.some((g) => g.id === v)) return v as SettingsGroupId
  } catch {
    /* хранилище недоступно */
  }
  return 'launch'
}

/** Подпись сочетания для текста: Control+Alt+M → Ctrl + Alt + M. */
function accelText(a?: string): string | undefined {
  if (!a) return undefined
  return a
    .split('+')
    .map((p) => (p === 'CommandOrControl' || p === 'Control' ? 'Ctrl' : p === 'Super' || p === 'Meta' ? 'Win' : p === 'Command' ? 'Cmd' : p))
    .join('+')
}

const Settings: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const [group, setGroup] = useState<SettingsGroupId>(readGroup)
  const [query, setQuery] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null)
  const [miniOpen, setMiniOpen] = useState<boolean | null>(null)
  const discordOn = useStreamerStore((s) => s.state?.settings.discordEnabled)
  useSyncExternalStore(subscribeSounds, soundsVersion)
  const [params, setParams] = useSearchParams()
  const contentRef = useRef<HTMLDivElement>(null)
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const results = useMemo(() => searchCatalog(query, platform), [query])
  const searching = query.trim().length > 0

  useEffect(() => {
    miniState()
      .then((s) => setMiniOpen(s.open))
      .catch(() => void 0)
    const off = onMiniChanged((s) => setMiniOpen(s.open))
    return () => {
      off()
      if (hitTimer.current) clearTimeout(hitTimer.current)
    }
  }, [])

  /** Подсветить строку (data-setting или data-tour) и прокрутить к ней. */
  const highlight = useCallback((focus: string): void => {
    let tries = 0
    const find = (): void => {
      const el =
        document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(focus)}"]`) ??
        document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(focus)}"]`)
      if (!el) {
        // Группа ещё рисуется (данные приходят из главного процесса).
        if (++tries < 12) hitTimer.current = setTimeout(find, 80)
        return
      }
      document.querySelectorAll('.st-hit').forEach((n) => n.classList.remove('st-hit'))
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.add('st-hit')
      hitTimer.current = setTimeout(() => el.classList.remove('st-hit'), 2600)
    }
    if (hitTimer.current) clearTimeout(hitTimer.current)
    hitTimer.current = setTimeout(find, 60)
  }, [])

  /** Открыть группу. remember — запомнить как выбор пользователя. */
  const openGroup = useCallback(
    (g: SettingsGroupId, focus?: string, remember = true): void => {
      setQuery('')
      setGroup(g)
      if (remember) {
        try {
          localStorage.setItem(GROUP_KEY, g)
        } catch {
          /* не запомнится — не страшно */
        }
      }
      if (focus) highlight(focus)
      else
        setTimeout(() => {
          const top = contentRef.current
          if (!top) return
          const r = top.getBoundingClientRect()
          if (r.top > window.innerHeight - 160 || r.top < 0) top.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }, 40)
    },
    [highlight]
  )

  // Экскурсия: шаг с tab = группа (или старый id секции) открывает её, не запоминая.
  const tourReveal = useCallback(
    (tab: string): void => {
      const g = resolveGroup(tab)
      if (!g) return
      setQuery('')
      setGroup(g)
    },
    []
  )
  useTourTab<string>('/settings', tourReveal)

  // Переход по ссылке из других разделов: /settings?open=controls&focus=hotkeys.
  const openParam = params.get('open')
  const focusParam = params.get('focus')
  useEffect(() => {
    if (!openParam && !focusParam) return
    const g = resolveGroup(openParam, focusParam)
    if (g) openGroup(g, focusParam ?? undefined, false)
    setParams({}, { replace: true })
  }, [openParam, focusParam, openGroup, setParams])

  /**
   * Спросить GitHub про новую версию прямо сейчас, минуя кэш.
   * Отвечаем во всех трёх случаях, включая «всё свежее»: кнопка, которая на
   * вид ничего не сделала, вынуждает гадать, сработала она или нет.
   */
  const handleCheckUpdate = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const info = await appCheckUpdateNow()
      setUpdate(info)
      if (info.hasUpdate && info.assetUrl) {
        // Окно обновления показывается само — оно слушает тот же результат.
        toast.success(`Доступна версия ${info.latest}`, {
          description: 'Окно с установкой сейчас откроется.',
          style: POWER_ON_BANNER_STYLE
        })
      } else if (info.hasUpdate) {
        toast.warning(`Версия ${info.latest} вышла, но установщик к релизу не приложен`, {
          description: 'Скачайте её вручную со страницы релизов.'
        })
      } else {
        toast.success(`Установлена последняя версия — ${info.installed}`)
      }
    } catch (e: unknown) {
      toast.error('Не удалось проверить обновления', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const res = await profileExport()
      if (res.success) toast.success(res.message || 'Профиль сохранён', { style: POWER_ON_BANNER_STYLE })
    } catch (e: unknown) {
      toast.error('Ошибка экспорта', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const res = await profileImport()
      if (res.success) {
        toast.success(res.message || 'Настройки импортированы', { style: POWER_ON_BANNER_STYLE })
        setTimeout(() => window.location.reload(), 800)
      }
    } catch (e: unknown) {
      toast.error('Ошибка импорта', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleReset = async (): Promise<void> => {
    try {
      await appResetSettings()
      toast.success('Настройки сброшены', { style: POWER_ON_BANNER_STYLE })
      setTimeout(() => window.location.reload(), 500)
    } catch (e) {
      toast.error('Не удалось сбросить настройки', { description: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  const patch = (p: Partial<AppConfig>): void => void patchAppConfig(p)
  const setOnlineStats = (v: boolean): void => {
    void patchAppConfig({ onlineStats: v }).then(() => appRefreshOnlineCount().catch(() => void 0))
  }

  const assigned = HOTKEY_FIELDS.filter((f) => Boolean(appConfig?.[f])).length
  const vol = getSoundVolume()
  const auto = appConfig?.autoLaunch ?? false

  const status: Partial<Record<SettingsGroupId, { text: string; on: boolean }>> = {
    launch: { text: auto ? ('вместе с системой') : 'запуск вручную', on: auto },
    updates: { text: appConfig?.autoCheckUpdate === false ? 'проверка вручную' : 'проверяются сами', on: appConfig?.autoCheckUpdate !== false },
    notify: (() => {
      const k = appConfig?.notifyKinds ?? {}
      const n = (['actions', 'updates', 'errors', 'author'] as const).filter((x) => k[x] !== false).length
      return { text: n === 4 ? 'все включены' : n ? `включено ${n} из 4` : 'выключены', on: n > 0 }
    })(),
    keys: { text: assigned ? `назначено ${assigned} из ${HOTKEY_FIELDS.length}` : 'не назначены', on: assigned > 0 },
    sounds: { text: vol.muted ? 'без звука' : `громкость ${vol.master}%`, on: !vol.muted && vol.master > 0 },
    overlay: { text: miniOpen === null ? '…' : miniOpen ? 'показано' : 'скрыто', on: Boolean(miniOpen) },
    discord: { text: discordOn ? 'показывается' : 'выключен', on: Boolean(discordOn) },
    backup: { text: 'файл .lazeyka, сброс', on: false }
  }

  const goFirst = (): void => {
    const r = results[0]
    if (r) pick(r)
  }
  const pick = (r: CatalogEntry): void => openGroup(r.group, r.id)

  let body: React.ReactNode
  switch (group) {
    case 'launch':
      body = <LaunchGroup cfg={appConfig} isMac={isMac} onPatch={patch} />
      break
    case 'updates':
      body = (
        <UpdatesGroup
          cfg={appConfig}
          isMac={isMac}
          onPatch={patch}
          version={version}
          update={update}
          checking={checkingUpdate}
          onCheck={() => void handleCheckUpdate()}
          onOnlineStats={setOnlineStats}
        />
      )
      break
    case 'notify':
      body = <NotifyGroup cfg={appConfig} onPatch={patch} />
      break
    case 'keys':
      body = (
        <div data-tour="hotkeys">
          <HotkeysCard onOpenSounds={() => openGroup('sounds', 'sound-actions')} />
        </div>
      )
      break
    case 'sounds':
      body = <SoundCard />
      break
    case 'overlay':
      body = <MiniWindowGroup hotkey={accelText(appConfig?.miniWindowShortcut)} onOpenKeys={() => openGroup('keys', 'hk-miniWindowShortcut')} />
      break
    case 'discord':
      body = <DiscordCard />
      break
    case 'mac':
      body = <MacServiceGroup />
      break
    case 'backup':
      body = (
        <BackupGroup
          cfg={appConfig}
          isMac={isMac}
          onPatch={patch}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          onRelaunch={() => void appRelaunch()}
          onReset={handleReset}
        />
      )
      break
  }

  return (
    <BasePage title="Настройки">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LaunchHero
          cfg={appConfig}
          isMac={isMac}
          version={version}
          update={update}
          checking={checkingUpdate}
          hotkeys={{ assigned, total: HOTKEY_FIELDS.length }}
          onPatch={patch}
          onCheckUpdate={() => void handleCheckUpdate()}
          onExport={() => void handleExport()}
          onImport={() => void handleImport()}
          onOpen={(g, focus) => openGroup(g, focus)}
        />

        <div className="grid @min-[720px]:grid-cols-[220px_minmax(0,1fr)] items-start gap-3">
          <SettingsNav
            groups={groups}
            active={group}
            status={status}
            query={query}
            results={results}
            onQuery={setQuery}
            onSelect={(g) => openGroup(g)}
            onSubmit={goFirst}
          />
          <div ref={contentRef} data-section={searching ? 'search' : group} className="min-w-0 scroll-mt-3">
            {searching ? <SearchResults query={query} results={results} onPick={pick} onClear={() => setQuery('')} /> : body}
          </div>
        </div>
      </div>
    </BasePage>
  )
}

export default Settings
