import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Globe, Info, Loader2, Plus, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import {
  adminDnsMarkRemove,
  adminDnsMarkRestore,
  adminDnsPlan,
  adminDnsPublishPlan,
  adminDnsStageAddition,
  adminDnsUnmark,
  type DnsAddrs,
  type DnsPlan
} from '@renderer/utils/hub-admin-api'
import { onDnsCatalogChanged } from '@renderer/utils/dns-catalog-api'
import { HubModal } from './modal'
import { useAuthorState } from './use-author'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const Addrs: React.FC<{ a: DnsAddrs; other: DnsAddrs }> = ({ a, other }) => {
  const line = (label: string, v: string, o: string): React.JSX.Element => (
    <div className={cn('truncate', v !== o && 'font-semibold text-foreground')} title={v || '—'}>
      <span className="text-muted-foreground">{label}: </span>
      {v || '—'}
    </div>
  )
  return (
    <div className="min-w-0 flex-1 space-y-0.5 font-mono text-[11px]">
      {line('IPv4', a.ipv4.join(', '), other.ipv4.join(', '))}
      {line('IPv6', a.ipv6.join(', '), other.ipv6.join(', '))}
      {line('DoH', a.doh ? `${a.doh}${a.dohOnly ? ' (только)' : ''}` : '', other.doh ? `${other.doh}${other.dohOnly ? ' (только)' : ''}` : '')}
    </div>
  )
}

const EMPTY: DnsPlan = { add: [], available: [], edits: [], remove: [], restore: [], removed: [] }
const splitList = (value: string): string[] => value.split(/[\s,;]+/).filter(Boolean)

const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }> = ({ checked, onChange, children }) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
    <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="size-4 cursor-pointer accent-[var(--primary)]" />
    {children}
  </label>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</div>
    {children}
  </div>
)

/**
 * Панель автора на странице DNS: «Опубликовать правки DNS» — изменённые адреса встроенных
 * записей, отметки «убрать у всех» и «вернуть». Видна только при привязке режима автора;
 * без неё ничего не показывает и в сеть не ходит. Правки берутся локальные, после
 * публикации они снимаются — теперь они в общем каталоге.
 */
