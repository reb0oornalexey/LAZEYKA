import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AiDnsCheckCard from '@renderer/components/ai-dns-check-card'
import { toast } from 'sonner'
import {
  BookOpen,
  Bot,
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  GripVertical,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
  Zap
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { LiveNumber, LzHero, LzPanel, LzSectionHead, Segmented, StatChip, StatusRing, TONE_TEXT, type LzTone, type RingSegment } from '@renderer/components/lz'
import { SignalBars } from '@renderer/components/incy/signal'
import { useTourTab } from '@renderer/lib/tour-focus'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import {
  dnsAddCustom,
  dnsApplySystem,
  dnsConfirmMacProfile,
  dnsGetProviders,
  dnsGetSystemState,
  dnsProvidersInstant,
  dnsRemoveCustom,
  dnsSetOrder,
  dnsUpdateCustom,
  openExternalUrl,
  type DohProvider,
  type SystemDnsState
} from '@renderer/utils/ipc'
import {
  dnsCatalogHealth,
  dnsCatalogHide,
  dnsCatalogRefresh,
  dnsCatalogRevert,
  dnsCatalogSaveOverride,
  dnsCatalogStatus,
  onDnsCatalogChanged,
  type CatalogStatus,
  type HealthResult
} from '@renderer/utils/dns-catalog-api'
import {
  DnsServerDialog,
  EMPTY_DNS_FORM,
  type DnsFormState
} from '@renderer/components/dns/dns-server-dialog'
import { AdminDnsBar } from '@renderer/components/hub/admin-dns-bar'
import { useAuthorState } from '@renderer/components/hub/use-author'
import { DnsRowMenu, type RowMenuItem } from '@renderer/components/dns/dns-row-menu'
import { DnsRemoveDialog } from '@renderer/components/dns/dns-remove-dialog'
import {
  adminDnsMarkRemove,
  adminDnsPlan,
  adminDnsUnmark,
  type DnsPlan
} from '@renderer/utils/hub-admin-api'

const isMac = platform === 'darwin'

type DnsTab = 'list' | 'ai'

type FormState = DnsFormState
const EMPTY_FORM: FormState = EMPTY_DNS_FORM

function formFrom(p: DohProvider): FormState {
  return {
    name: p.name,
    v4a: p.ip ?? '',
    v4b: p.secondaryIp ?? '',
    v6a: p.ipv6?.[0] ?? '',
    v6b: p.ipv6?.[1] ?? '',
    doh: p.url ?? '',
    fallback: Boolean(p.url) && !p.strict,
    site: p.site ?? ''
  }
}

/** «2026-11-12» → «12 ноября 2026». */
function ruDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

/** Пинг сервера: деления «силы сигнала» и число. Нет ответа — одно красное деление. */
function PingChip({ ms, loading, on }: { ms: number | null | undefined; loading: boolean; on?: boolean }): React.ReactElement {
  if (loading && ms == null) {
    return <span className="h-4 w-14 animate-pulse rounded-md bg-foreground/[0.06]" />
  }
  if (ms == null)
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-st-err-text"
        title="Сервер не ответил на замер. Нажмите «Пинг», чтобы проверить ещё раз."
      >
        <SignalBars ms={null} unreachable height={13} />
        нет ответа
      </span>
    )
  const tone = ms < 60 ? 'text-st-ok-text' : ms < 150 ? 'text-st-warn-text' : 'text-st-err-text'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <SignalBars ms={ms} on={on} height={13} />
      <span className={cn('text-[13px] font-semibold tabular-nums', on ? 'text-primary' : tone)}>
        {ms}
        <span className="ml-0.5 text-[10.5px] font-normal text-muted-foreground">мс</span>
      </span>
    </span>
  )
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ok' | 'primary' }): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[10.5px] font-semibold leading-tight',
        tone === 'ok' && 'border-st-ok/30 bg-st-ok/10 text-st-ok-text',
        tone === 'primary' && 'border-primary/30 bg-primary/10 text-primary',
        tone === 'muted' && 'border-foreground/[0.1] bg-foreground/[0.05] text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

/**
 * Вкладка «DNS» (раньше — карточка в «Настройках»).
 *
 * Список показывается сразу, пинг подтягивается следом. Активный сервер
 * берётся из того, что LAZEYKA сама выставила и что реально стоит в системе,
 * а не по совпадению одного IP. На macOS шифрованный DNS работает только через
 * профиль — до первой установки профиля выбрать можно только DoH-серверы, и
 * показывается пошаговая инструкция.
 */
