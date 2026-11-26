import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  ShieldHalf,
  Undo2,
  X
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { cn } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { dnsProbeCheck, type DnsProbeItem } from '@renderer/utils/dns-probe-api'
import { validateDnsForm, type DnsEnc, type DnsFormValues } from './dns-validate'

const isMac = platform === 'darwin'

export type DnsFormState = DnsFormValues & { fallback: boolean }
export const EMPTY_DNS_FORM: DnsFormState = {
  name: '',
  v4a: '',
  v4b: '',
  v6a: '',
  v6b: '',
  doh: '',
  fallback: false,
  site: ''
}

export type DnsDialogKind = 'new' | 'custom' | 'builtin'

const ENC_OPTIONS: { id: DnsEnc; title: string; icon: typeof Lock; text: string; when: string }[] =
  [
    {
      id: 'none',
      title: 'Без шифрования',
      icon: LockOpen,
      text: 'Запросы идут открытым текстом: провайдер их видит и может подменить.',
      when: 'Для локальных и игровых DNS, у которых нет DoH.'
    },
    {
      id: 'doh',
      title: 'DoH + запасной',
      icon: ShieldHalf,
      text: `Шифрованно. Если DoH не ответил, ${isMac ? 'macOS' : 'Windows'} спросит обычным способом.`,
      when: 'Когда важнее, чтобы сайты открывались всегда.'
    },
    {
      id: 'strict',
      title: 'Только DoH',
      icon: Lock,
      text: 'Только шифрованно, без обходного пути. Если DoH недоступен, сайты не откроются.',
      when: 'Если сервис требует только DoH (например, DNS-AI).'
    }
  ]

function Block({
  step,
  title,
  hint,
  right,
  tour,
  children
}: {
  step: number
  title: string
  hint?: string
  right?: React.ReactNode
  tour?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section data-tour={tour} className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[10px] font-black text-primary">
          {step}
        </span>
        <h3 className="text-sm font-black">{title}</h3>
        {hint && <Hint text={hint} />}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  optional,
  error,
  help,
  children
}: {
  label: string
  optional?: boolean
  error?: string | null
  help?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/90">
        {label}
        {optional && (
          <span className="rounded bg-foreground/[0.06] px-1 py-px text-[9.5px] font-medium text-muted-foreground">
            необязательно
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-[10.5px] leading-snug text-st-err-text">
          {error}
        </span>
      ) : help ? (
        <span className="text-[10.5px] leading-snug text-muted-foreground">{help}</span>
      ) : null}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
  mono,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder: string
  invalid?: boolean
  mono?: boolean
  autoFocus?: boolean
}): React.ReactElement {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-9 w-full min-w-0 rounded-xl border border-[color:var(--input-border)] bg-[color:var(--input-bg)] px-3 text-xs outline-none transition-all placeholder:text-muted-foreground/60',
        'focus-visible:border-[color:var(--input-focus-border)] focus-visible:ring-2 focus-visible:ring-[color:var(--input-focus-ring)]',
        mono && 'font-mono',
        invalid && 'border-st-err/70 focus-visible:border-st-err focus-visible:ring-st-err/25'
      )}
    />
  )
}

function ProbeChip({ ms }: { ms: number | null }): React.ReactElement {
  if (ms == null)
    return (
      <span className="rounded-md bg-st-err/10 px-1.5 py-0.5 text-[10px] font-semibold text-st-err-text">
        нет ответа
      </span>
    )
  const tone =
    ms < 60
      ? 'text-st-ok-text bg-st-ok/10'
      : ms < 150
        ? 'text-st-warn-text bg-st-warn/10'
        : 'text-st-err-text bg-st-err/10'
  return (
    <span className={cn('rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums', tone)}>
      {ms} мс
    </span>
  )
}

const KIND_LABEL: Record<DnsProbeItem['kind'], string> = { ipv4: 'IPv4', ipv6: 'IPv6', doh: 'DoH' }

/**
 * Окно добавления и правки DNS-сервера (вкладка «DNS»). Поля проверяются при
 * вводе, шифрование выбирается карточками, «Проверить» опрашивает введённые
 * адреса до сохранения. Сохранение и сброс делает страница (onSave / onRevert).
 */
