import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  Airplay,
  AlertTriangle,
  Archive,
  BatteryCharging,
  Cable,
  Eraser,
  Gauge,
  Loader2,
  Music,
  Network,
  Radar,
  RotateCcw,
  RotateCw,
  Ruler,
  Share2,
  SlidersHorizontal,
  Timer,
  Undo2,
  Wifi,
  X,
  Zap
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { EmptyState, LiveNumber, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, StatusRing, type LzTone, type RingSegment } from '@renderer/components/lz'
import { Rows, SettingRow, SettingsGroup } from '@renderer/components/settings/setting-row'
import {
  tweaksAction,
  tweaksList,
  tweaksMtuApply,
  tweaksMtuProbe,
  tweaksRevertAll,
  tweaksSet,
  type MtuProbeResult,
  type TweakActionInfo,
  type TweakInfo,
  type TweaksList
} from '@renderer/utils/tweaks-api'

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

interface ConfirmState {
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => void
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }): React.ReactElement | null {
  if (!state || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div className="flex items-center gap-2 text-base font-black">
            <AlertTriangle className="size-5 text-st-warn-text" />
            {state.title}
          </div>
          <button type="button" className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06]" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <p className="px-5 pb-4 text-[12.5px] leading-relaxed text-muted-foreground">{state.text}</p>
        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-card/70 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const run = state.onConfirm
              onClose()
              run()
            }}
          >
            {state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const TWEAK_ICON: Record<string, React.ReactNode> = {
  nagle: <Timer />,
  throttle: <Music />,
  power: <BatteryCharging />,
  delivery: <Share2 />,
  wifiscan: <Radar />,
  awdl: <Airplay />
}
const ACTION_ICON: Record<string, React.ReactNode> = {
  flushDns: <Eraser />,
  resetNetwork: <RotateCcw />
}

export default function TweaksPage(): React.ReactElement {
  const [data, setData] = useState<TweaksList | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Что сейчас выполняется: id твика / действия, 'mtuProbe', 'mtuApply', 'mtuRevert', 'revertAll'. */
  const [busy, setBusy] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [mtu, setMtu] = useState<MtuProbeResult | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [tab, setTab] = useState<'tweaks' | 'actions'>('tweaks')

  const reload = useCallback(async (quiet = false): Promise<void> => {
    if (!quiet) setLoading(true)
    try {
      setData(await tweaksList())
      setLoadError(null)
    } catch (e) {
      setLoadError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Только чтение состояния. Ничего не применяется само.
  useEffect(() => {
    void reload()
  }, [reload])

  const toggle = async (t: TweakInfo, on: boolean): Promise<void> => {
    setBusy(t.id)
    try {
      const r = await tweaksSet(t.id, on)
      toast.success(r.message, r.restart ? { description: 'Чтобы изменение вступило в силу полностью, может понадобиться перезагрузка.' } : undefined)
    } catch (e) {
      toast.error('Не удалось изменить настройку', { description: errMsg(e) })
    } finally {
      setBusy(null)
      await reload(true)
    }
  }

  const runAction = async (a: TweakActionInfo): Promise<void> => {
    setBusy(a.id)
    try {
      const r = await tweaksAction(a.id)
      setActionResult((m) => ({ ...m, [a.id]: { ok: true, text: r.message } }))
      toast.success(r.message)
    } catch (e) {
      setActionResult((m) => ({ ...m, [a.id]: { ok: false, text: errMsg(e) } }))
      toast.error(`${a.title}: не получилось`, { description: errMsg(e) })
    } finally {
      setBusy(null)
      await reload(true)
    }
  }

  const probeMtu = async (): Promise<void> => {
    setBusy('mtuProbe')
    setMtu(null)
    try {
      const r = await tweaksMtuProbe()
      setMtu(r)
      if (!r.ok) toast.error('Подобрать MTU не удалось', { description: r.message })
    } catch (e) {
      toast.error('Подобрать MTU не удалось', { description: errMsg(e) })
    } finally {
      setBusy(null)
    }
  }

  const applyMtu = async (value: number | null): Promise<void> => {
    setBusy(value === null ? 'mtuRevert' : 'mtuApply')
    try {
      const r = await tweaksMtuApply(value)
      toast.success(r.message)
      setMtu(null)
    } catch (e) {
      toast.error(value === null ? 'Не удалось вернуть MTU' : 'Не удалось поставить MTU', { description: errMsg(e) })
    } finally {
      setBusy(null)
      await reload(true)
    }
  }

  const revertAll = async (): Promise<void> => {
    setBusy('revertAll')
    try {
      const r = await tweaksRevertAll()
      if (r.failed.length > 0) {
        toast.error(r.message, { description: r.failed.map((f) => f.message).join('\n') })
      } else {
        toast.success(r.message)
      }
      setMtu(null)
    } catch (e) {
      toast.error('Не удалось вернуть настройки', { description: errMsg(e) })
    } finally {
      setBusy(null)
      await reload(true)
    }
  }

  const anyBusy = busy !== null
  const adapter = data?.adapter ?? null

  const mtuCanApply = mtu?.ok && mtu.foundMtu !== null && mtu.foundMtu !== mtu.currentMtu
  const tweaks = data?.tweaks ?? []
  const available = tweaks.filter((t) => t.state !== 'unavailable')
  const onCount = tweaks.filter((t) => t.state === 'on').length
  const unsupported = data?.platform === 'other'
  const heroTone: LzTone = loading && !data ? 'busy' : busy && busy !== 'mtuProbe' ? 'busy' : loadError ? 'error' : onCount > 0 || data?.mtuBackup ? 'on' : 'off'
  const ringSegs: RingSegment[] = (tweaks.length ? tweaks : [{ id: 'x', title: 'Твики' } as TweakInfo]).map((t) => ({
    key: t.id,
    label: t.title,
    tone: busy === t.id ? 'busy' : t.state === 'on' ? 'on' : 'off',
    icon: TWEAK_ICON[t.id] ?? <SlidersHorizontal />
  }))
  const heroTitle = loading && !data
    ? 'Читаю настройки системы…'
    : loadError
      ? 'Не удалось прочитать настройки'
      : unsupported || tweaks.length === 0
        ? 'Твиков для этой системы нет'
        : onCount > 0
          ? `Включено ${onCount} из ${available.length}`
          : 'Система как была'
  const heroText = loadError
    ? `Не удалось получить состояние: ${loadError}`
    : 'Твики не ускоряют интернет и не срезают пинг на десятки миллисекунд. Они убирают скачки и задержки, которые добавляет сама система. Прежние значения запоминаются, всё возвращается одной кнопкой.'
  const kindIcon = adapter?.kind === 'wifi' ? <Wifi /> : adapter ? <Cable /> : <Network />

  return (
    <BasePage
      title="Твики"
      header={
        <Button size="sm" variant="outline" className="app-nodrag mr-1 h-8 rounded-lg text-xs" disabled={loading || anyBusy} onClick={() => void reload()}>
          <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
          Обновить
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <LzHero
          tone={heroTone}
          className={cn(loadError && 'border-st-err/45')}
          visual={
            <StatusRing segments={ringSegs} halo={onCount > 0 ? 'on' : null} size={136}>
              <span className="flex items-baseline gap-0.5">
                <LiveNumber value={onCount} className="text-[34px] leading-none font-extrabold text-[color:var(--text-title)]" />
                <span className="text-[15px] font-bold text-muted-foreground">/{available.length}</span>
              </span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">включено</span>
            </StatusRing>
          }
          title={heroTitle}
          text={heroText}
          actions={
            <Button
              variant="outline"
              size="lg"
              className="h-11 rounded-xl px-5 text-[14px]"
              disabled={!data?.canRevert || anyBusy}
              title={data?.canRevert ? 'Применённые твики и MTU вернутся к значениям, которые были до первого изменения' : 'Пока ничего не применено, откатывать нечего'}
              onClick={() =>
                setConfirm({
                  title: 'Вернуть всё как было?',
                  text: 'Все применённые твики будут выключены, а их параметры и MTU вернутся к исходным значениям. Сохранённая копия после этого удаляется.',
                  confirmLabel: 'Вернуть всё',
                  onConfirm: () => void revertAll()
                })
              }
            >
              {busy === 'revertAll' ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
              Вернуть всё как было
            </Button>
          }
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <div data-tour="tweaks-adapter" className="flex min-w-[260px] flex-1">
                <StatChip
                  icon={kindIcon}
                  tone={adapter ? 'on' : 'off'}
                  label="Твики применяются к адаптеру"
                  value={loading && !data ? 'определяю…' : adapter ? adapter.name : 'не найден'}
                  title={adapter ? `${adapter.description || adapter.name}. Адаптер VPN не затрагивается.` : (data?.adapterReason ?? undefined)}
                  aside={
                    adapter ? (
                      <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {adapter.kind === 'wifi' ? 'Wi-Fi' : 'кабель'}
                      </span>
                    ) : undefined
                  }
                  className="w-full"
                />
              </div>
              <StatChip
                icon={<Ruler />}
                tone={data?.mtuBackup ? 'on' : 'off'}
                label="MTU"
                value={adapter?.mtu ? String(adapter.mtu) : '—'}
                title="Подобрать MTU — на вкладке «Разовые действия»"
                onClick={() => setTab('actions')}
              />
              <StatChip
                icon={<Archive />}
                tone={data?.canRevert ? 'on' : 'off'}
                label="Копия прежних значений"
                value={data?.canRevert ? 'сохранена' : 'не нужна'}
                title={data?.canRevert ? 'По ней работает «Вернуть всё как было»' : 'Пока ничего не менялось'}
              />
            </div>
          }
        />

        {!adapter && data?.adapterReason && !loading && tweaks.length > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-3 text-[12.5px] text-muted-foreground">
            <Network className="size-4 shrink-0" />
            Активный адаптер не найден: {data.adapterReason}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented
            items={[
              { id: 'tweaks', label: tweaks.length ? `Настройки системы ${tweaks.length}` : 'Настройки системы', icon: SlidersHorizontal, title: 'Переключатели, которые остаются включёнными' },
              { id: 'actions', label: 'Разовые действия', icon: Zap, title: 'Сброс кэша DNS, сброс сети, подбор MTU' }
            ]}
            value={tab}
            onChange={setTab}
            aria-label="Разделы твиков"
            data-tour="tweaks-tabs"
            className="w-[380px]"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {tab === 'tweaks' ? 'У каждой настройки написано, что она делает и кому поможет.' : 'Выполняются один раз по кнопке, ничего не остаётся включённым.'}
          </span>
        </div>

        {tab === 'tweaks' && (
          <SettingsGroup
            title="Настройки системы"
            hint="Перед первым изменением программа запоминает прежнее значение. Выключение твика возвращает его."
            sub={onCount ? `Включено ${onCount} из ${available.length}` : 'Ничего не включено'}
          >
            {loading && !data && (
              <div className="space-y-2 px-1 pb-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-foreground/[0.04]" />
                ))}
              </div>
            )}
            {data && tweaks.length === 0 && (
              <EmptyState compact icon={<SlidersHorizontal />} title="Для этой системы твиков нет" text={data.adapterReason} />
            )}
            <Rows>
              {tweaks.map((t) => {
                const na = t.state === 'unavailable'
                return (
                  <SettingRow
                    key={t.id}
                    id={`tweak-${t.id}`}
                    data-tour={`tweak-${t.id}`}
                    icon={TWEAK_ICON[t.id] ?? <SlidersHorizontal />}
                    title={
                      <span className="flex flex-wrap items-center gap-1.5">
                        {t.title}
                        {na && <span className="rounded-md bg-foreground/[0.07] px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">недоступно</span>}
                        {t.external && <span className="rounded-md bg-foreground/[0.07] px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">уже так в системе</span>}
                      </span>
                    }
                    desc={t.does}
                    hint={`Кому поможет: ${t.helps}`}
                    on={t.state === 'on'}
                    disabled={na}
                    onToggle={na || anyBusy || t.external ? undefined : () => void toggle(t, t.state !== 'on')}
                    control={
                      busy === t.id ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch checked={t.state === 'on'} disabled={na || anyBusy || Boolean(t.external)} onCheckedChange={(on) => void toggle(t, on)} aria-label={t.title} />
                      )
                    }
                    below={
                      t.caveat || t.note || t.external || (na && t.reason) ? (
                        <div className="space-y-1 text-[11.5px] leading-snug">
                          {t.caveat && <p className="text-muted-foreground">Учтите: {t.caveat}</p>}
                          {t.note && <p className="text-st-warn-text">{t.note}</p>}
                          {t.external && <p className="text-muted-foreground">Так уже настроено в системе, не этой программой, поэтому откатывать нечего.</p>}
                          {na && t.reason && <p className="text-muted-foreground">Причина: {t.reason}</p>}
                        </div>
                      ) : undefined
                    }
                  />
                )
              })}
            </Rows>
          </SettingsGroup>
        )}

        {tab === 'actions' && data && (
          <>
            <SettingsGroup title="Разовые действия" hint="Выполняются один раз по кнопке. Ничего не остаётся включённым.">
              <Rows>
                {data.actions.map((a) => {
                  const res = actionResult[a.id]
                  return (
                    <SettingRow
                      key={a.id}
                      id={`action-${a.id}`}
                      icon={ACTION_ICON[a.id] ?? <Zap />}
                      title={a.title}
                      desc={a.does}
                      hint={`Кому поможет: ${a.helps}`}
                      control={
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg text-xs"
                          disabled={anyBusy}
                          onClick={() => {
                            if (a.confirm) {
                              setConfirm({
                                title: `${a.title}?`,
                                text: `${a.does} ${a.caveat ?? ''}`.trim(),
                                confirmLabel: 'Сбросить',
                                onConfirm: () => void runAction(a)
                              })
                            } else {
                              void runAction(a)
                            }
                          }}
                        >
                          {busy === a.id && <Loader2 className="size-3.5 animate-spin" />}
                          Выполнить
                        </Button>
                      }
                      below={
                        a.caveat || res ? (
                          <div className="space-y-1 text-[11.5px] leading-snug">
                            {a.caveat && <p className="text-muted-foreground">Учтите: {a.caveat}</p>}
                            {res && <p className={cn('font-semibold', res.ok ? 'text-st-ok-text' : 'text-st-err-text')}>{res.text}</p>}
                          </div>
                        ) : undefined
                      }
                    />
                  )
                })}
              </Rows>
            </SettingsGroup>

            <LzPanel data-tour="tweaks-mtu" tone={data.mtuBackup ? 'on' : 'off'} glow={7} className="space-y-3 p-4">
              <LzSectionHead
                title="Подобрать MTU"
                hint="Если пакеты уже проходят целиком, менять MTU не нужно. Прежнее значение сохраняется, вернуть его можно кнопкой здесь же."
                sub="Самый большой пакет, который проходит до интернета без разбиения. Проверка идёт мимо VPN"
                right={
                  <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-lg text-xs" disabled={anyBusy || !adapter} onClick={() => void probeMtu()}>
                    {busy === 'mtuProbe' ? <Loader2 className="size-3.5 animate-spin" /> : <Gauge className="size-3.5" />}
                    {busy === 'mtuProbe' ? 'Проверяю…' : 'Подобрать'}
                  </Button>
                }
              />
              <p className="max-w-[72ch] text-[12px] leading-relaxed text-muted-foreground">
                Поможет тем, у кого соединение через PPPoE, мобильный модем или туннель провайдера: слишком большой MTU даёт потери пакетов и зависания.
              </p>
              {mtu?.ok && mtu.foundMtu !== null && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5">
                  <div className="flex items-baseline gap-4">
                    <span>
                      <span className="block text-[11px] text-muted-foreground">найдено</span>
                      <span className="text-[24px] leading-none font-extrabold tabular-nums text-[color:var(--text-title)]">{mtu.foundMtu}</span>
                    </span>
                    <span>
                      <span className="block text-[11px] text-muted-foreground">сейчас на адаптере</span>
                      <span className="text-[17px] font-bold tabular-nums text-foreground/80">{mtu.currentMtu ?? 'неизвестно'}</span>
                    </span>
                  </div>
                  <p className="min-w-[16rem] flex-1 text-[12px] leading-relaxed text-muted-foreground">
                    {mtu.foundMtu === mtu.currentMtu
                      ? 'Совпадает с текущим значением, менять ничего не нужно.'
                      : mtu.currentMtu !== null && mtu.foundMtu > mtu.currentMtu
                        ? 'Путь до интернета пропускает пакеты крупнее, чем настроено на адаптере. Увеличивать MTU стоит, только если вы знаете, что для этого есть причина.'
                        : 'Путь до интернета пропускает меньшие пакеты, чем настроено на адаптере: крупные могут теряться. Значение стоит поставить.'}
                  </p>
                  {mtuCanApply && (
                    <Button size="sm" className="h-8 rounded-lg text-xs" disabled={anyBusy} onClick={() => void applyMtu(mtu.foundMtu!)}>
                      {busy === 'mtuApply' && <Loader2 className="size-3.5 animate-spin" />}
                      Поставить {mtu.foundMtu}
                    </Button>
                  )}
                </div>
              )}
              {mtu && !mtu.ok && <p className="text-[12px] font-semibold text-st-err-text">{mtu.message}</p>}
              {data.mtuBackup && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-st-warn/35 bg-st-warn/10 px-3 py-2">
                  <span className="text-[12px] text-st-warn-text">
                    MTU изменён программой, прежнее значение: <span className="font-bold tabular-nums">{data.mtuBackup.value}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs" disabled={anyBusy} onClick={() => void applyMtu(null)}>
                    {busy === 'mtuRevert' ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                    Вернуть прежний
                  </Button>
                </div>
              )}
            </LzPanel>
          </>
        )}
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </BasePage>
  )
}
