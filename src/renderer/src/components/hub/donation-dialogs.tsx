import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Clock, ExternalLink, HandCoins, Heart, Info, Loader2, Send, X, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { openExternalUrl } from '@renderer/utils/ipc'
import { useHubStore } from '@renderer/store/hub-store'
import { donClaim, donClaimForget, money, type DonCampaignPublic, type DonMethod, type LocalClaim } from '@renderer/utils/hub-donations-api'
import { Field, inputClass } from './admin-section'
import { HubModal } from './modal'
import { MethodIcon } from './pay-icons'

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

const fmtDate = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Сумма из поля: «1 500», «99,5». */
const parseAmount = (s: string): number | null => {
  const t = s.replace(/[\s\u00a0₽$€₸]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 100_000_000 ? n : null
}

/** Открыть ссылку способа оплаты в браузере. */
export function openMethod(m: DonMethod): void {
  openExternalUrl(m.url).catch((e) => toast.error('Не удалось открыть ссылку', { description: e instanceof Error ? e.message : String(e) }))
}

/** Плитка способа: значок, название, адрес. */
export const MethodTile: React.FC<{ m: DonMethod; onClick: () => void; active?: boolean; trailing?: React.ReactNode }> = ({ m, onClick, active, trailing }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
      active ? 'border-primary/70 bg-primary/10' : 'border-border bg-card/40 hover:border-primary/50 hover:bg-card'
    )}
  >
    <MethodIcon icon={m.icon} className="size-7" />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{m.name}</span>
      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{hostOf(m.url)}</span>
    </span>
    {trailing ?? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />}
  </button>
)

/** Выбор способа оплаты, когда их несколько. */
export const MethodPickerDialog: React.FC<{ camp: DonCampaignPublic | null; onClose: () => void; onClaim?: () => void }> = ({ camp, onClose, onClaim }) => (
  <HubModal
    open={Boolean(camp)}
    onClose={onClose}
    icon={Heart}
    title="Как поддержать"
    subtitle="Выберите удобный способ — ссылка откроется в браузере"
    className="max-w-md"
    footer={
      camp?.claimable && onClaim ? (
        <>
          <span className="mr-auto text-[11px] text-muted-foreground">Уже перевели?</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose()
              onClaim()
            }}
          >
            <Send /> Я отправил пожертвование
          </Button>
        </>
      ) : undefined
    }
  >
    <div className="grid gap-2">
      {camp?.methods.map((m) => (
        <MethodTile key={m.url} m={m} onClick={() => openMethod(m)} />
      ))}
    </div>
  </HubModal>
)

const STATUS: Record<LocalClaim['status'], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  wait: { label: 'на проверке', icon: Clock, cls: 'bg-st-warn/12 text-st-warn-text' },
  ok: { label: 'подтверждена', icon: CheckCircle2, cls: 'bg-st-ok/15 text-st-ok-text' },
  no: { label: 'отклонена', icon: XCircle, cls: 'bg-st-err/12 text-st-err-text' }
}

/** Свои заявки: сумма, ник, статус, ответ автора. */
export const MyClaims: React.FC<{ claims: LocalClaim[]; className?: string }> = ({ claims, className }) => {
  if (!claims.length) return null
  return (
    <ul className={cn('space-y-1.5', className)} data-tour="support-my-claims">
      {claims.map((c) => {
        const st = STATUS[c.status]
        const Icon = st.icon
        return (
          <li key={c.id} className="group rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold tabular-nums">{money(c.amount, c.cur)}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                от «{c.nick}»{c.method ? ` · ${c.method}` : ''} · {fmtDate(c.at)}
              </span>
              <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[10.5px] font-semibold', st.cls)}>
                <Icon className="size-3" /> {st.label}
              </span>
              {c.status !== 'wait' && (
                <button
                  type="button"
                  title="Убрать из списка"
                  aria-label="Убрать из списка"
                  onClick={() => void donClaimForget(c.id).then((v) => useHubStore.getState().applyInbox(v)).catch(() => undefined)}
                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            {c.answer && <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">{c.answer}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * «Я отправил пожертвование»: сумма, ник (запоминается), способ, комментарий. Отправка — один запрос
 * по кнопке; ответ автора приходит в уведомления, статус заявки виден здесь и в блоке сбора.
 */
export const ClaimDialog: React.FC<{ camp: DonCampaignPublic | null; onClose: () => void }> = ({ camp, onClose }) => {
  const savedNick = useHubStore((s) => s.claimNick)
  const allClaims = useHubStore((s) => s.claims)
  const [amount, setAmount] = useState('')
  const [nick, setNick] = useState('')
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const claims = useMemo(() => (camp ? allClaims.filter((c) => c.camp === camp.id) : []), [allClaims, camp])

  useEffect(() => {
    if (!camp) return
    setAmount('')
    setNick(savedNick)
    setMethod(camp.methods.length === 1 ? camp.methods[0].name : '')
    setNote('')
    setError(null)
    // Ник подставляется при открытии окна, дальше — как ввёл человек.
  }, [camp])

  const a = parseAmount(amount)
  const ok = Boolean(camp) && a !== null && nick.trim().length > 0 && !busy

  const send = async (): Promise<void> => {
    if (!camp || a === null) return
    setBusy(true)
    setError(null)
    try {
      const r = await donClaim({ camp: camp.id, title: camp.title, cur: camp.cur, amount: String(a), nick: nick.trim(), method: method || undefined, note: note.trim() || undefined })
      if (r.ok) {
        toast.success('Заявка отправлена', { description: 'Автор сверит перевод и добавит вас на стену благодарностей. Ответ придёт в уведомления.' })
        onClose()
      } else setError(r.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <HubModal
      open={Boolean(camp)}
      onClose={onClose}
      locked={busy}
      icon={HandCoins}
      title="Я отправил пожертвование"
      subtitle={camp ? `Сбор «${camp.title}»` : undefined}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void send()} disabled={!ok}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} Отправить автору
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.07] p-3 text-[11.5px] leading-relaxed text-foreground/90">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          Сначала переведите пожертвование любым способом из сбора, потом заполните эту форму. Автор сверит перевод и добавит вас на стену благодарностей: ник и цвет по сумме. Ответ придёт в
          уведомления (колокольчик в шапке).
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field label={`Сумма${camp ? `, ${camp.cur}` : ''}`} error={amount && a === null ? 'Число больше нуля' : null}>
          <input className={cn(inputClass, 'font-mono')} inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.slice(0, 14))} placeholder="500" />
        </Field>
        <Field label="Ник на стене" help="Как вас подписать. Запомнится для следующего раза.">
          <input className={inputClass} value={nick} onChange={(e) => setNick(e.target.value.slice(0, 32))} placeholder="Например: reb0oorn" />
        </Field>
      </div>
      {camp && camp.methods.length > 1 && (
        <Field label="Способ" optional help="Поможет автору быстрее найти перевод.">
          <div className="flex flex-wrap gap-1.5">
            {camp.methods.map((m) => (
              <button
                key={m.url}
                type="button"
                onClick={() => setMethod(method === m.name ? '' : m.name)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  method === m.name ? 'border-primary/70 bg-primary/12 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <MethodIcon icon={m.icon} className="size-4" /> {m.name}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Комментарий" optional help="Например, время перевода — так автору проще его найти.">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Перевёл около 18:30" />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-st-err/10 px-3 py-2 text-xs text-st-err-text">
          {error}
        </p>
      )}
      {claims.length > 0 && (
        <div className="space-y-1.5 border-t border-border/50 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ваши заявки</div>
          <MyClaims claims={claims} />
        </div>
      )}
    </HubModal>
  )
}
