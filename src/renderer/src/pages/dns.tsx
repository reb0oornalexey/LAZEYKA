import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Check,
  ExternalLink,
  GripVertical,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import BasePage from '@renderer/components/base/base-page'
import { Button } from '@renderer/components/ui/button'
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

const isMac = platform === 'darwin'

type FormState = { name: string; v4a: string; v4b: string; v6a: string; v6b: string; doh: string; fallback: boolean; site: string }
const EMPTY_FORM: FormState = { name: '', v4a: '', v4b: '', v6a: '', v6b: '', doh: '', fallback: false, site: '' }

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

function PingChip({ ms, loading }: { ms: number | null | undefined; loading: boolean }): React.ReactElement {
  if (loading && ms == null) {
    return <span className="h-5 w-12 animate-pulse rounded-md bg-foreground/[0.06]" />
  }
  if (ms == null) return <span className="text-[10px] font-mono text-muted-foreground">нет ответа</span>
  const tone = ms < 60 ? 'text-st-ok-text bg-st-ok/10' : ms < 150 ? 'text-st-warn-text bg-st-warn/10' : 'text-st-err-text bg-st-err/10'
  return <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums', tone)}>{ms} мс</span>
}

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ok' | 'primary' }): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide',
        tone === 'ok' && 'border-st-ok/30 bg-st-ok/10 text-st-ok-text',
        tone === 'primary' && 'border-primary/30 bg-primary/10 text-primary',
        tone === 'muted' && 'border-border bg-card/60 text-muted-foreground'
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
  // Перетаскивание за «ручку» слева. Строка едет за курсором, остальные плавно
  // расступаются (transform + transition); в покое у строк нет transform — иначе
  // стекло карточки рисовалось «лесенкой». Порядок сохраняется.
  const rowEls = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<{ id: string; from: number; over: number; dy: number; startY: number; h: number; mids: number[] } | null>(null)
  const startDrag = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const from = providers.findIndex((p) => p.id === id)
    const rects = providers.map((p) => rowEls.current.get(p.id)?.getBoundingClientRect())
    if (from < 0 || rects.some((x) => !x)) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id, from, over: from, dy: 0, startY: e.clientY, h: rects[from]!.height, mids: rects.map((x) => x!.top + x!.height / 2) })
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
    const next = [...providers]
    const [it] = next.splice(from, 1)
    next.splice(over, 0, it)
    setProviders(next)
    void dnsSetOrder(next.map((p) => p.id)).catch(() => void 0)
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

  const loadPings = useCallback(async () => {
    setPinging(true)
    try {
      const list = await dnsGetProviders()
      setPings(Object.fromEntries(list.map((p) => [p.id, p.latencyMs])))
      // Пинг-запрос возвращает и свежие адреса (например, DNS-AI) — обновляем список.
      setProviders(list.map((p) => ({ ...p, latencyMs: null })))
    } catch {
      /* без пинга */
    } finally {
      setPinging(false)
    }
  }, [])

  const reload = useCallback(async () => {
    const list = await dnsProvidersInstant().catch(() => [] as DohProvider[])
    setProviders(list)
    void loadState()
  }, [loadState])

  useEffect(() => {
    void reload()
    void loadPings()
  }, [reload, loadPings])

  const activeId = state?.providerId ?? null
  const active = providers.find((p) => p.id === activeId) ?? null
  const macNeedsProfile = isMac && !state?.macProfileReady

  const systemLine = useMemo(() => {
    if (!state) return 'Проверяю, какой DNS стоит в системе…'
    if (active) {
      const enc = !active.url ? 'без шифрования' : active.strict ? 'только шифрованный DoH' : 'DoH с запасным обычным DNS'
      return `${active.name} · ${enc}`
    }
    if (state.servers.length === 0) return 'Стандартный DNS от провайдера (DHCP)'
    return `Свой DNS системы: ${state.servers.slice(0, 3).join(', ')}`
  }, [state, active])

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
      toast.error('Не удалось изменить DNS', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setApplyingId(null)
      void loadState()
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

  const saveForm = async (): Promise<void> => {
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
      if (formOpen && formOpen !== 'new') {
        await dnsUpdateCustom(formOpen, input)
        toast.success('DNS-сервер изменён', {
          description: formOpen === activeId ? 'Нажмите «Включить» ещё раз, чтобы применить новые адреса.' : undefined
        })
      } else {
        await dnsAddCustom(input)
        toast.success('DNS-сервер добавлен', { description: 'Нажмите «Включить» в его строке, чтобы применить.' })
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
      toast.error('Этот DNS сейчас включён', { description: 'Сначала выберите другой или сбросьте DNS.' })
      return
    }
    try {
      await dnsRemoveCustom(p.id)
      await reload()
    } catch (e) {
      toast.error('Не удалось удалить', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = applyingId !== null

  return (
    <BasePage title="DNS">
      <div className="px-4 pb-6 space-y-4">
        {/* Что стоит сейчас */}
        <div className="flex flex-wrap items-center gap-3 ui-card rounded-2xl border border-border bg-card px-4 py-3">
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl border',
              active?.url ? 'border-st-ok/40 bg-st-ok/10 text-st-ok-text' : 'border-border bg-card/60 text-muted-foreground'
            )}
          >
            {active?.url ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Сейчас в системе</div>
            <div className="truncate text-sm font-semibold text-foreground">{systemLine}</div>
          </div>
          <Button size="sm" variant="ghost" className="text-xs" disabled={pinging} onClick={() => void loadPings()}>
            <RotateCw className={cn('size-3.5', pinging && 'animate-spin')} />
            Пинг
          </Button>
          <Button size="sm" variant="outline" className="text-xs" disabled={busy} onClick={() => void apply('dhcp')}>
            {applyingId === 'dhcp' ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Сбросить на стандартный
          </Button>
        </div>

        {/* macOS: профиль обязателен (один раз) */}
        {isMac && (macNeedsProfile || state?.macProfileStale) && !macPending && (
          <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] px-4 py-3 text-xs leading-relaxed">
            <div className="mb-1 flex items-center gap-2 font-semibold text-foreground">
              <Lock className="size-3.5 text-primary" />
              {state?.macProfileStale ? 'Адреса сервера изменились — переустановите профиль' : 'На macOS шифрованный DNS ставится профилем (один раз)'}
            </div>
            <p className="text-muted-foreground">
              Нажмите «Включить» у сервера с DoH — LAZEYKA создаст профиль и покажет, где его установить. Пока профиль не
              установлен и не включён, другие DNS не выбираются: без него macOS шифрование не применяет.
            </p>
          </div>
        )}

        {macPending && (
          <div className="ui-glow rounded-2xl border border-primary/40 bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-foreground">Установите профиль «{macPending.name} (DoH) — LAZEYKA»</div>
                <div className="text-xs text-muted-foreground">Это нужно сделать один раз. Без пароля администратора macOS профиль не поставит.</div>
              </div>
              <button type="button" className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.06]" onClick={() => setMacPending(null)}>
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
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                  <span className="leading-relaxed">{t}</span>
                </li>
              ))}
            </ol>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => void apply(macPending)}>
                Открыть профиль ещё раз
              </Button>
              <Button size="sm" className="text-xs" onClick={() => void confirmMac()}>
                <Check className="size-3.5" />
                Я установил и включил
              </Button>
            </div>
          </div>
        )}

        {/* Список серверов */}
        <div className="overflow-hidden ui-card rounded-2xl border border-border bg-card">
          {providers.length === 0 && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-foreground/[0.04]" />
              ))}
            </div>
          )}
          {providers.map((p, i) => {
            const isActive = p.id === activeId
            const lockedOnMac = macNeedsProfile && !p.url
            const addrs = [p.ip, p.secondaryIp].filter(Boolean).join(', ')
            return (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) rowEls.current.set(p.id, el)
                  else rowEls.current.delete(p.id)
                }}
                className={cn('relative', drag?.id === p.id && 'z-10 overflow-hidden rounded-xl bg-card/95 shadow-[0_14px_36px_rgb(0_0_0/0.5)] backdrop-blur-xl')}
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
                    'group relative flex items-center gap-3 py-3 pl-1.5 pr-4 transition-colors',
                    i > 0 && drag?.id !== p.id && 'border-t border-border/60',
                    isActive
                      ? 'bg-primary/[0.14]'
                      : 'hover:bg-foreground/[0.03]'
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
                      'flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/50 hover:text-foreground active:cursor-grabbing',
                      drag?.id === p.id && 'text-primary'
                    )}
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                      isActive ? 'border-primary shadow-[0_0_10px_var(--primary)]' : 'border-border'
                    )}
                  >
                    {isActive && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('text-[13px] font-semibold', isActive ? 'text-primary' : 'text-foreground')}>{p.name}</span>
                      {isActive && (
                        <span className="rounded-md bg-primary px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-primary-foreground">
                          включён
                        </span>
                      )}
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
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={[addrs, ...(p.ipv6 ?? []), p.url].filter(Boolean).join('\n')}>
                      {!p.custom && p.description ? `${p.description} · ` : ''}
                      <span className="font-mono">{addrs}</span>
                    </div>
                  </div>
                  <PingChip ms={pings[p.id]} loading={pinging} />
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    {p.site && (
                      <Button size="icon-sm" variant="ghost" title="Сайт сервиса" onClick={() => void openExternalUrl(p.site!)}>
                        <ExternalLink className="size-3.5" />
                      </Button>
                    )}
                    {p.custom && (
                      <>
                        <Button size="icon-sm" variant="ghost" title="Изменить" onClick={() => openForm(p)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" title="Удалить" onClick={() => void remove(p)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={isActive ? 'default' : 'outline'}
                    className="h-8 min-w-[6.5rem] text-xs"
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

                {formOpen === p.id && (
                  <DnsForm form={form} setForm={setForm} saving={saving} onCancel={() => setFormOpen(null)} onSave={() => void saveForm()} edit />
                )}
              </div>
            )
          })}
        </div>

        {formOpen === 'new' ? (
          <div className="overflow-hidden ui-card rounded-2xl border border-border bg-card">
            <DnsForm form={form} setForm={setForm} saving={saving} onCancel={() => setFormOpen(null)} onSave={() => void saveForm()} />
          </div>
        ) : (
          <Button size="sm" variant="outline" className="text-xs" onClick={() => openForm()}>
            <Plus className="size-3.5" />
            Свой DNS-сервер
          </Button>
        )}

        <p className="rounded-xl border border-border/50 bg-card/75 px-3 py-2 text-[11.5px] leading-relaxed text-foreground/80 backdrop-blur-md">
          {isMac
            ? 'На macOS адреса DNS выставляются для всех сетевых служб, шифрование DoH — через профиль LAZEYKA. Пока INCY подключён в режиме TUN, DNS ведёт служба LAZEYKA.'
            : 'DNS меняется на рабочих сетевых адаптерах; прежние адреса запоминаются и возвращаются кнопкой «Сбросить». Пока INCY подключён в режиме TUN, имена резолвит сам VPN; в режиме ExitLag всё, что идёт мимо VPN, использует этот DNS.'}
        </p>
      </div>
    </BasePage>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-foreground/90">
        {label}
        {hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'h-9 rounded-xl border border-border bg-background/70 px-3 text-xs outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:bg-background'

type Enc = 'none' | 'doh' | 'strict'

function DnsForm({
  form,
  setForm,
  saving,
  onCancel,
  onSave,
  edit = false
}: {
  form: FormState
  setForm: (f: FormState) => void
  saving: boolean
  onCancel: () => void
  onSave: () => void
  edit?: boolean
}): React.ReactElement {
  const [showV6, setShowV6] = useState(Boolean(form.v6a || form.v6b))
  // Новый сервер — сразу «Только DoH»: самый понятный и безопасный вариант.
  // У существующего — то, что у него сохранено.
  const [mode, setMode] = useState<Enc>(edit ? (form.doh ? (form.fallback ? 'doh' : 'strict') : 'none') : 'strict')
  const setEnc = (m: Enc): void => {
    setMode(m)
    if (m === 'none') setForm({ ...form, doh: '', fallback: false })
    else setForm({ ...form, fallback: m === 'doh' })
  }
  const ipOk = (v: string, six = false): boolean =>
    !v.trim() || (six ? /^[0-9a-f:]+$/i.test(v.trim()) && v.includes(':') : /^(\d{1,3}\.){3}\d{1,3}$/.test(v.trim()))
  const dohOk = mode === 'none' || /^https:\/\/[^\s/]+\.[^\s]+/i.test(form.doh.trim())
  const valid = form.name.trim() && form.v4a.trim() && ipOk(form.v4a) && ipOk(form.v4b) && ipOk(form.v6a, true) && ipOk(form.v6b, true) && dohOk

  return (
    <div className="space-y-4 border-t border-border/60 bg-gradient-to-b from-primary/[0.04] to-transparent px-5 py-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {edit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        </span>
        <div>
          <div className="text-sm font-bold text-foreground">{edit ? 'Изменить DNS-сервер' : 'Свой DNS-сервер'}</div>
          <div className="text-[11px] text-muted-foreground">Адреса и шаблон DoH обычно есть на сайте сервиса в разделе «Настройка для Windows».</div>
        </div>
      </div>

      <Field label="Название">
        <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Например, «Мой DNS»" />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="IPv4 основной">
          <input className={cn(inputCls, 'font-mono', !ipOk(form.v4a) && 'border-st-err/60')} value={form.v4a} onChange={(e) => setForm({ ...form, v4a: e.target.value })} placeholder="1.2.3.4" />
        </Field>
        <Field label="IPv4 дополнительный" hint="необязательно">
          <input className={cn(inputCls, 'font-mono', !ipOk(form.v4b) && 'border-st-err/60')} value={form.v4b} onChange={(e) => setForm({ ...form, v4b: e.target.value })} placeholder="5.6.7.8" />
        </Field>
      </div>

      {showV6 ? (
        <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="IPv6 основной" hint="необязательно">
            <input className={cn(inputCls, 'font-mono', !ipOk(form.v6a, true) && 'border-st-err/60')} value={form.v6a} onChange={(e) => setForm({ ...form, v6a: e.target.value })} placeholder="2a00:…" />
          </Field>
          <Field label="IPv6 дополнительный" hint="необязательно">
            <input className={cn(inputCls, 'font-mono', !ipOk(form.v6b, true) && 'border-st-err/60')} value={form.v6b} onChange={(e) => setForm({ ...form, v6b: e.target.value })} placeholder="2a00:…" />
          </Field>
        </div>
          <button
            type="button"
            onClick={() => {
              setShowV6(false)
              setForm({ ...form, v6a: '', v6b: '' })
            }}
            className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-st-err-text"
          >
            − Убрать IPv6
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowV6(true)} className="cursor-pointer text-[11px] font-semibold text-primary hover:underline">
          + Добавить адреса IPv6
        </button>
      )}

      <Field label="Сайт сервиса" hint="необязательно — появится кнопка перехода на сайт">
        <input className={inputCls} value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="https://example.com" />
      </Field>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-foreground/90">Шифрование</div>
        <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-background/50 p-1">
          {([
            ['none', 'Без шифрования'],
            ['doh', 'DoH + запасной'],
            ['strict', 'Только DoH']
          ] as [Enc, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setEnc(id)}
              className={cn(
                'cursor-pointer rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors',
                mode === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {mode !== 'none' && (
          <Field label="Шаблон DoH">
            <input
              className={cn(inputCls, 'font-mono', !dohOk && form.doh.trim() && 'border-st-err/60')}
              value={form.doh}
              onChange={(e) => setForm({ ...form, doh: e.target.value })}
              placeholder="https://dns.example.com/dns-query"
            />
          </Field>
        )}
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          {mode === 'none'
            ? 'Запросы идут открыто — провайдер их видит.'
            : mode === 'doh'
              ? 'Шифрованно; если DoH не ответил, Windows спросит обычным способом.'
              : 'Только шифрованно: надёжнее, но если сервер DoH недоступен — сайты не откроются.'}
        </p>
      </div>

      <div className="flex justify-end gap-2 border-t border-border/50 pt-3">
        <Button size="sm" variant="ghost" className="text-xs" onClick={onCancel}>
          Отмена
        </Button>
        <Button size="sm" className="min-w-28 text-xs" onClick={onSave} disabled={saving || !valid}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {edit ? 'Сохранить' : 'Добавить'}
        </Button>
      </div>
    </div>
  )
}