export default function DnsPage(): React.ReactElement {
  const [providers, setProviders] = useState<DohProvider[]>([])
  const [pings, setPings] = useState<Record<string, number | null>>({})
  const [pinging, setPinging] = useState(false)
  const [state, setState] = useState<SystemDnsState | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState<null | 'new' | string>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [macPending, setMacPending] = useState<DohProvider | null>(null)
  const [cat, setCat] = useState<CatalogStatus | null>(null)
  const [catBusy, setCatBusy] = useState(false)
  const [health, setHealth] = useState<HealthResult | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  // «Скрыть у себя»: скрытые записи показываются только по кнопке внизу списка.
  const [showHidden, setShowHidden] = useState(false)
  // Режим автора: отметки «убрать у всех» и окно с причиной.
  const author = useAuthorState()
  const isAuthor = Boolean(author?.paired)
  const [plan, setPlan] = useState<DnsPlan | null>(null)
  const [removeTarget, setRemoveTarget] = useState<DohProvider | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Вкладки раздела: список серверов и проверка нейросетей.
  const [tab, setTab] = useState<DnsTab>('list')
  useTourTab<DnsTab>('/dns', setTab)
  // Наведение на строку подсвечивает её дугу в кольце пульта.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Перетаскивание за «ручку» слева. Строка едет за курсором, остальные плавно
  // расступаются (transform + transition); в покое у строк нет transform — иначе
  // стекло карточки рисовалось «лесенкой». Порядок сохраняется.
  const removedIds = useMemo(() => new Set((cat?.removed ?? []).map((r) => r.id)), [cat])
  const hiddenIds = useMemo(() => new Set(cat?.hidden ?? []), [cat])
  const curId = state?.providerId ?? null
  // Убранные автором в списке не показываются (включённый остаётся только в шапке и плашке);
  // скрытые пользователем — только по «Показать скрытые», кроме включённого сейчас.
  const visible = useMemo(
    () =>
      providers.filter(
        (p) => !removedIds.has(p.id) && (showHidden || !hiddenIds.has(p.id) || p.id === curId)
      ),
    [providers, removedIds, hiddenIds, showHidden, curId]
  )
  const hiddenCount = providers.filter(
    (p) => hiddenIds.has(p.id) && !removedIds.has(p.id) && p.id !== curId
  ).length
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<{
    id: string
    from: number
    over: number
    dy: number
    startY: number
    h: number
    mids: number[]
  } | null>(null)
  const startDrag = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const from = visible.findIndex((p) => p.id === id)
    const rects = visible.map((p) => rowEls.current.get(p.id)?.getBoundingClientRect())
    if (from < 0 || rects.some((x) => !x)) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({
      id,
      from,
      over: from,
      dy: 0,
      startY: e.clientY,
      h: rects[from]!.height,
      mids: rects.map((x) => x!.top + x!.height / 2)
    })
  }
  const moveDrag = (e: React.PointerEvent): void => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const center = drag.mids[drag.from] + dy
    let over = drag.from
    for (let k = 0; k < drag.mids.length; k++) {
      if (k < drag.from && center < drag.mids[k]) {
        over = k
        break
      }
    }
    for (let k = drag.mids.length - 1; k > drag.from; k--) {
      if (center > drag.mids[k]) {
        over = k
        break
      }
    }
    setDrag({ ...drag, dy, over })
  }
  const endDrag = (): void => {
    if (!drag) return
    const { from, over } = drag
    setDrag(null)
    if (from === over) return
    const next = [...visible]
    const [it] = next.splice(from, 1)
    next.splice(over, 0, it)
    // Скрытые и убранные — в конце, в прежнем порядке.
    const full = [...next, ...providers.filter((p) => !next.includes(p))]
    setProviders(full)
    void dnsSetOrder(full.map((p) => p.id)).catch(() => void 0)
  }
  const rowShift = (i: number): number => {
    if (!drag || i === drag.from) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.h
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return drag.h
    return 0
  }

  const loadState = useCallback(async () => {
    const s = await dnsGetSystemState().catch(() => null)
    setState(s)
  }, [])

  const loadCatalog = useCallback(async () => {
    const c = await dnsCatalogStatus().catch(() => null)
    if (c) setCat(c)
  }, [])

  const loadPlan = useCallback(async () => {
    setPlan(isAuthor ? await adminDnsPlan().catch(() => null) : null)
  }, [isAuthor])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])
  useEffect(() => onDnsCatalogChanged(() => void loadPlan()), [loadPlan])

  /** Один запрос к main: он сам делает два замера с паузой, если сервер не ответил. */
  const runHealth = useCallback(async () => {
    setHealthBusy(true)
    try {
      setHealth(await dnsCatalogHealth())
    } catch {
      /* без проверки */
    } finally {
      setHealthBusy(false)
    }
  }, [])

  const loadPings = useCallback(async () => {
    setPinging(true)
    try {
      const list = await dnsGetProviders()
      setPings(Object.fromEntries(list.map((p) => [p.id, p.latencyMs])))
      // Пинг-запрос возвращает и свежие адреса (например, DNS-AI) — обновляем список.
      setProviders(list.map((p) => ({ ...p, latencyMs: null })))
      // Включённый сервер не ответил — перепроверяем его двумя замерами (плашка «не отвечает»).
      if (list.some((p) => p.latencyMs == null)) void runHealth()
    } catch {
      /* без пинга */
    } finally {
      setPinging(false)
    }
  }, [runHealth])

  const reload = useCallback(async () => {
    const list = await dnsProvidersInstant().catch(() => [] as DohProvider[])
    setProviders(list)
    void loadState()
    void loadCatalog()
  }, [loadState, loadCatalog])

  useEffect(() => {
    void reload()
    void loadPings()
    void runHealth()
  }, [reload, loadPings, runHealth])

  // Каталог обновился в фоне (проверка при запуске) — перечитываем список.
  useEffect(() => onDnsCatalogChanged(() => void reload()), [reload])

  const activeId = state?.providerId ?? null
  const active = providers.find((p) => p.id === activeId) ?? null
  const activeProvider = cat?.stale ? (providers.find((p) => p.id === cat.stale!.id) ?? null) : null
  const macNeedsProfile = isMac && !state?.macProfileReady


  const apply = async (p: DohProvider | 'dhcp'): Promise<void> => {
    const id = p === 'dhcp' ? 'dhcp' : p.id
    setApplyingId(id)
    try {
      const res = await dnsApplySystem(id)
      if (!res.success) {
        toast.error('DNS не изменён', { description: res.message, duration: 10000 })
        return
      }
      if (res.needsProfile && p !== 'dhcp') {
        setMacPending(p)
      } else {
        toast.success(res.message, { style: POWER_ON_BANNER_STYLE, duration: 8000 })
      }
    } catch (e) {
      toast.error('Не удалось изменить DNS', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setApplyingId(null)
      void loadState()
      void loadCatalog()
      void runHealth()
    }
  }

  const refreshList = async (): Promise<void> => {
    setCatBusy(true)
    try {
      const r = await dnsCatalogRefresh()
      setCat(r.status)
      if (r.outcome === 'failed') {
        toast.error('Список не обновился', {
          description:
            'Не удалось скачать каталог — остались прежние значения. Проверьте подключение к интернету и повторите.'
        })
      } else if (r.outcome === 'older') {
        toast.message('В сети лежит более старый список — оставлен прежний')
      } else if (r.changedNames.length > 0) {
        toast.success('Список обновлён', {
          description: `Сменились адреса: ${r.changedNames.join(', ')}.`
        })
      } else {
        toast.success(r.outcome === 'same' ? 'Список уже актуален' : 'Список обновлён')
      }
      await reload()
      void runHealth()
    } catch (e) {
      toast.error('Список не обновился', {
        description: e instanceof Error ? e.message : String(e)
      })
    } finally {
      setCatBusy(false)
    }
  }

  const revertBuiltin = async (p: DohProvider): Promise<void> => {
    try {
      setCat(await dnsCatalogRevert(p.id))
      await reload()
      toast.success(`«${p.name}»: возвращены адреса из каталога`, {
        description:
          p.id === activeId ? 'Нажмите «Обновить» в плашке выше, чтобы применить их.' : undefined
      })
    } catch (e) {
      toast.error('Не удалось вернуть', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const confirmMac = async (): Promise<void> => {
    if (!macPending) return
    await dnsConfirmMacProfile(macPending.id).catch(() => void 0)
    toast.success(`Шифрованный DNS ${macPending.name} включён`, { style: POWER_ON_BANNER_STYLE })
    setMacPending(null)
    void loadState()
  }

  const openForm = (p?: DohProvider): void => {
    setForm(p ? formFrom(p) : EMPTY_FORM)
    setFormOpen(p ? p.id : 'new')
  }

  const saveForm = async (form: FormState): Promise<void> => {
    setSaving(true)
    const input = {
      name: form.name,
      ipv4: [form.v4a, form.v4b].filter((v) => v.trim()),
      ipv6: [form.v6a, form.v6b].filter((v) => v.trim()),
      doh: form.doh,
      allowFallback: form.fallback,
      site: form.site
    }
    try {
      const editing =
        formOpen && formOpen !== 'new' ? providers.find((x) => x.id === formOpen) : undefined
      if (editing && !editing.custom) {
        // Встроенная запись: правка хранится отдельно и приоритетнее каталога.
        setCat(
          await dnsCatalogSaveOverride(editing.id, {
            ipv4: input.ipv4,
            ipv6: input.ipv6,
            doh: input.doh,
            allowFallback: input.allowFallback
          })
        )
        toast.success('Изменения сохранены', {
          description:
            editing.id === activeId
              ? 'Нажмите «Обновить» в плашке выше, чтобы применить новые адреса.'
              : 'Запись помечена «изменено вами».'
        })
      } else if (formOpen && formOpen !== 'new') {
        await dnsUpdateCustom(formOpen, input)
        toast.success('DNS-сервер изменён', {
          description:
            formOpen === activeId
              ? 'Нажмите «Включить» ещё раз, чтобы применить новые адреса.'
              : undefined
        })
      } else {
        await dnsAddCustom(input)
        toast.success('DNS-сервер добавлен', {
          description: 'Нажмите «Включить» в его строке, чтобы применить.'
        })
      }
      setFormOpen(null)
      await reload()
      void loadPings()
    } catch (e) {
      toast.error('Не сохранено', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: DohProvider): Promise<void> => {
    if (p.id === activeId) {
      toast.error('Этот DNS сейчас включён', {
        description: 'Сначала выберите другой или сбросьте DNS.'
      })
      return
    }
    try {
      await dnsRemoveCustom(p.id)
      await reload()
    } catch (e) {
      toast.error('Не удалось удалить', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const toggleHidden = async (p: DohProvider, hide: boolean): Promise<void> => {
    if (hide && p.id === activeId) {
      toast.error('Этот DNS сейчас включён', {
        description: 'Сначала выберите другой или сбросьте DNS, потом скройте.'
      })
      return
    }
    try {
      setCat(await dnsCatalogHide(p.id, hide))
      if (hide)
        toast.success(`«${p.name}» скрыт у вас`, {
          description: 'Вернуть: «Показать скрытые» под списком.'
        })
    } catch (e) {
      toast.error('Не получилось', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const markRemove = async (reason: string): Promise<void> => {
    const p = removeTarget
    if (!p) return
    try {
      setPlan(await adminDnsMarkRemove(p.id, reason))
      setRemoveTarget(null)
      toast.success(`«${p.name}» отмечен: убрать у всех`, {
        description: 'Опубликуйте в «Панели автора» вверху страницы.'
      })
    } catch (e) {
      toast.error('Не получилось', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const unmark = async (p: DohProvider): Promise<void> => {
    try {
      setPlan(await adminDnsUnmark(p.id))
    } catch (e) {
      toast.error('Не получилось', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const pendingRemove = new Set((plan?.remove ?? []).map((x) => x.id))
  const removedActive = cat?.removedActive ?? null

  const busy = applyingId !== null
  const editingProvider =
    formOpen && formOpen !== 'new' ? (providers.find((x) => x.id === formOpen) ?? null) : null

  // ── Пульт раздела ────────────────────────────────────────────────────
  const activePing = activeId ? pings[activeId] : undefined
  const fastest = useMemo(() => {
    let best: DohProvider | null = null
    for (const p of visible) {
      const ms = pings[p.id]
      if (ms == null || (macNeedsProfile && !p.url)) continue
      if (!best || ms < (pings[best.id] as number)) best = p
    }
    return best
  }, [visible, pings, macNeedsProfile])
  const healthBad = Boolean(health && !health.ok && !healthBusy)
  const heroTone: LzTone = !state ? 'busy' : healthBad ? 'error' : applyingId ? 'busy' : active ? 'on' : 'off'
  const heroTitle = !state
    ? 'Проверяю DNS…'
    : healthBad
      ? `«${health!.name}» не отвечает`
      : active?.url
        ? 'Шифрованный DNS работает'
        : active
          ? 'DNS без шифрования'
          : state.servers.length === 0
            ? 'Стандартный DNS провайдера'
            : 'Свой DNS системы'
  const heroText = !state
    ? 'Смотрю, какие адреса стоят на сетевых адаптерах.'
    : healthBad
      ? 'Два замера подряд без ответа. Обновите список: возможно, сервис сменил адреса. Или сбросьте DNS на стандартный.'
      : active?.url
        ? `Стоит ${active.name}. ${active.strict ? 'Запросы идут только по DoH, провайдер их не видит.' : 'Запросы идут по DoH, при сбое — обычным DNS.'}`
        : active
          ? `Стоит ${active.name}. Провайдер видит, какие сайты вы открываете.`
          : state.servers.length === 0
            ? 'Адреса выдаёт роутер. Выберите сервер ниже, чтобы включить шифрование и обойти подмену ответов.'
            : `В системе вручную прописаны ${state.servers.slice(0, 3).join(', ')}.`
  const encValue = !active ? 'нет' : !active.url ? 'нет' : active.strict ? 'только DoH' : 'DoH, запасной обычный'
  const addrValue = active ? [active.ip, active.secondaryIp].filter(Boolean).join(', ') : state?.servers.length ? state.servers.slice(0, 2).join(', ') : 'от роутера (DHCP)'
  const ringSegments: RingSegment[] = (visible.length ? visible : [{ id: 'none', name: 'DNS' } as DohProvider]).slice(0, 12).map((p) => ({
    key: p.id,
    label: p.name,
    tone:
      applyingId === p.id
        ? 'busy'
        : p.id === activeId
          ? healthBad
            ? 'error'
            : 'on'
          : pinging && pings[p.id] == null
            ? 'busy'
            : 'off'
  }))
  const showFastest = Boolean(fastest && fastest.id !== activeId && !busy)
  const listCount = visible.length

  return (
    <BasePage
      title="DNS"
      header={
        <Button
          data-tour="dns-catalog-refresh"
          size="sm"
          variant="outline"
          className="mr-1 h-8 rounded-lg text-xs"
          disabled={catBusy}
          onClick={() => void refreshList()}
          title="Скачать свежие адреса встроенных серверов. Включённый сервер сам не изменится: если его адреса сменились, появится кнопка «Обновить»."
        >
          {catBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Обновить список
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-col lz-page-gap lz-page-x pb-5">
        <AdminDnsBar />

        <LzHero
          data-tour="dns-current"
          tone={heroTone}
          className={cn(healthBad && 'border-st-err/45')}
          visual={
            <StatusRing segments={ringSegments} active={hoverId} halo={active && !healthBad ? 'on' : null} pulse={Boolean(active) && !healthBad} size={132} waves={Boolean(active)}>
              {active && activePing != null ? (
                <>
                  <LiveNumber value={activePing} className="text-[34px] leading-none font-extrabold text-[color:var(--text-title)]" />
                  <span className="mt-0.5 text-[11px] text-muted-foreground">мс ответ</span>
                </>
              ) : active ? (
                <span className={cn('flex flex-col items-center gap-1 text-[11px]', TONE_TEXT[heroTone])}>
                  {healthBad ? <TriangleAlert className="size-6" /> : <ShieldCheck className="size-6" />}
                  {healthBad ? 'нет ответа' : pinging ? 'замеряю' : 'включён'}
                </span>
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                  <ShieldAlert className="size-6" />
                  {state ? 'провайдер' : '…'}
                </span>
              )}
            </StatusRing>
          }
          title={<span className="line-clamp-2">{heroTitle}</span>}
          text={heroText}
          extra={
            <span className="text-[12px] text-muted-foreground">
              Кольцо — серверы списка по порядку, горит включённый.
              <Hint
                className="ml-1"
                text={
                  isMac
                    ? 'На macOS адреса DNS выставляются для всех сетевых служб, шифрование DoH — через профиль LAZEYKA. Пока INCY подключён в режиме TUN, DNS ведёт служба LAZEYKA.'
                    : 'DNS меняется на рабочих сетевых адаптерах; прежние адреса запоминаются и возвращаются кнопкой «Сбросить». Пока INCY подключён в режиме TUN, имена резолвит сам VPN; в режиме ExitLag всё, что идёт мимо VPN, использует этот DNS.'
                }
              />
            </span>
          }
          actions={
            <>
              {showFastest && fastest ? (
                <Button
                  size="lg"
                  className="h-11 rounded-xl px-5 text-[14px]"
                  onClick={() => void apply(fastest)}
                  title="Включить сервер, который ответил быстрее всех по последнему замеру"
                >
                  <Zap className="size-4" />
                  Включить {fastest.name.replace(/\s*\(.*\)$/, '')}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-11 rounded-xl px-5 text-[14px]"
                  disabled={pinging}
                  onClick={() => void loadPings()}
                  title="Замерить, за сколько миллисекунд отвечает каждый сервер из списка"
                >
                  {pinging ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                  {pinging ? 'Замеряю…' : 'Замерить пинг'}
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                className="h-10 rounded-xl px-5 text-[13px]"
                disabled={busy}
                onClick={() => void apply('dhcp')}
                title="Вернуть DNS, который стоял до LAZEYKA, или стандартный от провайдера (DHCP)"
              >
                {applyingId === 'dhcp' ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                Сбросить на стандартный
              </Button>
            </>
          }
          footer={
            <div className="flex flex-wrap items-stretch gap-2">
              <StatChip
                icon={active?.url ? <Lock /> : <LockOpen />}
                tone={active?.url ? 'on' : 'off'}
                label="Шифрование"
                value={encValue}
              />
              <StatChip icon={<Server />} label="Адреса в системе" value={addrValue} className="min-w-[180px] flex-1" />
              <StatChip
                icon={<Gauge />}
                tone={fastest ? 'on' : 'off'}
                label="Быстрее всех"
                value={fastest ? `${fastest.name.replace(/\s*\(.*\)$/, '')}, ${pings[fastest.id]} мс` : pinging ? 'замеряю…' : 'нет замера'}
                title="Замерить пинг ещё раз"
                onClick={pinging ? undefined : () => void loadPings()}
              />
              <StatChip
                icon={<BookOpen />}
                label="Каталог серверов"
                value={cat?.catalogUpdated ? `от ${ruDate(cat.catalogUpdated)}` : 'встроенный'}
                title={
                  cat?.catalogUpdated
                    ? `Версия ${cat.catalogVersion}. Скачивается при запуске и по кнопке «Обновить список», не чаще раза в 6 часов. Настройки системы каталог сам не меняет.`
                    : undefined
                }
              />
            </div>
          }
        />

        {/* Адреса включённого сервера сменились (каталог или правка) — применяем только по кнопке */}
        {cat?.stale && activeProvider && !macPending && (
          <Banner tone="warn" tour="dns-stale-banner">
            <span className="min-w-[14rem] flex-1">
              {cat.stale.reason === 'edited'
                ? `Вы изменили адреса «${cat.stale.name}». Нажмите «Обновить», чтобы применить их.`
                : `У «${cat.stale.name}» сменились адреса. Нажмите «Обновить», чтобы применить новые.`}
            </span>
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={() => void apply(activeProvider)}
              title="Выставить в системе новые адреса этого сервера. Это то же самое, что нажать «Включить» ещё раз."
            >
              {applyingId === activeProvider.id ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
              Обновить
            </Button>
          </Banner>
        )}

        {/* Включённый DNS автор убрал из списка — настройки не трогаем, предлагаем выбор */}
        {removedActive && removedActive.id === activeId && (
          <Banner tone="warn" tour="dns-removed-banner">
            <span className="min-w-[14rem] flex-1">
              «{removedActive.name}» убран из списка автором программы
              {removedActive.reason ? ` (${removedActive.reason})` : ''}. Рекомендуем выбрать другой DNS.
            </span>
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              onClick={() => {
                setTab('list')
                requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
              }}
              title="Перейти к списку DNS. Текущий DNS работает, пока вы его не смените."
            >
              Выбрать другой
            </Button>
          </Banner>
        )}

        {/* Включённый сервер не отвечает (два замера подряд) */}
        {healthBad && (
          <Banner tone="error" tour="dns-health-banner">
            <span className="min-w-[14rem] flex-1">«{health!.name}» не отвечает. Возможно, сервис сменил адреса.</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              disabled={catBusy}
              onClick={() => void refreshList()}
              title="Скачать свежие адреса встроенных серверов. Если они сменились, здесь появится кнопка «Обновить»."
            >
              {catBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Обновить список
            </Button>
          </Banner>
        )}

        {/* macOS: профиль обязателен (один раз) */}
        {isMac && (macNeedsProfile || state?.macProfileStale) && !macPending && (
          <Banner tone="info">
            <span className="min-w-[14rem] flex-1">
              <span className="block font-semibold text-foreground">
                {state?.macProfileStale
                  ? 'Адреса сервера изменились — переустановите профиль'
                  : 'На macOS шифрованный DNS ставится профилем (один раз)'}
              </span>
              <span className="text-muted-foreground">
                Нажмите «Включить» у сервера с DoH — LAZEYKA создаст профиль и покажет, где его установить. Пока профиль не
                установлен и не включён, другие DNS не выбираются: без него macOS шифрование не применяет.
              </span>
            </span>
          </Banner>
        )}

        {macPending && (
          <LzPanel tone="on" glow={10} className="space-y-3 border-primary/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[14px] font-bold text-[color:var(--text-title)]">
                  Установите профиль «{macPending.name} (DoH) — LAZEYKA»
                </div>
                <div className="text-xs text-muted-foreground">
                  Это нужно сделать один раз. Без пароля администратора macOS профиль не поставит.
                </div>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06]"
                onClick={() => setMacPending(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            <ol className="space-y-2 text-xs text-foreground">
              {[
                '«Системные настройки» → «Основные» → «Управление устройством». Если вверху есть старые профили LAZEYKA — удалите их кнопкой «−».',
                'В разделе «Загружено» дважды щёлкните «… (DoH) — LAZEYKA» и нажмите «Установить», введите пароль.',
                '«Сеть» → «VPN и фильтры» → у профиля LAZEYKA выберите «Включено». Другие DNS-профили и фильтры выключите.'
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{t}</span>
                </li>
              ))}
            </ol>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => void apply(macPending)}>
                Открыть профиль ещё раз
              </Button>
              <Button size="sm" className="text-xs" onClick={() => void confirmMac()}>
                <Check className="size-3.5" />Я установил и включил
              </Button>
            </div>
          </LzPanel>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Segmented
            items={[
              { id: 'list', label: `Серверы ${listCount || ''}`.trim(), icon: Server, title: 'Список DNS-серверов: включить, изменить, поменять порядок' },
              { id: 'ai', label: 'Нейросети', icon: Bot, title: 'Какой DNS открывает ChatGPT, Claude и Gemini в вашей сети' }
            ]}
            value={tab}
            onChange={setTab}
            aria-label="Разделы DNS"
            data-tour="dns-tabs"
            className="w-[300px]"
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {tab === 'list'
              ? 'Нажмите «Включить» у сервера. Порядок меняется перетаскиванием за ручку слева.'
              : 'Проверка, какой DNS открывает нейросети без VPN именно у вас.'}
          </span>
        </div>

        {tab === 'list' && (
          <LzPanel ref={listRef} data-tour="dns-list" className="scroll-mt-4 px-2 pt-3 pb-2">
            <LzSectionHead
              className="px-3 pb-2"
              title="Серверы"
              hint="Встроенные серверы берутся из каталога LAZEYKA и обновляются сами. Свои серверы хранятся только на этом компьютере. Пинг — время ответа сервера с вашего подключения."
              sub={
                cat?.catalogUpdated
                  ? `Каталог от ${ruDate(cat.catalogUpdated)}, сам обновляется не чаще раза в 6 часов`
                  : 'Включите сервер — он применится на всех рабочих адаптерах'
              }
              right={
                <>
                  {(hiddenCount > 0 || showHidden) && (
                    <Button
                      data-tour="dns-show-hidden"
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => setShowHidden((v) => !v)}
                      title="Записи, которые вы скрыли у себя через меню «⋯». На других компьютерах они не скрыты."
                    >
                      {showHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showHidden ? 'Не показывать скрытые' : `Показать скрытые (${hiddenCount})`}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg text-xs"
                    disabled={pinging}
                    onClick={() => void loadPings()}
                    title="Замерить, за сколько миллисекунд отвечает каждый сервер из списка"
                  >
                    <RotateCw className={cn('size-3.5', pinging && 'animate-spin')} />
                    Пинг
                  </Button>
                  <Button data-tour="dns-add-custom" size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => openForm()}>
                    <Plus className="size-3.5" />
                    Свой DNS-сервер
                  </Button>
                </>
              }
            />
            {providers.length === 0 && (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-foreground/[0.04]" />
                ))}
              </div>
            )}
            <div className="space-y-1">
              {visible.map((p, i) => {
                const isActive = p.id === activeId
                const isHidden = hiddenIds.has(p.id)
                const marked = pendingRemove.has(p.id)
                const bm = cat?.meta[p.id]
                const edited = Boolean(bm?.edited)
                const menu: RowMenuItem[] = []
                if (p.site) {
                  menu.push({
                    key: 'site',
                    label: 'Открыть сайт сервиса',
                    icon: ExternalLink,
                    hint: p.site,
                    onClick: () => void openExternalUrl(p.site!)
                  })
                }
                if (!p.custom && edited) {
                  menu.push({
                    key: 'revert',
                    label: 'Вернуть адреса из каталога',
                    icon: Undo2,
                    hint: 'Убрать вашу правку и снова брать адреса из каталога',
                    onClick: () => void revertBuiltin(p)
                  })
                }
                if (!p.custom) {
                  menu.push(
                    isHidden
                      ? { key: 'show', label: 'Показать снова', icon: Eye, onClick: () => void toggleHidden(p, false) }
                      : {
                          key: 'hide',
                          label: 'Скрыть у себя',
                          icon: EyeOff,
                          hint: 'Убрать запись из вашего списка. Только на этом компьютере, вернуть можно кнопкой «Показать скрытые».',
                          onClick: () => void toggleHidden(p, true)
                        }
                  )
                  if (menu.length > 1) menu[menu.length - 1].separated = true
                  if (isAuthor) {
                    menu.push(
                      marked
                        ? { key: 'unmark', label: 'Не убирать у всех', icon: Undo2, separated: true, onClick: () => void unmark(p) }
                        : {
                            key: 'rm',
                            label: 'Убрать у всех',
                            icon: Trash2,
                            danger: true,
                            separated: true,
                            hint: 'Режим автора: убрать запись из программы у всех пользователей (после публикации)',
                            onClick: () => setRemoveTarget(p)
                          }
                    )
                  }
                } else {
                  menu.push({
                    key: 'del',
                    label: 'Удалить',
                    icon: Trash2,
                    danger: true,
                    separated: menu.length > 0,
                    hint: 'Удалить этот сервер из списка. Настройки системы не меняются.',
                    onClick: () => void remove(p)
                  })
                }
                const lockedOnMac = macNeedsProfile && !p.url
                const addrs = [p.ip, p.secondaryIp].filter(Boolean).join(', ')
                const firstBuiltin = !p.custom && providers.find((x) => !x.custom)?.id === p.id
                const ms = pings[p.id]
                return (
                  <div
                    key={p.id}
                    data-dns-row={p.id}
                    ref={(el) => {
                      if (el) rowEls.current.set(p.id, el)
                      else rowEls.current.delete(p.id)
                    }}
                    onMouseEnter={() => setHoverId(p.id)}
                    onMouseLeave={() => setHoverId((h) => (h === p.id ? null : h))}
                    className={cn(
                      'relative',
                      drag?.id === p.id && 'z-10 overflow-hidden rounded-xl bg-card/95 shadow-[0_14px_36px_rgb(0_0_0/0.5)] backdrop-blur-xl'
                    )}
                    style={
                      drag
                        ? drag.id === p.id
                          ? { transform: `translateY(${drag.dy}px) scale(1.01)` }
                          : { transform: `translateY(${rowShift(i)}px)`, transition: 'transform 180ms cubic-bezier(.2,.8,.2,1)' }
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        'group relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border py-2.5 pr-3 pl-1 transition-colors',
                        isHidden && !isActive && 'opacity-60',
                        isActive
                          ? 'border-primary/40 bg-primary/[0.09]'
                          : 'border-transparent hover:border-foreground/[0.08] hover:bg-foreground/[0.03]'
                      )}
                    >
                      {isActive && <span aria-hidden className="pointer-events-none absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-primary" />}
                      <span
                        title="Перетащите, чтобы поменять порядок"
                        onPointerDown={(e) => startDrag(e, p.id)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        className={cn(
                          'flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 hover:text-foreground active:cursor-grabbing',
                          drag?.id === p.id && 'text-primary'
                        )}
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
                          isActive ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
                        )}
                      >
                        {p.url ? <ShieldCheck /> : <Server />}
                      </span>
                      <div className="min-w-[13rem] flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('text-[13.5px] font-semibold', isActive ? 'text-primary' : 'text-foreground')}>{p.name}</span>
                          {isActive && <span className="rounded-md bg-primary px-1.5 py-px text-[10.5px] font-bold text-primary-foreground">включён</span>}
                          {p.url ? (
                            <Tag tone="ok">
                              <Lock className="size-2.5" />
                              {p.strict ? 'только DoH' : 'DoH'}
                            </Tag>
                          ) : (
                            <Tag>
                              <LockOpen className="size-2.5" />
                              без шифрования
                            </Tag>
                          )}
                          {p.ipv6 && p.ipv6.length > 0 && <Tag>IPv6</Tag>}
                          {p.custom && <Tag tone="primary">свой</Tag>}
                          {edited && <Tag tone="primary">изменено вами</Tag>}
                          {isHidden && <Tag>скрыт у вас</Tag>}
                          {marked && <Tag tone="primary">будет убран у всех</Tag>}
                        </div>
                        {!p.custom && p.description && (
                          <div className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-muted-foreground" title={p.description}>
                            {p.description}
                          </div>
                        )}
                        <div
                          className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground/75"
                          title={[addrs, ...(p.ipv6 ?? []), p.url].filter(Boolean).join('\n')}
                        >
                          {addrs}
                          {bm?.catalogUpdated && (
                            <span title="Дата, которую указал каталог: когда у сервиса менялись адреса">
                              {addrs ? ', ' : ''}адреса от {ruDate(bm.catalogUpdated)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Правая часть — слоты одной ширины во всех строках:
                          пинг | «карандаш» и «⋯» | главная кнопка. Переносится одним блоком. */}
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <span data-slot-ping className="flex w-[5.5rem] items-center justify-end gap-2">
                          <PingChip ms={ms} loading={pinging} on={isActive} />
                        </span>
                        <div
                          data-slot-acts
                          className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                        >
                          <Button
                            data-tour={firstBuiltin ? 'dns-builtin-edit' : undefined}
                            size="icon-sm"
                            variant="ghost"
                            className="size-7 rounded-lg bg-clip-border p-0"
                            title={
                              p.custom
                                ? 'Изменить'
                                : 'Изменить адреса и DoH этого сервера. Ваша правка будет главнее каталога, пока вы её не сбросите.'
                            }
                            aria-label="Изменить"
                            onClick={() => openForm(p)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <DnsRowMenu items={menu} tour={firstBuiltin ? 'dns-row-menu' : undefined} />
                        </div>
                        <Button
                          data-slot-main
                          size="sm"
                          variant={isActive ? 'default' : 'outline'}
                          className="h-8 w-[7.25rem] rounded-lg text-xs"
                          disabled={busy || lockedOnMac}
                          title={lockedOnMac ? 'Сначала установите профиль с шифрованным DNS' : undefined}
                          onClick={() => void apply(p)}
                        >
                          {applyingId === p.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : isActive ? (
                            <Check className="size-3.5" />
                          ) : null}
                          {applyingId === p.id ? 'Ставлю…' : isActive ? 'Активен' : 'Включить'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </LzPanel>
        )}

        {tab === 'ai' && <AiDnsCheckCard />}

        <DnsRemoveDialog
          key={removeTarget?.id ?? 'none'}
          open={removeTarget !== null}
          name={removeTarget?.name ?? ''}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={(reason) => void markRemove(reason)}
        />

        <DnsServerDialog
          key={formOpen ?? 'closed'}
          open={formOpen !== null}
          kind={formOpen === 'new' || formOpen === null ? 'new' : editingProvider?.custom ? 'custom' : 'builtin'}
          initial={form}
          title={editingProvider?.name}
          edited={Boolean(editingProvider && cat?.meta[editingProvider.id]?.edited)}
          saving={saving}
          onCancel={() => setFormOpen(null)}
          onSave={(f) => void saveForm(f)}
          onRevert={
            editingProvider && !editingProvider.custom
              ? () => {
                  setFormOpen(null)
                  void revertBuiltin(editingProvider)
                }
              : undefined
          }
        />
      </div>
    </BasePage>
  )
}

/** Плашка-предупреждение между пультом и списком: жёлтая — «нужно внимание», красная — ошибка. */
function Banner({ tone, tour, children }: { tone: 'warn' | 'error' | 'info'; tour?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      data-tour={tour}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-[12.5px] leading-relaxed text-foreground',
        tone === 'warn' && 'border-st-warn/40 bg-st-warn/10',
        tone === 'error' && 'border-st-err/45 bg-st-err/10',
        tone === 'info' && 'border-primary/30 bg-primary/[0.06]'
      )}
    >
      {tone === 'info' ? (
        <Lock className="size-4 shrink-0 text-primary" />
      ) : (
        <TriangleAlert className={cn('size-4 shrink-0', tone === 'warn' ? 'text-st-warn-text' : 'text-st-err-text')} />
      )}
      {children}
    </div>
  )
}
