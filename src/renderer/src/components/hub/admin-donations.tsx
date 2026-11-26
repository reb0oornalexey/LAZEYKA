import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownWideNarrow,
  CalendarClock,
  CheckCircle2,
  HandHeart,
  Inbox,
  Link2,
  Loader2,
  Palette,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Square,
  Trash2,
  Users,
  X
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import {
  adminCampDelete,
  adminCampSave,
  adminDonDelete,
  adminDonSave,
  adminLevelsSave,
  DON_DEFAULT_LEVELS,
  DON_PALETTE,
  DON_METHOD_NAMES,
  guessMethodIcon,
  levelOf,
  money,
  type DonationsAdmin,
  type DonCampaignAdmin,
  type DonItemAdmin,
  type DonLevel,
  type DonStyle
} from '@renderer/utils/hub-donations-api'
import { DonorChip, DonProgress, LevelLegend } from './donation-ui'
import { MethodsEditor, methodsFromRows, rowsFromMethods, rowsValid, type MethodRow } from './admin-methods'
import { MethodIcon } from './pay-icons'
import { ColorPick } from './admin-pickers'
import { ClaimsPanel } from './admin-claims'
import { StylesPanel } from './admin-styles'

export type DonTab = 'list' | 'claims' | 'styles' | 'levels'
type Tab = DonTab

