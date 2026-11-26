import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck, Clock, FileText, Loader2, PenLine, Plus, RefreshCw, Save, Send, ShieldAlert, Trash2, TriangleAlert, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import {
  adminTemplates,
  adminTemplatesSave,
  adminWarn,
  adminWarns,
  TPL_USE_RU,
  type AdminTemplate,
  type AdminWarn,
  type TplUse
} from '@renderer/utils/hub-admin-api'
import { AdminSection, AdminTabs, Field, Segmented, SubLabel, inputClass, insetClass } from './admin-section'
import { textareaClass } from './modal'
import { WarnCard } from './warn-banner'
import { Empty } from './admin-claims'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fmtDate = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export type WarnTab = 'warn' | 'list' | 'tpl'
type Tab = WarnTab
type Lvl = 'yellow' | 'red'

/** Добавить кусок текста в черновик с новой строки. */
const append = (draft: string, add: string): string => (draft.trim() ? `${draft.trimEnd()}\n${add}` : add)

/** Кнопки шаблонов: нажатие добавляет текст в черновик. */
const TemplateButtons: React.FC<{ list: AdminTemplate[]; sign: string; onAdd: (t: string) => void }> = ({ list, sign, onAdd }) => (
  <div className="flex flex-wrap gap-1.5">
    {list.map((t) => (
      <button
        key={t.id}
        type="button"
        title={t.text}
        onClick={() => onAdd(t.text)}
        className="cursor-pointer rounded-lg border border-foreground/[0.1] bg-foreground/[0.03] px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        + {t.name}
      </button>
    ))}
    {sign && (
      <button
        type="button"
        title={sign}
        onClick={() => onAdd(sign)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-foreground/20 px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <PenLine className="size-3" /> Подпись
      </button>
    )}
  </div>
)

/** Редактор шаблонов и подписи: полная замена списка одной кнопкой «Сохранить». */
const TemplatesEditor: React.FC<{ templates: AdminTemplate[]; sign: string; onSaved: (t: AdminTemplate[], sign: string) => void }> = ({ templates, sign, onSaved }) => {
  const [rows, setRows] = useState(templates)
  const [sg, setSg] = useState(sign)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setRows(templates)
    setSg(sign)
  }, [templates, sign])
  const dirty = JSON.stringify(rows) !== JSON.stringify(templates) || sg !== sign
  const valid = rows.every((r) => r.name.trim() && r.text.trim())
  const setRow = (i: number, p: Partial<AdminTemplate>): void => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await adminTemplatesSave(
        rows.map((x) => ({ ...x, name: x.name.trim(), text: x.text.trim() })),
        sg.trim()
      )
      onSaved(r.templates, r.sign)
      toast.success('Шаблоны сохранены', { description: 'Они же появятся в боте.' })
    } catch (e) {
      toast.error('Не сохранено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2.5" data-tour="admin-templates">
      <Field label="Подпись" help="Кнопка «Подпись» добавляет её в конец сообщения.">
        <input className={inputClass} value={sg} onChange={(e) => setSg(e.target.value.slice(0, 120))} placeholder="С уважением, администрация LAZEYKA" />
      </Field>
      {rows.map((r, i) => (
        <div key={r.id} className={cn(insetClass, 'space-y-2 p-2.5')}>
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(inputClass, 'h-8 min-w-40 flex-1')} value={r.name} onChange={(e) => setRow(i, { name: e.target.value.slice(0, 32) })} placeholder="Название" aria-label="Название шаблона" />
            <select className={cn(inputClass, 'h-8 w-44')} value={r.use} onChange={(e) => setRow(i, { use: e.target.value as TplUse })} aria-label="Где использовать">
              {(Object.keys(TPL_USE_RU) as TplUse[]).map((u) => (
                <option key={u} value={u}>
                  {TPL_USE_RU[u]}
                </option>
              ))}
            </select>
            <Button size="icon-xs" variant="ghost" className="hover:text-st-err-text" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Удалить шаблон" title="Удалить">
              <Trash2 />
            </Button>
          </div>
          <textarea className={cn(textareaClass, 'text-xs')} rows={2} value={r.text} onChange={(e) => setRow(i, { text: e.target.value.slice(0, 500) })} placeholder="Текст шаблона" />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length >= 30 || busy}
          onClick={() => setRows((rs) => [...rs, { id: `t${Date.now().toString(36)}`.slice(0, 12), name: '', text: '', use: 'any' }])}
        >
          <Plus /> Шаблон
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => (setRows(templates), setSg(sign))}>
            <X /> Отменить правки
          </Button>
        )}
        <Button size="sm" className="ml-auto" disabled={!dirty || !valid || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />} Сохранить шаблоны
        </Button>
      </div>
    </div>
  )
}

