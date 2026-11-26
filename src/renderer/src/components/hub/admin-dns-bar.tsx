import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Globe, Info, Loader2, PencilLine, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  adminDnsMarkRestore,
  adminDnsPlan,
  adminDnsPublishPlan,
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

const EMPTY: DnsPlan = { edits: [], remove: [], restore: [], removed: [] }

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
    new Set([...p.edits.map((e) => 'e:' + e.id), ...p.remove.map((x) => 'r:' + x.id), ...p.restore.map((x) => 'b:' + x.id)])

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

  const act = async (fn: () => Promise<DnsPlan>, key?: string): Promise<void> => {
    try {
      const p = await fn()
      setPlan(p)
      if (key) setPicked((s) => new Set([...s, key]))
    } catch (e) {
      toast.error('Не получилось', { description: msg(e) })
    }
  }

  const publish = async (): Promise<void> => {
    setBusy(true)
    const ids = (prefix: string): string[] => [...picked].filter((k) => k.startsWith(prefix)).map((k) => k.slice(2))
    try {
      const r = await adminDnsPublishPlan({ edits: ids('e:'), remove: ids('r:'), restore: ids('b:') })
      toast.success(`Каталог DNS опубликован (версия ${r.version})`, { description: 'Программы получат его при запуске (не чаще раза в 6 часов) или по «Обновить список».' })
      setOpen(false)
      void load()
    } catch (e) {
      toast.error('Не опубликовано', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  const pending = plan.edits.length + plan.remove.length + plan.restore.length
  const nothing = pending === 0
  const restoreMarked = new Set(plan.restore.map((x) => x.id))
  const summary = [
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
          {summary ? `Готово к публикации: ${summary}.` : 'Правки адресов и отметки «Убрать у всех» (меню «⋯» у записи) можно опубликовать для всех.'}
          {plan.removed.length > 0 && ` Убрано у всех: ${plan.removed.length}.`}
        </div>
      </div>
      <Button size="sm" onClick={() => void start()}>
        <Send /> Опубликовать правки DNS
      </Button>

      <HubModal
        open={open}
        onClose={() => !busy && setOpen(false)}
        locked={busy}
        icon={Globe}
        title="Опубликовать правки DNS"
        subtitle="Отмеченное попадёт в каталог для всех."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button onClick={() => void publish()} disabled={busy || picked.size === 0 || nothing}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} Опубликовать всем
            </Button>
          </>
        }
      >
        {nothing && (
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border/70 bg-card/30 p-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <PencilLine className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">Пока нечего публиковать</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Измените адреса встроенного DNS (значок карандаша у записи) или отметьте запись «Убрать у всех» в меню «⋯», затем вернитесь сюда.
              </p>
            </div>
          </div>
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
                  <Button size="sm" variant="ghost" className="text-xs" title="Снять отметку: запись останется в программе" onClick={() => void act(() => adminDnsUnmark(x.id))}>
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
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => void act(() => adminDnsUnmark(x.id))}>
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
                    <Button size="sm" variant="outline" className="text-xs" title="Отметить «вернуть»: запись снова появится у всех после публикации" onClick={() => void act(() => adminDnsMarkRestore(r.id), 'b:' + r.id)}>
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
