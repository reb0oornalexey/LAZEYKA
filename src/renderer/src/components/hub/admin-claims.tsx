import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, CheckCircle2, Clock, HandCoins, Loader2, Pencil, X, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { adminClaimDecide, levelOf, money, type DonationsAdmin, type DonClaimAdmin } from '@renderer/utils/hub-donations-api'
import { adminTemplates, type AdminTemplate } from '@renderer/utils/hub-admin-api'
import { DonorChip } from './donation-ui'
import { Field, inputClass } from './admin-section'
import { HubModal, textareaClass } from './modal'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fmtDate = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const parseAmount = (s: string): number | null => {
  const t = s.replace(/[\s\u00a0₽$€₸]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 100_000_000 ? n : null
}

/** Шаблоны причин отказа загружаются один раз за открытие «Админки». */
let tplCache: Promise<AdminTemplate[]> | null = null
const loadReasons = (): Promise<AdminTemplate[]> => {
  tplCache ??= adminTemplates()
    .then((r) => r.templates.filter((t) => t.use === 'don_no' || t.use === 'any'))
    .catch(() => {
      tplCache = null
      return []
    })
  return tplCache
}

type Act = { claim: DonClaimAdmin; mode: 'amount' | 'reject' } | null

/**
 * «Заявки» в сборе: люди нажали «Я отправил пожертвование». Ожидающие сверху; «Подтвердить» добавляет
 * запись в сбор и отвечает человеку, «Другая сумма» — подтверждает с исправленной суммой, «Отклонить» —
 * ответ с причиной (шаблоны). Владельцу в Telegram приходит сообщение с кнопкой отмены.
 */
export const ClaimsPanel: React.FC<{ data: DonationsAdmin; onSaved: (d: DonationsAdmin) => void }> = ({ data, onSaved }) => {
  const [busy, setBusy] = useState<number | null>(null)
  const [act, setAct] = useState<Act>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [reasons, setReasons] = useState<AdminTemplate[]>([])
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    if (act?.mode === 'reject') void loadReasons().then(setReasons)
  }, [act])

  const list = useMemo(() => {
    const w = data.claims.filter((c) => c.status === 'wait').sort((a, b) => a.at - b.at)
    const d = data.claims.filter((c) => c.status !== 'wait').sort((a, b) => b.at - a.at)
    return { wait: w, done: d }
  }, [data.claims])

  const camp = (id: number): { title: string; cur: string } => {
    const c = data.campaigns.find((x) => x.id === id)
    return { title: c?.title ?? 'сбор удалён', cur: c?.cur ?? '₽' }
  }

  const decide = async (c: DonClaimAdmin, action: 'ok' | 'no', extra?: { amount?: number; reason?: string }): Promise<void> => {
    setBusy(c.id)
    try {
      onSaved(await adminClaimDecide(c.id, action, extra))
      toast.success(action === 'ok' ? 'Подтверждено' : 'Отклонено', {
        description: action === 'ok' ? `${c.nick} добавлен на стену. Человеку ушёл ответ.` : 'Человеку ушёл ответ с причиной.'
      })
      setAct(null)
    } catch (e) {
      toast.error('Не выполнено', { description: msg(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!data.hasClaims) {
    return <Empty text="Hub ещё не принимает заявки: обновите сервер — после этого здесь появятся заявки «Я отправил пожертвование»." />
  }

  const row = (c: DonClaimAdmin): React.ReactNode => {
    const { title, cur } = camp(c.camp)
    const wait = c.status === 'wait'
    return (
      <div key={c.id} className={cn('relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3', wait ? 'bg-st-warn/[0.04]' : '')}>
        {wait && <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-st-warn" />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <DonorChip nick={c.nick} levels={data.levels} level={levelOf(data.levels, c.amount)} size="sm" className="max-w-[50%]" />
            <span className="shrink-0 text-[15px] font-extrabold tabular-nums">{money(c.amount, cur)}</span>
            {c.method && <span className="truncate text-[11px] text-muted-foreground">через {c.method}</span>}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap gap-x-2.5 text-[11px] text-muted-foreground">
            <span>{fmtDate(c.at)}</span>
            <span className="truncate">«{title}»</span>
            {c.install && <span className="font-mono">уст. {c.install}</span>}
            {c.note && <span className="w-full truncate italic text-foreground/70">{c.note}</span>}
          </div>
        </div>
        {wait ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button size="xs" onClick={() => void decide(c, 'ok')} disabled={busy !== null}>
              {busy === c.id ? <Loader2 className="animate-spin" /> : <Check />} Подтвердить
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setAmount(String(c.amount))
                setAct({ claim: c, mode: 'amount' })
              }}
              disabled={busy !== null}
            >
              <Pencil /> Другая сумма
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="hover:text-st-err-text"
              onClick={() => {
                setReason('')
                setAct({ claim: c, mode: 'reject' })
              }}
              disabled={busy !== null}
            >
              <X /> Отклонить
            </Button>
          </div>
        ) : (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', c.status === 'ok' ? 'bg-st-ok/15 text-st-ok-text' : 'bg-st-err/12 text-st-err-text')}>
            {c.status === 'ok' ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
            {c.status === 'ok' ? 'подтверждена' : 'отклонена'}
          </span>
        )}
      </div>
    )
  }

  const a = parseAmount(amount)
  const cur = act ? camp(act.claim.camp).cur : '₽'
  return (
    <div className="space-y-3" data-tour="admin-don-claims">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className={cn('size-3.5', list.wait.length ? 'text-st-warn-text' : '')} /> На проверке: <b className="tabular-nums text-foreground">{list.wait.length}</b>
        </span>
        <span className="ml-auto text-[11.5px]">Решать можно и в боте — кнопки под сообщением о заявке.</span>
      </div>
      {list.wait.length ? (
        <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-st-warn/30">{list.wait.map(row)}</div>
      ) : (
        <Empty text="Новых заявок нет. Они появятся, когда кто-то нажмёт «Я отправил пожертвование» в «Поддержке»." />
      )}
      {list.done.length > 0 && (
        <div className="space-y-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="cursor-pointer text-xs text-primary hover:underline">
            {showDone ? 'Скрыть решённые' : `Решённые (${list.done.length})`}
          </button>
          {showDone && <div className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl border border-foreground/[0.08]">{list.done.map(row)}</div>}
        </div>
      )}

      <HubModal
        open={Boolean(act)}
        onClose={() => setAct(null)}
        locked={busy !== null}
        icon={act?.mode === 'amount' ? Pencil : X}
        title={act?.mode === 'amount' ? 'Подтвердить с другой суммой' : 'Отклонить заявку'}
        subtitle={act ? `${act.claim.nick} — ${money(act.claim.amount, cur)}` : undefined}
        className="max-w-md"
        footer={
          act && (
            <>
              <Button variant="ghost" onClick={() => setAct(null)} disabled={busy !== null}>
                Отмена
              </Button>
              {act.mode === 'amount' ? (
                <Button onClick={() => a !== null && void decide(act.claim, 'ok', { amount: a })} disabled={a === null || busy !== null}>
                  {busy !== null ? <Loader2 className="animate-spin" /> : <Check />} Подтвердить {a !== null ? money(a, cur) : ''}
                </Button>
              ) : (
                <Button variant="destructive" onClick={() => void decide(act.claim, 'no', { reason: reason.trim() })} disabled={busy !== null}>
                  {busy !== null ? <Loader2 className="animate-spin" /> : <X />} {reason.trim() ? 'Отклонить с причиной' : 'Отклонить без причины'}
                </Button>
              )}
            </>
          )
        }
      >
        {act?.mode === 'amount' ? (
          <Field label={`Сумма, ${cur}`} error={amount && a === null ? 'Число больше нуля' : null} help="Если пришло не столько, сколько указал человек. На стену попадёт эта сумма.">
            <input className={cn(inputClass, 'font-mono')} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.slice(0, 14))} />
          </Field>
        ) : (
          <>
            {reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {reasons.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setReason((r) => (r.trim() ? `${r.trim()}\n${t.text}` : t.text))}
                    className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    title={t.text}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            )}
            <Field label="Причина" optional help="Её увидит человек в уведомлении. Кнопки выше добавляют текст шаблона.">
              <textarea className={cn(textareaClass, 'text-xs')} rows={3} value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="Например: перевод с такими данными не найден" />
            </Field>
          </>
        )}
      </HubModal>
    </div>
  )
}

export const Empty: React.FC<{ text: string; icon?: React.ComponentType<{ className?: string }> }> = ({ text, icon: Icon = HandCoins }) => (
  <div className="flex flex-col items-center gap-2 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-6 text-center">
    <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-foreground/20 text-muted-foreground">
      <Icon className="size-4" />
    </span>
    <p className="max-w-[46ch] text-[12px] leading-snug text-muted-foreground">{text}</p>
  </div>
)