/**
 * «Предупреждения и шаблоны» в «Админке»: предупредить по коду установки (жёлтое или красное, с
 * кнопками шаблонов и предпросмотром как увидит человек), последние предупреждения с отметкой «прочитано»,
 * редактор шаблонов и подписи. Данные грузятся при открытии и по «Обновить».
 */
export const AdminWarnSection: React.FC<{
  /** Открытая вкладка (управляет страница: быстрые действия пульта). */
  tab?: WarnTab
  onTab?: (t: WarnTab) => void
  /** Последние предупреждения, если страница уже их загрузила (для пульта). */
  warns?: AdminWarn[] | null
  onWarns?: (w: AdminWarn[]) => void
}> = ({ tab: tabProp, onTab, warns: warnsProp, onWarns }) => {
  const [tabOwn, setTabOwn] = useState<Tab>('warn')
  const tab = tabProp ?? tabOwn
  const setTab = (t: Tab): void => {
    setTabOwn(t)
    onTab?.(t)
  }
  const [tpl, setTpl] = useState<{ templates: AdminTemplate[]; sign: string } | null>(null)
  const [warnsOwn, setWarnsOwn] = useState<AdminWarn[] | null>(warnsProp ?? null)
  const warns = warnsProp !== undefined && warnsProp !== null ? warnsProp : warnsOwn
  const setWarns = useCallback(
    (w: AdminWarn[]) => {
      setWarnsOwn(w)
      onWarns?.(w)
    },
    [onWarns]
  )
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [lvl, setLvl] = useState<Lvl>('yellow')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, w] = await Promise.allSettled([adminTemplates(), adminWarns()])
    if (t.status === 'fulfilled') setTpl(t.value)
    if (w.status === 'fulfilled') setWarns(w.value)
    const bad = [t, w].find((x) => x.status === 'rejected') as PromiseRejectedResult | undefined
    setErr(bad ? msg(bad.reason) : null)
    setLoading(false)
  }, [setWarns])
  useEffect(() => {
    void load()
    // Загрузить один раз при открытии раздела; дальше — кнопкой «Обновить».
  }, [])

  const forWarn = useMemo(() => (tpl?.templates ?? []).filter((t) => t.use === 'warn' || t.use === 'any'), [tpl])
  const cleanCode = code.toLowerCase().replace(/[^0-9a-f]/g, '')
  const codeOk = cleanCode.length >= 6 && cleanCode.length <= 32
  const canSend = codeOk && text.trim().length >= 2 && !busy
  const unread = warns?.filter((w) => !w.ack).length ?? 0
  const supported = Boolean(tpl || warns)

  const send = async (): Promise<void> => {
    setBusy(true)
    try {
      await adminWarn(cleanCode, lvl, text.trim())
      toast.success('Предупреждение отправлено', { description: 'Человек увидит плашку при следующей проверке уведомлений программой.' })
      setText('')
      setCode('')
      void adminWarns()
        .then(setWarns)
        .catch(() => undefined)
    } catch (e) {
      toast.error('Не отправлено', { description: msg(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminSection
      icon={TriangleAlert}
      title="Предупреждения и шаблоны"
      subtitle={warns ? `Последних ${warns.length}, не прочитано ${unread}` : loading ? 'Загружаю…' : undefined}
      hint="Предупреждение — личное сообщение установке: у человека вверху окна появляется жёлтая или красная плашка, пока он не нажмёт «Понятно». Блокировка (в боте) отключает только отправку отчётов, тем, идей и заявок. Код установки есть в сообщениях бота об отчётах и идеях."
      tour="admin-warn"
      right={
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Обновить" title="Обновить">
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      }
    >
      {!supported ? (
        <Empty icon={ShieldAlert} text={loading ? 'Загружаю…' : (err ?? 'Нет данных.')} />
      ) : (
        <div className="space-y-4">
          <AdminTabs<Tab>
            label="Предупреждения"
            value={tab}
            onChange={setTab}
            className="max-w-[520px]"
            items={[
              { id: 'warn', label: 'Предупредить', icon: Send },
              { id: 'list', label: 'Последние', icon: Clock, badge: unread },
              { id: 'tpl', label: 'Шаблоны', icon: FileText }
            ]}
          />

          {tab === 'warn' && (
            <div className="grid items-start gap-4 lg:grid-cols-2" data-tour="admin-warn-form">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label="Код установки" error={code && !codeOk ? 'От 6 до 32 знаков: цифры и буквы a–f' : null} help="Из сообщения бота об отчёте, идее, теме или заявке.">
                    <input className={cn(inputClass, 'font-mono')} value={code} onChange={(e) => setCode(e.target.value.slice(0, 40))} placeholder="a1b2c3" spellCheck={false} />
                  </Field>
                  <Field label="Уровень">
                    <Segmented<Lvl>
                      label="Уровень"
                      value={lvl}
                      onChange={setLvl}
                      items={[
                        ['yellow', '🟡 Жёлтое'],
                        ['red', '🔴 Красное']
                      ]}
                    />
                  </Field>
                </div>
                <Field label="Текст" help="Кнопки ниже добавляют текст шаблона в конец.">
                  <textarea className={cn(textareaClass, 'text-xs')} rows={5} value={text} onChange={(e) => setText(e.target.value.slice(0, 1500))} placeholder="Например: в отчётах не нужно присылать рекламу." />
                </Field>
                <TemplateButtons list={forWarn} sign={tpl?.sign ?? ''} onAdd={(t) => setText((d) => append(d, t).slice(0, 1500))} />
                <div className="flex justify-end">
                  <Button onClick={() => void send()} disabled={!canSend}>
                    {busy ? <Loader2 className="animate-spin" /> : <Send />} Отправить предупреждение
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <SubLabel>Так увидит человек</SubLabel>
                <WarnCard kind="warn" lvl={lvl} text={text.trim() || 'Текст предупреждения'} at={Date.now()} onAck={() => undefined} />
                <p className="text-[11px] leading-snug text-muted-foreground">Плашка вверху окна над любым разделом. После «Понятно» она уходит, а здесь появится отметка «прочитано».</p>
              </div>
            </div>
          )}

          {tab === 'list' &&
            (warns?.length ? (
              <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">
                {warns.map((w) => (
                  <div key={w.id} className="relative flex items-start gap-3 px-3.5 py-2.5">
                    <span aria-hidden className={cn('absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full', w.lvl === 'yellow' && w.kind === 'warn' ? 'bg-st-warn' : 'bg-st-err')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-muted-foreground">
                        <span className="font-mono text-foreground/80">{w.install || '—'}</span>
                        <span>{w.kind === 'ban' ? 'блокировка' : w.lvl === 'yellow' ? 'жёлтое' : 'красное'}</span>
                        <span>{fmtDate(w.at)}</span>
                        <span className={cn('ml-auto inline-flex items-center gap-1', w.ack ? 'text-st-ok-text' : 'text-st-warn-text')}>
                          {w.ack ? <CheckCheck className="size-3" /> : <Clock className="size-3" />}
                          {w.ack ? `прочитано ${fmtDate(w.ack)}` : 'не прочитано'}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12.5px] leading-snug">{w.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon={ShieldAlert} text="Предупреждений пока не было." />
            ))}

          {tab === 'tpl' && tpl && <TemplatesEditor templates={tpl.templates} sign={tpl.sign} onSaved={(templates, sign) => setTpl({ templates, sign })} />}
        </div>
      )}
    </AdminSection>
  )
}