export function DnsServerDialog({
  open,
  kind,
  initial,
  title,
  edited,
  saving,
  onCancel,
  onSave,
  onRevert
}: {
  open: boolean
  kind: DnsDialogKind
  initial: DnsFormState
  /** Название встроенной записи (для шапки). */
  title?: string
  /** Встроенная запись изменена пользователем — показывается «Вернуть как было». */
  edited?: boolean
  saving: boolean
  onCancel: () => void
  onSave: (form: DnsFormState) => void
  onRevert?: () => void
}): React.ReactElement | null {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dns-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) onCancel()
          }}
        >
          <DialogBody
            kind={kind}
            initial={initial}
            title={title}
            edited={edited}
            saving={saving}
            onCancel={onCancel}
            onSave={onSave}
            onRevert={onRevert}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function DialogBody({
  kind,
  initial,
  title,
  edited,
  saving,
  onCancel,
  onSave,
  onRevert
}: {
  kind: DnsDialogKind
  initial: DnsFormState
  title?: string
  edited?: boolean
  saving: boolean
  onCancel: () => void
  onSave: (form: DnsFormState) => void
  onRevert?: () => void
}): React.ReactElement {
  const [form, setForm] = useState<DnsFormState>(initial)
  // Новый сервер — сразу «Только DoH»: самый понятный и безопасный вариант. У существующего — то, что сохранено.
  const [enc, setEnc] = useState<DnsEnc>(
    kind === 'new' ? 'strict' : initial.doh ? (initial.fallback ? 'doh' : 'strict') : 'none'
  )
  const [showV6, setShowV6] = useState(Boolean(initial.v6a || initial.v6b))
  const [touched, setTouched] = useState<Partial<Record<keyof DnsFormState, boolean>>>({})
  const [tried, setTried] = useState(false)
  const [probe, setProbe] = useState<{ key: string; items: DnsProbeItem[] } | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  const needName = kind !== 'builtin'
  const errors = useMemo(() => validateDnsForm(form, enc, { needName }), [form, enc, needName])
  const valid = Object.keys(errors).length === 0
  // Неверный ввод подсвечивается сразу; пустое обязательное поле — после ухода с него или попытки сохранить.
  const shown = (k: keyof DnsFormState): string | undefined => {
    const err = errors[k as keyof typeof errors]
    if (!err) return undefined
    const v = String(form[k] ?? '').trim()
    return v || touched[k] || tried ? err : undefined
  }
  const anyShown = (Object.keys(errors) as (keyof DnsFormState)[]).some((k) => Boolean(shown(k)))
  const set = (patch: Partial<DnsFormState>): void => setForm((f) => ({ ...f, ...patch }))
  const touch = (k: keyof DnsFormState) => (): void => setTouched((t) => ({ ...t, [k]: true }))

  const pickEnc = (m: DnsEnc): void => {
    setEnc(m)
    set({ fallback: m === 'doh' })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  // Что проверяем: только заполненные и верные поля. Результат проверки — для этих значений.
  const probeInput = useMemo(
    () => ({
      ipv4: [form.v4a, form.v4b]
        .map((v) => v.trim())
        .filter((v, i) => v && !errors[i === 0 ? 'v4a' : 'v4b']),
      ipv6: showV6
        ? [form.v6a, form.v6b]
            .map((v) => v.trim())
            .filter((v, i) => v && !errors[i === 0 ? 'v6a' : 'v6b'])
        : [],
      doh: enc !== 'none' && !errors.doh ? form.doh.trim().replace(/\{\?dns\}$/i, '') : ''
    }),
    [form, errors, enc, showV6]
  )
  const probeKey = JSON.stringify(probeInput)
  const canProbe = probeInput.ipv4.length + probeInput.ipv6.length > 0 || Boolean(probeInput.doh)
  const fresh = probe && probe.key === probeKey ? probe.items : null

  const runProbe = async (): Promise<void> => {
    setProbing(true)
    setProbeError(null)
    try {
      const items = await dnsProbeCheck(probeInput)
      setProbe({ key: probeKey, items })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setProbeError(
        /No handler registered/i.test(msg)
          ? 'Проверка недоступна в этой версии программы.'
          : `Не удалось проверить: ${msg}`
      )
    } finally {
      setProbing(false)
    }
  }

  const submit = (): void => {
    setTried(true)
    if (!valid || saving) return
    onSave({
      ...form,
      doh: enc === 'none' ? '' : form.doh.trim(),
      fallback: enc === 'doh',
      v6a: showV6 ? form.v6a : '',
      v6b: showV6 ? form.v6b : ''
    })
  }

  const head =
    kind === 'builtin'
      ? { icon: Pencil, title: 'Изменить адреса', sub: title ?? '' }
      : kind === 'custom'
        ? { icon: Pencil, title: 'Изменить DNS-сервер', sub: initial.name }
        : {
            icon: Plus,
            title: 'Свой DNS-сервер',
            sub: 'Адреса и шаблон DoH обычно есть на сайте сервиса, в разделе с настройкой для Windows или macOS.'
          }
  const HeadIcon = head.icon
  const v6count = [form.v6a, form.v6b].filter((v) => v.trim()).length
  const skipped = (['v4a', 'v4b', 'v6a', 'v6b', 'doh'] as const).filter(
    (k) =>
      errors[k] &&
      String(form[k]).trim() &&
      (k !== 'doh' || enc !== 'none') &&
      (!k.startsWith('v6') || showV6)
  ).length
  const okCount = fresh?.filter((x) => x.ms != null).length ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      role="dialog"
      aria-modal="true"
      aria-label={head.title}
      data-tour="dns-server-form"
      className="relative flex max-h-[min(760px,92vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl"
    >
      {/* Шапка */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border/50 px-5 pb-4 pt-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-black leading-tight tracking-tight">
            {head.title}
            <HeadIcon className="size-3.5 text-muted-foreground" />
          </h2>
          {head.sub && (
            <p
              className={cn(
                'mt-0.5 text-xs text-muted-foreground',
                kind !== 'new' && 'truncate font-semibold text-foreground/80'
              )}
            >
              {head.sub}
            </p>
          )}
          {kind === 'builtin' && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Ваши адреса будут главнее каталога, пока вы не нажмёте «Вернуть как было».
              {edited && (
                <span className="ml-1.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-primary">
                  изменено вами
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          disabled={saving}
          onClick={onCancel}
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Содержимое */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {needName && (
          <Block step={1} title="Сервер" tour="dns-form-name">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Название" error={shown('name')}>
                <TextInput
                  autoFocus={kind === 'new'}
                  value={form.name}
                  onChange={(v) => set({ name: v })}
                  onBlur={touch('name')}
                  placeholder="Например, «Домашний DNS»"
                  invalid={Boolean(shown('name'))}
                />
              </Field>
              <Field
                label="Сайт сервиса"
                optional
                error={shown('site')}
                help="В строке появится кнопка перехода на сайт."
              >
                <TextInput
                  value={form.site}
                  onChange={(v) => set({ site: v })}
                  onBlur={touch('site')}
                  placeholder="https://example.com"
                  invalid={Boolean(shown('site'))}
                />
              </Field>
            </div>
          </Block>
        )}

        <Block
          step={needName ? 2 : 1}
          title="Адреса"
          hint="Обычные адреса DNS-сервера. Основной обязателен, дополнительный используется, если основной не ответил."
          tour="dns-form-addresses"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="IPv4 основной" error={shown('v4a')}>
              <TextInput
                autoFocus={kind !== 'new'}
                mono
                value={form.v4a}
                onChange={(v) => set({ v4a: v })}
                onBlur={touch('v4a')}
                placeholder="1.1.1.1"
                invalid={Boolean(shown('v4a'))}
              />
            </Field>
            <Field label="IPv4 дополнительный" optional error={shown('v4b')}>
              <TextInput
                mono
                value={form.v4b}
                onChange={(v) => set({ v4b: v })}
                onBlur={touch('v4b')}
                placeholder="1.0.0.1"
                invalid={Boolean(shown('v4b'))}
              />
            </Field>
          </div>

          <div className="mt-3 rounded-lg border border-border/70 bg-background/40">
            <button
              type="button"
              aria-expanded={showV6}
              onClick={() => setShowV6((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-foreground/90 transition-colors hover:bg-foreground/[0.03]"
            >
              <Globe className="size-3.5 text-muted-foreground" />
              Адреса IPv6
              <span className="text-[10.5px] font-normal text-muted-foreground">
                {v6count > 0 ? `· указано ${v6count}` : '· необязательно'}
              </span>
              <ChevronDown
                className={cn(
                  'ml-auto size-4 text-muted-foreground transition-transform',
                  showV6 && 'rotate-180'
                )}
              />
            </button>
            {showV6 && (
              <div className="space-y-2 border-t border-border/60 px-3 pb-3 pt-2.5">
                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  Ставятся вместе с IPv4 на адаптерах, где включён IPv6. Если не знаете — оставьте
                  пустыми.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="IPv6 основной" error={shown('v6a')}>
                    <TextInput
                      mono
                      value={form.v6a}
                      onChange={(v) => set({ v6a: v })}
                      onBlur={touch('v6a')}
                      placeholder="2606:4700:4700::1111"
                      invalid={Boolean(shown('v6a'))}
                    />
                  </Field>
                  <Field label="IPv6 дополнительный" error={shown('v6b')}>
                    <TextInput
                      mono
                      value={form.v6b}
                      onChange={(v) => set({ v6b: v })}
                      onBlur={touch('v6b')}
                      placeholder="2606:4700:4700::1001"
                      invalid={Boolean(shown('v6b'))}
                    />
                  </Field>
                </div>
                {v6count > 0 && (
                  <button
                    type="button"
                    onClick={() => set({ v6a: '', v6b: '' })}
                    className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-st-err-text"
                  >
                    Очистить IPv6
                  </button>
                )}
              </div>
            )}
          </div>
        </Block>

        <Block
          step={needName ? 3 : 2}
          title="Шифрование"
          hint="DoH — DNS-запросы внутри HTTPS: провайдер не видит, какие сайты вы открываете, и не может подменить ответ."
          tour="dns-form-encryption"
        >
          <div
            role="radiogroup"
            aria-label="Шифрование"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {ENC_OPTIONS.map((o) => {
              const on = enc === o.id
              const Icon = o.icon
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickEnc(o.id)}
                  className={cn(
                    'group relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 text-left transition-all',
                    on
                      ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary)]'
                      : 'border-border bg-background/40 hover:border-primary/40 hover:bg-foreground/[0.03]'
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-lg',
                        on
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-foreground/[0.06] text-muted-foreground group-hover:text-foreground'
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-full border-2',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                      )}
                    >
                      {on && <Check className="size-2.5" strokeWidth={4} />}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'text-xs font-bold',
                      on ? 'text-foreground' : 'text-foreground/85'
                    )}
                  >
                    {o.title}
                  </span>
                  <span className="text-[10.5px] leading-snug text-muted-foreground">{o.text}</span>
                  <span className="text-[10.5px] leading-snug text-foreground/70">{o.when}</span>
                </button>
              )
            })}
          </div>
          {enc !== 'none' && (
            <div className="mt-3">
              <Field
                label="Адрес DoH (шаблон)"
                error={shown('doh')}
                help="Ссылка вида https://…/dns-query — есть на сайте сервиса рядом с адресами."
              >
                <TextInput
                  mono
                  value={form.doh}
                  onChange={(v) => set({ doh: v })}
                  onBlur={touch('doh')}
                  placeholder="https://dns.example.com/dns-query"
                  invalid={Boolean(shown('doh'))}
                />
              </Field>
            </div>
          )}
        </Block>

        <Block
          step={needName ? 4 : 3}
          title="Проверка"
          hint="Отправляет по одному DNS-запросу на каждый введённый адрес и на DoH. Ничего не меняет в системе."
          tour="dns-form-check"
          right={
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!canProbe || probing}
              onClick={() => void runProbe()}
            >
              {probing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Activity className="size-3.5" />
              )}
              {probing ? 'Проверяю…' : fresh ? 'Ещё раз' : 'Проверить'}
            </Button>
          }
        >
          {probeError ? (
            <p className="text-[11px] text-st-err-text">{probeError}</p>
          ) : fresh ? (
            <div className="space-y-1.5">
              {fresh.map((it) => (
                <div
                  key={`${it.kind}:${it.target}`}
                  className="flex items-center gap-2 rounded-lg bg-background/50 px-2.5 py-1.5"
                >
                  <span className="w-9 shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[it.kind]}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90"
                    title={it.target}
                  >
                    {it.target}
                  </span>
                  <ProbeChip ms={it.ms} />
                </div>
              ))}
              {skipped > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Поля с ошибками не проверялись: {skipped}.
                </p>
              )}
              <p
                className={cn(
                  'flex items-center gap-1.5 pt-0.5 text-[11px]',
                  okCount === fresh.length
                    ? 'text-st-ok-text'
                    : okCount > 0
                      ? 'text-st-warn-text'
                      : 'text-st-err-text'
                )}
              >
                {okCount === fresh.length ? <ShieldCheck className="size-3.5" /> : null}
                {okCount === fresh.length
                  ? 'Все адреса ответили.'
                  : okCount > 0
                    ? 'Часть адресов не ответила — проверьте их на сайте сервиса.'
                    : 'Ни один адрес не ответил. Проверьте адреса или подключение к интернету.'}
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {canProbe
                ? 'Можно проверить, отвечают ли адреса, до сохранения. Покажем время ответа каждого.'
                : 'Впишите хотя бы один верный адрес — и его можно будет проверить.'}
              {probe && !fresh && ' Адреса изменились — проверьте ещё раз.'}
            </p>
          )}
        </Block>
      </div>

      {/* Действия */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/50 bg-card/70 px-5 py-3.5">
        {kind === 'builtin' && edited && onRevert && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={saving}
            onClick={onRevert}
            title="Убрать вашу правку и снова брать адреса из каталога"
            data-tour="dns-form-revert"
          >
            <Undo2 className="size-3.5" />
            Вернуть как было
          </Button>
        )}
        {!valid && (tried || anyShown) && (
          <span className="text-[11px] text-st-err-text">Исправьте поля, выделенные красным</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={saving}
            onClick={onCancel}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            className="min-w-28 text-xs"
            disabled={saving || !valid}
            onClick={submit}
            title={!valid ? 'Сначала исправьте ошибки в полях' : undefined}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {kind === 'new' ? 'Добавить' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