import { AdminTabs, Field, Segmented, inputClass, insetClass } from './admin-section'
import { EmptyState, LiveNumber, LzPanel, LzSectionHead } from '@renderer/components/lz'
import { HubModal, textareaClass } from './modal'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fmtDate = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dayRu = (t: number): string => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const pad = (n: number): string => String(n).padStart(2, '0')
/** ms → значение поля datetime-local / date (местное время). */
const toLocal = (t: number, withTime = true): string => {
  const d = new Date(t)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}` : day
}
const fromLocal = (s: string): number | null => {
  if (!s) return null
  const t = new Date(s.length === 10 ? `${s}T00:00` : s).getTime()
  return Number.isFinite(t) ? t : null
}
/** Сумма из поля: «1 500», «99,5». */
const parseAmount = (s: string): number | null => {
  const t = s.replace(/[\s₽$€]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 100_000_000 ? n : null
}

type Sort = 'new' | 'old' | 'big' | 'small'
const LIST_STEP = 30

// ---- Сбор: создание и правка -------------------------------------------------------------------

interface CampForm {
  title: string
  goal: string
  cur: string
  descr: string
  methods: MethodRow[]
  starts: string
  ends: string
  active: boolean
}

const CampaignDialog: React.FC<{
  open: boolean
  camp: DonCampaignAdmin | null
  defaultLink: string
  onClose: () => void
  onSaved: (d: DonationsAdmin) => void
}> = ({ open, camp, defaultLink, onClose, onSaved }) => {
  const blank = (): CampForm => ({ title: '', goal: '', cur: '₽', descr: '', methods: defaultLink ? rowsFromMethods([{ name: DON_METHOD_NAMES[guessMethodIcon(defaultLink)], url: defaultLink, icon: guessMethodIcon(defaultLink) }]) : [], starts: '', ends: '', active: true })
  const [f, setF] = useState<CampForm>(blank)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setF(
      camp
        ? {
            title: camp.title,
            goal: String(camp.goal),
            cur: camp.cur,
            descr: camp.descr,
            methods: rowsFromMethods(camp.methods),
            starts: camp.starts ? toLocal(camp.starts, false) : '',
            ends: camp.ends ? toLocal(camp.ends, false) : '',
            active: camp.active
          }
        : blank()
    )
    // blank зависит только от defaultLink.
  }, [open, camp, defaultLink])
  const set = <K extends keyof CampForm>(k: K, v: CampForm[K]): void => setF((x) => ({ ...x, [k]: v }))
  const goal = parseAmount(f.goal)
  const linkOk = rowsValid(f.methods)
  const ends = fromLocal(f.ends)
  const starts = fromLocal(f.starts)
  const datesOk = !(starts && ends && ends <= starts)
  const ok = f.title.trim().length > 0 && goal !== null && f.cur.trim().length > 0 && linkOk && datesOk

  const save = async (): Promise<void> => {
    if (!ok || goal === null) return
    setBusy(true)
    try {
      const d = await adminCampSave({
        ...(camp ? { id: camp.id } : {}),
        title: f.title.trim(),
        goal,
        cur: f.cur.trim(),
        descr: f.descr.trim(),
        // Старый Hub знает только одну ссылку: первый способ.
        link: methodsFromRows(f.methods)[0]?.url ?? '',
        methods: methodsFromRows(f.methods),
        starts,
        // «до 30 ноября» — включительно, до конца дня.
        ends: ends ? ends + 24 * 60 * 60 * 1000 - 1 : null,
        active: f.active
      })
      toast.success(camp ? 'Сбор сохранён' : 'Сбор создан', { description: 'В программах обновится при следующем открытии «Поддержки» (до 10 минут).' })
      onSaved(d)
      onClose()
    } catch (e) {
      toast.error('Не сохранено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <HubModal
      open={open}
      onClose={onClose}
      locked={busy}
      icon={HandHeart}
      title={camp ? 'Сбор' : 'Новый сбор'}
      subtitle="Что увидят все на странице «Поддержка»"
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} {camp ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Field label="Название" error={f.title.length > 60 ? 'До 60 знаков' : null}>
          <input className={inputClass} value={f.title} autoFocus onChange={(e) => set('title', e.target.value.slice(0, 60))} placeholder="Например: на сервер для обновлений" />
        </Field>
        <Field label="Цель" error={f.goal && goal === null ? 'Число больше нуля' : null}>
          <input className={cn(inputClass, 'font-mono')} inputMode="decimal" value={f.goal} onChange={(e) => set('goal', e.target.value.slice(0, 14))} placeholder="10 000" />
        </Field>
      </div>
      <Field label="Валюта" help="Символ после сумм. По умолчанию рубли.">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<string> label="Валюта" value={['₽', '$', '€', '₸'].includes(f.cur) ? f.cur : ''} onChange={(v) => set('cur', v)} items={[['₽', '₽'], ['$', '$'], ['€', '€'], ['₸', '₸']]} />
          <input className={cn(inputClass, 'h-8 w-20 text-center')} value={f.cur} onChange={(e) => set('cur', e.target.value.slice(0, 4))} aria-label="Свой символ валюты" />
        </div>
      </Field>
      <Field label="Описание" optional help="Одна-две фразы: на что сбор.">
        <textarea className={cn(textareaClass, "text-xs")} rows={2} value={f.descr} onChange={(e) => set('descr', e.target.value.slice(0, 300))} placeholder="Например: оплата сервера сборки и подписи для macOS" />
      </Field>
      <MethodsEditor rows={f.methods} onChange={(rows) => set('methods', rows)} defaultLink={defaultLink} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Начало" optional help="До этого дня сбор не виден.">
          <input type="date" className={inputClass} value={f.starts} onChange={(e) => set('starts', e.target.value)} />
        </Field>
        <Field label="Окончание" optional error={datesOk ? null : 'Позже начала'} help="Включительно. После — сбор скрывается.">
          <input type="date" className={inputClass} value={f.ends} onChange={(e) => set('ends', e.target.value)} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] px-3 py-2.5">
        <span className="text-xs">
          <span className="block font-semibold">Активен</span>
          <span className="text-[11px] text-muted-foreground">Активные сборы (до 3) видны всем. Завершённый остаётся в списке, его можно включить снова.</span>
        </span>
        <Switch checked={f.active} onCheckedChange={(v) => set('active', v)} />
      </label>
    </HubModal>
  )
}

// ---- Пожертвование: правка ---------------------------------------------------------------------

const DonationDialog: React.FC<{
  item: DonItemAdmin | null
  data: DonationsAdmin
  onClose: () => void
  onSaved: (d: DonationsAdmin) => void
}> = ({ item, data, onClose, onSaved }) => {
  const [nick, setNick] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [at, setAt] = useState('')
  const [camp, setCamp] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!item) return
    setNick(item.nick)
    setAmount(String(item.amount))
    setNote(item.note)
    setAt(toLocal(item.at))
    setCamp(item.camp)
  }, [item])
  const a = parseAmount(amount)
  const t = fromLocal(at)
  const ok = nick.trim().length > 0 && nick.trim().length <= 32 && a !== null && t !== null
  const cur = data.campaigns.find((c) => c.id === camp)?.cur ?? '₽'

  const save = async (): Promise<void> => {
    if (!item || !ok || a === null || t === null) return
    setBusy(true)
    try {
      const d = await adminDonSave({ id: item.id, nick: nick.trim(), amount: a, note: note.trim(), at: t, camp })
      toast.success('Сохранено')
      onSaved(d)
      onClose()
    } catch (e) {
      toast.error('Не сохранено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <HubModal
      open={Boolean(item)}
      onClose={onClose}
      locked={busy}
      icon={Pencil}
      title="Пожертвование"
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Сохранить
          </Button>
        </>
      }
    >
      <div className="flex justify-center py-1">
        <DonorChip nick={nick.trim() || 'Ник'} levels={data.levels} level={levelOf(data.levels, a ?? 0)} amount={a !== null ? money(a, cur) : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ник">
          <input className={inputClass} value={nick} onChange={(e) => setNick(e.target.value.slice(0, 32))} />
        </Field>
        <Field label="Сумма" error={amount && a === null ? 'Число больше нуля' : null}>
          <input className={cn(inputClass, 'font-mono')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.slice(0, 14))} />
        </Field>
      </div>
      <Field label="Когда">
        <input type="datetime-local" className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      {data.campaigns.length > 1 && (
        <Field label="Сбор">
          <select className={inputClass} value={camp} onChange={(e) => setCamp(Number(e.target.value))}>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.active ? '' : ' (завершён)'}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Комментарий" optional help="Виден только вам.">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} />
      </Field>
    </HubModal>
  )
}

// ---- Уровни цвета --------------------------------------------------------------------------------

const LevelsEditor: React.FC<{ data: DonationsAdmin; onSaved: (d: DonationsAdmin) => void }> = ({ data, onSaved }) => {
  const [rows, setRows] = useState<{ from: string; name: string; color: string }[]>([])
  const [busy, setBusy] = useState(false)
  const reset = useCallback(() => setRows(data.levels.map((l) => ({ from: String(l.from), name: l.name, color: l.color }))), [data.levels])
  useEffect(reset, [reset])
  const palette = Object.keys(data.palette).length ? data.palette : DON_PALETTE
  const parsed: DonLevel[] = rows.map((r) => ({ from: parseAmount(r.from) ?? NaN, name: r.name.trim(), color: r.color }))
  const sorted = [...parsed].sort((a, b) => a.from - b.from)
  const froms = parsed.map((l) => l.from)
  const dup = froms.some((v, i) => froms.indexOf(v) !== i)
  const valid = rows.length > 0 && parsed.every((l) => Number.isFinite(l.from) && l.name) && !dup
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.levels.map((l) => ({ from: String(l.from), name: l.name, color: l.color })))

  const save = async (levels: DonLevel[] | null): Promise<void> => {
    setBusy(true)
    try {
      onSaved(await adminLevelsSave(levels))
      toast.success(levels ? 'Уровни сохранены' : 'Уровни по умолчанию')
    } catch (e) {
      toast.error('Не сохранено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }
  const setRow = (i: number, patch: Partial<{ from: string; name: string; color: string }>): void => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => {
        const isTop = valid && sorted.length > 1 && sorted[sorted.length - 1] === parsed[i]
        return (
          <div key={i} className={cn(insetClass, 'grid gap-2 p-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_6.5rem_auto] sm:items-center')}>
            <div className="flex items-center">
              <DonorChip nick={r.name.trim() || 'Ник'} levels={[{ from: 1, name: r.name, color: r.color }]} level={0} glow={isTop} size="sm" title="Так выглядит ник этого уровня" />
            </div>
            <input className={cn(inputClass, 'h-8')} value={r.name} onChange={(e) => setRow(i, { name: e.target.value.slice(0, 24) })} placeholder="Название" aria-label="Название уровня" />
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-muted-foreground">от</span>
              <input
                className={cn(inputClass, 'h-8 pl-7 font-mono', (!Number.isFinite(parsed[i].from) || (dup && froms.indexOf(parsed[i].from) !== i)) && 'border-st-err/70')}
                inputMode="decimal"
                value={r.from}
                onChange={(e) => setRow(i, { from: e.target.value.slice(0, 12) })}
                aria-label="Порог уровня"
              />
            </div>
            <Button size="icon-sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length <= 1 || busy} aria-label="Убрать уровень" title="Убрать уровень">
              <Trash2 />
            </Button>
            <div className="sm:col-span-4">
              <ColorPick value={r.color} onChange={(v) => v && setRow(i, { color: v })} palette={palette} />
            </div>
          </div>
        )
      })}
      {dup && <p className="text-[11px] text-st-err-text">У двух уровней одинаковый порог.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length >= 8 || busy}
          onClick={() => {
            const top = sorted.filter((l) => Number.isFinite(l.from)).pop()?.from ?? 500
            setRows((rs) => [...rs, { from: String(top * 2), name: 'Новый', color: 'blue' }])
          }}
        >
          <Plus /> Уровень
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)} title={DON_DEFAULT_LEVELS.map((l) => `${l.name} от ${l.from}`).join(', ')}>
          <RotateCcw /> По умолчанию
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
            <X /> Отменить правки
          </Button>
        )}
        <Button size="sm" className="ml-auto" disabled={!dirty || !valid || busy} onClick={() => void save(sorted)}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />} Сохранить уровни
        </Button>
      </div>
    </div>
  )
}

// ---- Карточка сбора: большие цифры, проценты, полоса с цветами уровней ------------------------------

/**
 * Плашка сбора — «прибор» раздела: собрано крупно, процент цели, полоса заполняется цветами
 * уровней. Используется в разделе «Пожертвования» (с действиями) и на «Обзоре» (с кнопкой «Открыть»).
 */
export const CampaignCard: React.FC<{ camp: DonCampaignAdmin; levels: DonLevel[]; actions?: React.ReactNode; compact?: boolean; className?: string }> = ({
  camp,
  levels,
  actions,
  compact,
  className
}) => {
  const done = camp.raised >= camp.goal
  return (
    <LzPanel tone={camp.active ? 'on' : 'off'} glow={12} className={cn(camp.active && 'border-primary/30', className)}>
      <div className={cn('relative space-y-3', compact ? 'p-4' : 'px-5 py-4')}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[16px] font-bold text-[color:var(--text-title)]">{camp.title}</h3>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-semibold',
                  camp.active ? 'bg-primary/12 text-primary' : 'bg-foreground/[0.07] text-muted-foreground'
                )}
              >
                <span aria-hidden className={cn('size-1.5 rounded-full', camp.active ? 'lz-beacon relative bg-primary' : 'bg-muted-foreground/50')} />
                {camp.active ? 'Активен' : 'Завершён'}
              </span>
            </div>
            {camp.descr && <p className="mt-0.5 line-clamp-2 max-w-[58ch] text-[12px] text-muted-foreground">{camp.descr}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-1">{actions}</div>}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2">
            <LiveNumber value={money(camp.raised, camp.cur)} className={cn('font-extrabold tracking-tight text-[color:var(--text-title)]', compact ? 'text-[30px]' : 'text-[38px]')} />
            <span className="text-[13px] text-muted-foreground">из {money(camp.goal, camp.cur)}</span>
          </div>
          <span className={cn('font-extrabold tabular-nums', compact ? 'text-[20px]' : 'text-[24px]', done ? 'text-st-ok-text' : 'text-primary')}>
            {camp.pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %
          </span>
        </div>
        <DonProgress raised={camp.raised} goal={camp.goal} levels={levels} byLevel={camp.byLevel} below={camp.below} variant="levels" size="lg" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> поддержали <b className="tabular-nums text-foreground">{camp.donors}</b>
          </span>
          <span>
            записей <span className="tabular-nums">{camp.count}</span>
          </span>
          {done && (
            <span className="inline-flex items-center gap-1 text-st-ok-text">
              <CheckCircle2 className="size-3.5" /> цель собрана
            </span>
          )}
          {(camp.starts || camp.ends) && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" />
              {camp.starts ? `с ${dayRu(camp.starts)} ` : ''}
              {camp.ends ? `по ${dayRu(camp.ends)}` : ''}
            </span>
          )}
          {camp.methods.length ? (
            <span className="inline-flex min-w-0 items-center gap-1.5" title={camp.methods.map((m) => `${m.name}: ${m.url}`).join('\n')}>
              <span className="flex -space-x-1">
                {camp.methods.map((m) => (
                  <MethodIcon key={m.url} icon={m.icon} className="size-4 rounded-full ring-2 ring-card" />
                ))}
              </span>
              <span className="truncate">{camp.methods.map((m) => m.name).join(', ')}</span>
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Link2 className="size-3.5 shrink-0" /> без кнопки «Поддержать»
            </span>
          )}
        </div>
        {!compact && <LevelLegend levels={levels} cur={camp.cur} />}
      </div>
    </LzPanel>
  )
}

// ---- Секция целиком --------------------------------------------------------------------------------

/**
 * «Сбор пожертвований» в «Админке»: карточка сбора с полосой, форма «Добавить», список с поиском и
 * сортировкой, управление сборами и уровнями цвета. Всё идёт через главный процесс с ключом автора;
 * о каждом изменении владельцу приходит сообщение в Telegram с кнопкой отмены.
 */
export const AdminDonationsSection: React.FC<{
  /** Данные сбора грузит страница (их же видит пульт: заявки на проверке). */
  data: DonationsAdmin | null
  loading: boolean
  onData: (d: DonationsAdmin) => void
  /** Открытая вкладка (управляет страница: кнопка «Заявки» на пульте). */
  tab?: DonTab
  onTab?: (t: DonTab) => void
}> = ({ data, loading, onData, tab: tabProp, onTab }) => {
  const [sel, setSel] = useState<number | null>(null)
  const [campDlg, setCampDlg] = useState<{ camp: DonCampaignAdmin | null } | null>(null)
  const [edit, setEdit] = useState<DonItemAdmin | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [confirmCamp, setConfirmCamp] = useState(false)
  const [busy, setBusy] = useState(false)
  // форма «Добавить»
  const [nick, setNick] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [at, setAt] = useState('')
  // список
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('new')
  const [shown, setShown] = useState(LIST_STEP)
  const [tabOwn, setTabOwn] = useState<Tab>('list')
  const tab = tabProp ?? tabOwn
  const setTab = (t: Tab): void => {
    setTabOwn(t)
    onTab?.(t)
  }

  /** Выбранный сбор: новый (id в ответе) → прежний → первый активный → первый. */
  const pickSel = useCallback((d: DonationsAdmin, s: number | null): number | null => {
    if (d.id && d.campaigns.some((c) => c.id === d.id)) return d.id
    if (s && d.campaigns.some((c) => c.id === s)) return s
    return (d.campaigns.find((c) => c.active) ?? d.campaigns[0])?.id ?? null
  }, [])

  const apply = useCallback(
    (d: DonationsAdmin) => {
      onData(d)
      setSel((s) => pickSel(d, s))
    },
    [onData, pickSel]
  )

  // Данные пришли или обновились снаружи (кнопка «Обновить» страницы).
  useEffect(() => {
    if (data) setSel((s) => pickSel({ ...data, id: undefined }, s))
  }, [data, pickSel])

  const camp = data?.campaigns.find((c) => c.id === sel) ?? null
  /** Личные стили ников — те же, что увидят все на «стене». */
  const styleMap = useMemo(() => {
    const m = new Map<string, DonStyle>()
    for (const x of data?.styles ?? []) {
      const st: DonStyle = { ...(x.color ? { color: x.color } : {}), ...(x.emoji ? { emoji: x.emoji } : {}), ...(x.badge ? { badge: x.badge } : {}), ...(x.glow ? { glow: true as const } : {}) }
      m.set(x.nick.toLowerCase(), st)
    }
    return m
  }, [data?.styles])
  const levels = data?.levels ?? DON_DEFAULT_LEVELS
  const a = parseAmount(amount)
  const canAdd = Boolean(camp) && nick.trim().length > 0 && a !== null && !busy

  const list = useMemo(() => {
    if (!data || !camp) return []
    const needle = q.trim().toLowerCase()
    const l = data.donations.filter((d) => d.camp === camp.id && (!needle || d.nick.toLowerCase().includes(needle) || d.note.toLowerCase().includes(needle)))
    const by: Record<Sort, (x: DonItemAdmin, y: DonItemAdmin) => number> = {
      new: (x, y) => y.at - x.at || y.id - x.id,
      old: (x, y) => x.at - y.at || x.id - y.id,
      big: (x, y) => y.amount - x.amount || y.at - x.at,
      small: (x, y) => x.amount - y.amount || y.at - x.at
    }
    return l.sort(by[sort])
  }, [data, camp, q, sort])

  const add = async (): Promise<void> => {
    if (!camp || a === null) return
    setBusy(true)
    try {
      const d = await adminDonSave({ camp: camp.id, nick: nick.trim(), amount: a, note: note.trim(), ...(at ? { at: fromLocal(at) ?? undefined } : {}) })
      apply({ ...d, id: undefined })
      toast.success('Добавлено', { description: `${nick.trim()} — ${money(a, camp.cur)}` })
      setNick('')
      setAmount('')
      setNote('')
      setAt('')
    } catch (e) {
      toast.error('Не добавлено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      apply(await adminDonDelete(id))
      toast.success('Удалено', { description: 'Отменить можно кнопкой в Telegram.' })
    } catch (e) {
      toast.error('Не удалено', { description: msg(e) })
    } finally {
      setBusy(false)
      setConfirmDel(null)
    }
  }

  const toggleActive = async (c: DonCampaignAdmin): Promise<void> => {
    setBusy(true)
    try {
      apply(await adminCampSave({ id: c.id, active: !c.active }))
      toast.success(c.active ? 'Сбор завершён' : 'Сбор снова активен')
    } catch (e) {
      toast.error('Не изменено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const removeCamp = async (c: DonCampaignAdmin): Promise<void> => {
    setBusy(true)
    try {
      apply(await adminCampDelete(c.id))
      toast.success('Сбор удалён')
    } catch (e) {
      toast.error('Не удалено', { description: msg(e) })
    } finally {
      setBusy(false)
      setConfirmCamp(false)
    }
  }

  const activeN = data?.campaigns.filter((c) => c.active).length ?? 0
  const maxActive = data?.maxActive ?? 3

  const waitN = data?.claims.filter((c) => c.status === 'wait').length ?? 0
  const head = (
    <LzPanel className="p-4">
      <LzSectionHead
        title="Сбор пожертвований"
        hint="Записи добавляете вы сами (здесь или в боте: «💝 Пожертвования»). Цвет ника зависит от суммы вклада человека в сборе. Программы забирают данные при открытии «Поддержки», не чаще раза в 10 минут."
        sub={data ? `Сборов ${data.campaigns.length}, активных ${activeN} из ${maxActive}. Полоса и «стена благодарностей» — на странице «Поддержка».` : 'Полоса и «стена благодарностей» на странице «Поддержка»'}
        right={
          <Button size="sm" variant="outline" onClick={() => setCampDlg({ camp: null })} disabled={!data || busy}>
            <Plus /> Новый сбор
          </Button>
        }
      />
      {data && data.campaigns.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Сборы">
          {data.campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === sel}
              onClick={() => {
                setSel(c.id)
                setShown(LIST_STEP)
              }}
              className={cn(
                'inline-flex max-w-[18rem] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                c.id === sel ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground hover:text-foreground'
              )}
            >
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', c.active ? 'bg-primary' : 'bg-muted-foreground/50')} />
              <span className="truncate">{c.title}</span>
              <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{Math.round(c.pct)} %</span>
            </button>
          ))}
        </div>
      )}
    </LzPanel>
  )

  return (
    <div className="flex flex-col gap-3" data-tour="admin-donations">
      {head}
      {!data ? (
        <LzPanel className="flex h-28 items-center justify-center text-[12px] text-muted-foreground">{loading ? <Loader2 className="size-4 animate-spin" /> : 'Нет данных'}</LzPanel>
      ) : !data.campaigns.length ? (
        <LzPanel className="p-4">
          <EmptyState
            icon={<HandHeart />}
            title="Сборов пока нет"
            text="Создайте сбор: название и цель. Он появится на странице «Поддержка» у всех, а вы будете дописывать, кто и сколько поддержал."
            action={
              <Button size="sm" onClick={() => setCampDlg({ camp: null })}>
                <Plus /> Создать сбор
              </Button>
            }
          />
        </LzPanel>
      ) : (
        <>
          {camp && (
            <CampaignCard
              camp={camp}
              levels={levels}
              actions={
                <>
                  <Button size="xs" variant="ghost" onClick={() => setCampDlg({ camp })} disabled={busy}>
                    <Pencil /> Изменить
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void toggleActive(camp)}
                    disabled={busy || (!camp.active && activeN >= maxActive)}
                    title={!camp.active && activeN >= maxActive ? `Уже ${maxActive} активных — завершите один` : undefined}
                  >
                    {camp.active ? <Square /> : <Play />} {camp.active ? 'Завершить' : 'Сделать активным'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmCamp(true)} disabled={busy} className="hover:text-st-err-text">
                    <Trash2 /> Удалить
                  </Button>
                </>
              }
            />
          )}

          <LzPanel className="space-y-4 p-4">
          <AdminTabs<Tab>
            label="Сбор пожертвований"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'list', label: 'Пожертвования', icon: HandHeart },
              ...(data.hasClaims ? [{ id: 'claims' as const, label: 'Заявки', icon: Inbox, badge: waitN }] : []),
              { id: 'styles', label: 'Стили ников', icon: Sparkles },
              { id: 'levels', label: 'Уровни цвета', icon: Palette }
            ]}
          />

          {tab === 'claims' && <ClaimsPanel data={data} onSaved={apply} />}
          {tab === 'styles' && <StylesPanel data={data} onSaved={apply} />}
          {tab === 'levels' && (
            <div className="space-y-2" data-tour="admin-donations-levels">
              <p className="text-[12px] text-muted-foreground">Цвет ника на «стене» зависит от суммы вклада. Свой цвет — кнопкой с кружком или кодом #rrggbb.</p>
              <LevelsEditor data={data} onSaved={apply} />
            </div>
          )}

          {camp && tab === 'list' && (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {/* Добавить */}
              <div className={cn(insetClass, 'space-y-3 p-3.5')}>
                <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Plus className="size-4 text-primary" /> Добавить пожертвование
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2.5">
                  <Field label="Ник">
                    <input className={inputClass} value={nick} onChange={(e) => setNick(e.target.value.slice(0, 32))} placeholder="Как подписать" onKeyDown={(e) => e.key === 'Enter' && canAdd && void add()} />
                  </Field>
                  <Field label={`Сумма, ${camp.cur}`} error={amount && a === null ? 'Число > 0' : null}>
                    <input className={cn(inputClass, 'font-mono')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.slice(0, 14))} placeholder="500" onKeyDown={(e) => e.key === 'Enter' && canAdd && void add()} />
                  </Field>
                </div>
                <Field label="Комментарий" optional help="Виден только вам.">
                  <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Например: СБП, за стрим" />
                </Field>
                <Field label="Когда" help="Пусто — сейчас.">
                  <input type="datetime-local" className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} />
                </Field>
                <div className="flex items-center gap-2 border-t border-foreground/[0.07] pt-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[11px] text-muted-foreground">Так будет на «стене»</div>
                    <DonorChip nick={nick.trim() || 'Ник'} levels={levels} level={levelOf(levels, a ?? 0)} title="Предпросмотр" st={styleMap.get(nick.trim().toLowerCase())} />
                  </div>
                  <Button onClick={() => void add()} disabled={!canAdd}>
                    {busy ? <Loader2 className="animate-spin" /> : <Plus />} Добавить
                  </Button>
                </div>
              </div>

              {/* Список */}
              <div className="min-w-0 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input className={cn(inputClass, 'h-8 pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по нику и комментарию" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArrowDownWideNarrow className="size-3.5 text-muted-foreground" />
                    <Segmented<Sort>
                      label="Сортировка"
                      size="xs"
                      value={sort}
                      onChange={setSort}
                      items={[
                        ['new', 'Новые'],
                        ['old', 'Старые'],
                        ['big', 'Больше'],
                        ['small', 'Меньше']
                      ]}
                    />
                  </div>
                </div>
                {list.length ? (
                  <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
                    {list.slice(0, shown).map((d) => (
                      <div key={d.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-foreground/[0.03]">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <DonorChip nick={d.nick} levels={levels} level={d.level} size="sm" className="max-w-[60%]" st={styleMap.get(d.nick.toLowerCase())} />
                            <span className="shrink-0 text-[13px] font-bold tabular-nums">{money(d.amount, camp.cur)}</span>
                          </div>
                          <div className="mt-0.5 flex min-w-0 gap-2 text-[11px] text-muted-foreground">
                            <span className="shrink-0">{fmtDate(d.at)}</span>
                            {d.note && <span className="truncate italic">{d.note}</span>}
                          </div>
                        </div>
                        {confirmDel === d.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button size="xs" variant="destructive" onClick={() => void del(d.id)} disabled={busy}>
                              Удалить
                            </Button>
                            <Button size="icon-xs" variant="ghost" onClick={() => setConfirmDel(null)} aria-label="Не удалять">
                              <X />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                            <Button size="icon-xs" variant="ghost" onClick={() => setEdit(d)} disabled={busy} aria-label="Изменить" title="Изменить">
                              <Pencil />
                            </Button>
                            <Button size="icon-xs" variant="ghost" onClick={() => setConfirmDel(d.id)} disabled={busy} aria-label="Удалить" title="Удалить">
                              <Trash2 />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-foreground/15 text-[12px] text-muted-foreground">
                    {q ? 'Ничего не нашлось' : 'В этом сборе пока нет записей'}
                  </div>
                )}
                {list.length > shown && (
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => setShown((s) => s + LIST_STEP)}>
                    Показать ещё {Math.min(LIST_STEP, list.length - shown)} из {list.length - shown}
                  </Button>
                )}
              </div>
            </div>
          )}

          </LzPanel>
        </>
      )}

      <CampaignDialog open={Boolean(campDlg)} camp={campDlg?.camp ?? null} defaultLink={data?.defaultLink ?? ''} onClose={() => setCampDlg(null)} onSaved={apply} />
      {data && <DonationDialog item={edit} data={data} onClose={() => setEdit(null)} onSaved={apply} />}
      <HubModal
        open={confirmCamp && Boolean(camp)}
        onClose={() => setConfirmCamp(false)}
        locked={busy}
        icon={Trash2}
        title="Удалить сбор?"
        subtitle={camp?.title}
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCamp(false)} disabled={busy}>
              Нет
            </Button>
            <Button variant="destructive" onClick={() => camp && void removeCamp(camp)} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Удалить со всеми записями
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">
          Сбор и все его записи ({camp?.count ?? 0}) пропадут, вернуть их будет нельзя. Если сбор просто закончился — лучше «Завершить»: он останется в списке.
        </p>
      </HubModal>
    </div>
  )
}