export function AdminDnsBar(): React.JSX.Element | null {
  const st = useAuthorState()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removeId, setRemoveId] = useState('')
  const [removeReason, setRemoveReason] = useState('')
  const [plan, setPlan] = useState<DnsPlan>(EMPTY)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const paired = Boolean(st?.paired)

  const load = useCallback(async (): Promise<DnsPlan> => {
    const p = await adminDnsPlan().catch(() => EMPTY)
    setPlan(p)
    return p
  }, [])

  // Отметки ставятся из строк списка — перечитываем план по событию «каталог/отметки изменились».
  useEffect(() => {
    if (!paired) return
    void load()
    return onDnsCatalogChanged(() => void load())
  }, [paired, load])

  if (!paired) return null

  const allKeys = (p: DnsPlan): Set<string> =>
    new Set([...p.add.map((p) => 'a:' + p.id), ...p.edits.map((e) => 'e:' + e.id), ...p.remove.map((x) => 'r:' + x.id), ...p.restore.map((x) => 'b:' + x.id)])

  const start = async (): Promise<void> => {
    try {
      const p = await adminDnsPlan()
      setPlan(p)
      setPicked(allKeys(p))
      setOpen(true)
    } catch (e) {
      toast.error('Не удалось собрать правки', { description: msg(e) })
    }
  }

  const toggle = (key: string, on: boolean): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })

  const act = async (fn: () => Promise<DnsPlan>, key: string, select: boolean): Promise<void> => {
    if (busy || saving) return
    setSaving(true)
    try {
      const p = await fn()
      setPlan(p)
      toggle(key, select)
    } catch (e) {
      toast.error('Не получилось', { description: msg(e) })
    } finally {
      setSaving(false)
    }
  }

  const addDraft = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving) return
    const form = new FormData(event.currentTarget)
    const get = (key: string): string => String(form.get(key) ?? '').trim()
    setSaving(true)
    try {
      const p = await adminDnsStageAddition({
        id: get('id'), name: get('name'), description: get('description'),
        ipv4: splitList(get('ipv4')), ipv6: splitList(get('ipv6')),
        doh: get('doh'), dohOnly: form.has('dohOnly'), tags: splitList(get('tags')), site: get('site')
      })
      setPlan(p)
      setAdding(false)
      setPicked(allKeys(p))
      setOpen(true)
    } catch (e) {
      toast.error('Не удалось добавить DNS', { description: msg(e) })
    } finally {
      setSaving(false)
    }
  }

  const publish = async (): Promise<void> => {
    setBusy(true)
    const ids = (prefix: string): string[] => [...picked].filter((k) => k.startsWith(prefix)).map((k) => k.slice(2))
    try {
      const r = await adminDnsPublishPlan({ add: ids('a:'), edits: ids('e:'), remove: ids('r:'), restore: ids('b:') })
      toast.success(`Каталог DNS опубликован (версия ${r.version})`, { description: 'Программы получат его при запуске (не чаще раза в 6 часов) или по «Обновить список».' })
      setOpen(false)
      void load()
    } catch (e) {
      toast.error('Не опубликовано', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const selected = [...allKeys(plan)].some((key) => picked.has(key))
  const restoreMarked = new Set(plan.restore.map((x) => x.id))
  const summary = [
    plan.add.length ? `добавить: ${plan.add.length}` : '',
    plan.edits.length ? `правок: ${plan.edits.length}` : '',
    plan.remove.length ? `убрать: ${plan.remove.length}` : '',
    plan.restore.length ? `вернуть: ${plan.restore.length}` : ''
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3" data-tour="admin-dns-bar">
      <Globe className="size-4 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Панель автора</div>
        <div className="text-[11px] text-muted-foreground">
          {summary ? `Готово к публикации: ${summary}.` : 'Общий каталог DNS для пользователей LAZEYKA.'}
          {plan.removed.length > 0 && ` Убрано у всех: ${plan.removed.length}.`}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
        <Plus /> Добавить DNS
      </Button>
      <Button size="sm" onClick={() => void start()}>
        <Send /> Управление каталогом
      </Button>

      <HubModal
        open={adding}
        onClose={() => setAdding(false)}
        locked={saving}
        title="Добавить DNS в общий каталог"
        icon={Globe}
        footer={<Button type="submit" form="admin-dns-add" disabled={saving}>Сохранить черновик</Button>}
      >
        <form id="admin-dns-add" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void addDraft(e)}>
          <label className="space-y-1 text-sm">Название<Input name="name" required maxLength={60} /></label>
          <label className="space-y-1 text-sm">ID<Input name="id" required pattern="[a-z0-9][a-z0-9\-]{1,31}" placeholder="my-dns" /></label>
          <label className="space-y-1 text-sm">IPv4<Input name="ipv4" required placeholder="1–2 публичных адреса" /></label>
          <label className="space-y-1 text-sm">IPv6<Input name="ipv6" placeholder="До двух публичных адресов" /></label>
          <label className="space-y-1 text-sm">DoH<Input name="doh" placeholder="https://…/dns-query" maxLength={200} /></label>
          <label className="space-y-1 text-sm">Сайт<Input name="site" type="url" maxLength={200} /></label>
          <label className="space-y-1 text-sm sm:col-span-2">Описание<Input name="description" maxLength={240} /></label>
          <label className="space-y-1 text-sm">Метки<Input name="tags" placeholder="Через запятую" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dohOnly" /> Только DoH</label>
        </form>
      </HubModal>

      <HubModal
        open={open}
        onClose={() => setOpen(false)}
        locked={busy || saving}
        icon={Globe}
        title="Опубликовать правки DNS"
        subtitle="Отмеченное попадёт в каталог для всех."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy || saving}>
              Отмена
            </Button>
            <Button onClick={() => void publish()} disabled={busy || saving || !selected}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} Опубликовать всем
            </Button>
          </>
        }
      >
        {plan.available.length > 0 && (
          <Section title="Убрать DNS из каталога">
            <select aria-label="DNS для удаления" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={removeId} onChange={(e) => setRemoveId(e.target.value)}>
              <option value="">Выберите DNS</option>
              {plan.available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {removeId && plan.available.some((p) => p.id === removeId) && (
              <div className="flex flex-wrap gap-2">
                <Input className="min-w-32 flex-1" aria-label="Причина удаления" placeholder="Причина (необязательно)" value={removeReason} maxLength={200} onChange={(e) => setRemoveReason(e.target.value)} />
                <Button size="sm" variant="outline" disabled={busy || saving} onClick={() => void act(() => adminDnsMarkRemove(removeId, removeReason), 'r:' + removeId, true)}>
                  Отметить удаление
                </Button>
              </div>
            )}
          </Section>
        )}
        {plan.add.length > 0 && (
          <Section title="Будут добавлены">
            {plan.add.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <Check checked={picked.has('a:' + p.id)} onChange={(v) => toggle('a:' + p.id, v)}>{p.name} ({p.id})</Check>
                  <Addrs a={p} other={p} />
                </div>
                <Button size="sm" variant="ghost" disabled={busy || saving} onClick={() => void act(() => adminDnsUnmark(p.id), 'a:' + p.id, false)}>
                  Удалить черновик
                </Button>
              </div>
            ))}
          </Section>
        )}
        {plan.edits.length > 0 && (
          <Section title="Изменятся адреса">
            <ul className="space-y-2">
              {plan.edits.map((e) => (
                <li key={e.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                  <div className="mb-2">
                    <Check checked={picked.has('e:' + e.id)} onChange={(v) => toggle('e:' + e.id, v)}>
                      {e.name}
                    </Check>
                  </div>
                  <div className="flex items-start gap-2">
                    <Addrs a={e.before} other={e.after} />
                    <ArrowRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
                    <Addrs a={e.after} other={e.before} />
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {plan.remove.length > 0 && (
          <Section title="Будут убраны у всех">
            <ul className="space-y-2">
              {plan.remove.map((x) => (
                <li key={x.id} className="flex items-start gap-2 rounded-lg border border-st-err/30 bg-st-err/5 p-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Check checked={picked.has('r:' + x.id)} onChange={(v) => toggle('r:' + x.id, v)}>
                      <Trash2 className="size-3.5 text-st-err-text" /> {x.name}
                    </Check>
                    <div className="pl-6 text-[11px] text-muted-foreground">{x.reason ? `Причина: ${x.reason}` : 'Без причины'}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-xs" disabled={busy || saving} onClick={() => void act(() => adminDnsUnmark(x.id), 'r:' + x.id, false)}>
                    Снять отметку
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {plan.restore.length > 0 && (
          <Section title="Будут возвращены">
            <ul className="space-y-2">
              {plan.restore.map((x) => (
                <li key={x.id} className="flex items-center gap-2 rounded-lg border border-st-ok/30 bg-st-ok/5 p-3">
                  <div className="min-w-0 flex-1">
                    <Check checked={picked.has('b:' + x.id)} onChange={(v) => toggle('b:' + x.id, v)}>
                      <Undo2 className="size-3.5 text-st-ok-text" /> {x.name}
                    </Check>
                  </div>
                  <Button size="sm" variant="ghost" className="text-xs" disabled={busy || saving} onClick={() => void act(() => adminDnsUnmark(x.id), 'b:' + x.id, false)}>
                    Снять отметку
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {plan.removed.some((r) => !restoreMarked.has(r.id)) && (
          <Section title="Сейчас убраны у всех">
            <ul className="space-y-1.5">
              {plan.removed
                .filter((r) => !restoreMarked.has(r.id))
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{r.reason ? `Причина: ${r.reason}` : 'Без причины'}</div>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs" disabled={busy || saving} onClick={() => void act(() => adminDnsMarkRestore(r.id), 'b:' + r.id, true)}>
                      <RotateCcw className="size-3.5" /> Вернуть
                    </Button>
                  </li>
                ))}
            </ul>
          </Section>
        )}
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            После публикации локальные правки адресов снимаются: те же адреса придут из общего каталога. У кого убранный DNS включён, программа его не выключает, а показывает плашку с выбором. О публикации придёт сообщение в Telegram с кнопкой отмены.
          </p>
        </div>
      </HubModal>
    </div>
  )
}
