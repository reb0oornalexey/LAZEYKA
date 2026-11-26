import React, { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  FlaskConical,
  Gamepad2,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Save,
  Square,
  Youtube,
  Cloud
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel, LzSectionHead } from '@renderer/components/lz'
import { cn, POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'
import { useZapretLab } from '@renderer/store/zapret-lab-store'
import {
  labActivate,
  labBinFiles,
  labCheck,
  labPreview,
  labSave,
  labStopCheck,
  type CheckReport,
  type FamilyId,
  type FamilySpec,
  type Fooling,
  type StrategyModel,
  type TcpField,
  type TcpParams
} from '@renderer/utils/zapret-lab-api'

/** Как в main/core/zapret-model.ts — чтобы ошибку было видно сразу, а не после сохранения. */
const HOST_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const POS_RE = /^(?:\d{1,4}|method|host|endhost|sld|midsld|endsld|sniext)(?:[+-]\d{1,4})?$/
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._+,-]*$/u
const isPos = (v: string): boolean => !!v && v.split(',').length <= 4 && v.split(',').every((p) => POS_RE.test(p))

const FAKE_ZERO = '0x00000000'
const FAKE_ORIG = '!'
const KNOWN_TLS = [
  'stun.bin',
  'stun2.bin',
  'tls_clienthello_www_google_com.bin',
  'tls_clienthello_4pda_to.bin',
  'tls_clienthello_max_ru.bin',
  'tls_clienthello_sochi_park.bin'
]

const FOOLING: { id: Fooling; label: string }[] = [
  { id: 'ts', label: 'метка времени (ts)' },
  { id: 'badseq', label: 'неверный номер (badseq)' },
  { id: 'md5sig', label: 'подпись MD5 (md5sig)' }
]

const SPLIT_PRESETS = ['1', '2', '1,midsld', '2,sniext+1', 'midsld']

const HINTS: Record<string, string> = {
  repeats: 'Сколько раз отправить поддельный пакет. Больше — надёжнее против фильтра, но больше лишнего трафика. У Flowseal от 4 до 11.',
  fooling:
    'Как сделать подделку негодной для сайта, но годной для фильтра провайдера. ts — устаревшая метка времени (её включает сам запуск стратегии); badseq — неверный номер пакета; md5sig — подпись MD5, проходит не во всех сетях.',
  badseqIncrement: 'На сколько сдвинуть номер поддельного пакета. У Flowseal 2 или 1000.',
  seqovl: 'Сколько чужих байт подложить перед первой частью запроса. У Flowseal от 568 до 681.',
  splitPos: 'Где резать начало соединения: 1 — после первого байта, 2 — после второго, midsld — посередине имени сайта, sniext+1 — у поля с именем сайта. Можно несколько через запятую.',
  seqovlPattern: 'Чем заполнить подложенные байты — кусок обычного запроса к другому, разрешённому сайту.',
  fakeTls:
    'Файлы поддельного начала соединения (запрос к разрешённому сайту). Можно несколько — они уйдут по очереди. «Нули» — пакет из нулей; «Свой запрос» — ваш же запрос, изменённый по настройке ниже.',
  tlsMod: 'Как изменить подделку: оставить как есть или заменить случайные данные и имя сайта.',
  tlsSni: 'Имя сайта в подделке — любой разрешённый сайт.',
  fakeHttp: 'Подделка для обычного HTTP (порт 80). Без неё порт 80 обрабатывается без подделки.',
  host: 'Какое имя сайта увидит фильтр вместо настоящего.',
  altorder: 'Отправлять части запроса в другом порядке.'
}

function shortBin(f: string): string {
  if (f === FAKE_ZERO) return 'нули'
  if (f === FAKE_ORIG) return 'свой запрос'
  return f.replace(/^tls_clienthello_/, '').replace(/^quic_initial_/, '').replace(/\.bin$/, '').replace(/_/g, '.')
}

interface Props {
  disabled?: boolean
  disabledReason?: string
  onSaved?: () => void
}

const Field: React.FC<{ label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string }> = ({
  label,
  hint,
  error,
  children,
  className
}) => (
  <div className={cn('min-w-0', className)}>
    <div className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-foreground/85">
      {label}
      {hint && <Hint text={hint} />}
    </div>
    {children}
    {error && <div className="mt-1 text-[11px] text-st-err-text">{error}</div>}
  </div>
)

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }> = ({
  on,
  onClick,
  children,
  title,
  disabled
}) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      on ? 'border-primary/50 bg-primary/12 text-primary' : 'border-foreground/[0.1] bg-foreground/[0.03] text-muted-foreground hover:border-primary/40 hover:text-foreground'
    )}
  >
    {on && <Check className="size-3" />}
    {children}
  </button>
)

const NumberField: React.FC<{ value: number; min: number; max: number; onChange: (v: number) => void; presets?: number[]; disabled?: boolean }> = ({
  value,
  min,
  max,
  onChange,
  presets,
  disabled
}) => {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (s: string): void => {
    const n = Math.round(Number(s))
    if (!Number.isFinite(n)) return setText(String(value))
    const c = Math.min(max, Math.max(min, n))
    setText(String(c))
    if (c !== value) onChange(c)
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="number"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
        className="h-8 w-20 text-xs"
      />
      {presets?.map((p) => (
        <Chip key={p} on={value === p} onClick={() => onChange(p)} disabled={disabled}>
          {p}
        </Chip>
      ))}
      <span className="text-[10px] text-muted-foreground">
        {min}–{max}
      </span>
    </div>
  )
}

const FamilyCard: React.FC<{ f: FamilySpec; on: boolean; onPick: () => void; disabled?: boolean }> = ({ f, on, onPick, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onPick}
    aria-pressed={on}
    title={`${f.what}\n\nКогда помогает: ${f.helps}\n\nОснова: ${f.reference}`}
    className={cn(
      'group relative flex min-w-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-xl border px-3 pt-3 pb-2.5 text-left transition-[background-color,border-color] duration-200 disabled:cursor-not-allowed disabled:opacity-60',
      on ? 'border-primary/50 bg-primary/[0.11]' : 'border-foreground/[0.08] bg-foreground/[0.025] hover:border-foreground/[0.16] hover:bg-foreground/[0.05]'
    )}
  >
    {/* Полоса сигнала сверху: горит у выбранного приёма. */}
    <span
      aria-hidden
      className={cn('absolute inset-x-3 top-0 h-[3px] rounded-b-full transition-colors', on ? 'bg-primary' : 'bg-transparent')}
      style={on ? { boxShadow: '0 0 10px var(--primary)' } : undefined}
    />
    <span className={cn('line-clamp-2 text-[12.5px] font-bold leading-tight', on ? 'text-[color:var(--text-title)]' : 'text-foreground')}>{f.title}</span>
    <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{f.helps}</span>
    <span className="mt-auto pt-0.5 text-[10.5px] text-muted-foreground/75">основа: {f.reference.replace(/^general\s*/, '') || 'general'}</span>
  </button>
)

const ZapretBuilder: React.FC<Props> = ({ disabled, disabledReason, onSaved }) => {
  const { families, limits, defaults, draft, setDraft, refreshCustom, custom, checking, setChecking } = useZapretLab()
  const [bins, setBins] = useState<{ tls: string[]; quic: string[] }>({ tls: [], quic: [] })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [check, setCheck] = useState<CheckReport | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [posText, setPosText] = useState('')

  useEffect(() => {
    void labBinFiles()
      .then((b) => setBins({ tls: b.tls, quic: b.quic }))
      .catch(() => void 0)
  }, [])

  // Черновик по умолчанию: «Подделка + разрезание» (ALT).
  useEffect(() => {
    if (!draft && defaults) setDraft({ model: defaults, name: '' })
  }, [draft, defaults, setDraft])

  const model = draft?.model ?? null
  useEffect(() => {
    setCheck(null)
    setCheckError(null)
  }, [model])
  const spec = useMemo(() => families.find((f) => f.id === model?.family) ?? null, [families, model?.family])
  const editing = draft?.editingId ? custom.find((c) => c.id === draft.editingId) : undefined

  useEffect(() => {
    setPosText(model?.tcp.splitPos ?? '')
  }, [model?.tcp.splitPos, model?.family])

  useEffect(() => {
    if (!previewOpen || !model) return
    let alive = true
    void labPreview(model, draft?.name || 'черновик')
      .then((r) => alive && setPreview(r.command))
      .catch(() => void 0)
    return () => {
      alive = false
    }
  }, [previewOpen, model, draft?.name])

  if (!model || !limits || families.length === 0) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Загружаю конструктор…
      </div>
    )
  }

  const locked = !!disabled || checking || saving
  const uses = (f: TcpField): boolean => !!spec?.uses.includes(f)
  const tlsFiles = bins.tls.length ? bins.tls : KNOWN_TLS
  const quicFiles = bins.quic.length ? bins.quic : ['quic_initial_www_google_com.bin']

  const update = (patch: Partial<StrategyModel>): void => {
    setDraft({ ...draft!, model: { ...model, ...patch } })
    setCheck(null)
  }
  const updTcp = (patch: Partial<TcpParams>): void => update({ tcp: { ...model.tcp, ...patch } })
  const pickFamily = (id: FamilyId): void => {
    const f = families.find((x) => x.id === id)
    if (!f || id === model.family) return
    update({ family: id, tcp: { ...f.preset, fooling: [...f.preset.fooling], fakeTls: [...f.preset.fakeTls] } })
  }

  const posError = uses('splitPos') && posText && !isPos(posText) ? 'Так нельзя: числа и слова midsld, sniext, host… через запятую' : null
  const sniError = uses('tlsSni') && model.tcp.tlsMod === 'rnd' && model.tcp.tlsSni && !HOST_RE.test(model.tcp.tlsSni) ? 'Нужно имя сайта, например www.google.com' : null
  const hostError = uses('host') && !HOST_RE.test(model.tcp.host) ? 'Нужно имя сайта, например ya.ru' : null
  const formError = posError || sniError || hostError

  const runCheck = async (): Promise<void> => {
    if (formError) return
    setChecking(true)
    setCheck(null)
    setCheckError(null)
    try {
      const r = await labCheck(model)
      setCheck(r)
      if (r.launchError) setCheckError(r.launchError)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'Остановлено') setCheckError(msg)
    } finally {
      setChecking(false)
    }
  }

  const doSave = async (asNew: boolean): Promise<void> => {
    const name = (asNew || !editing ? saveName : editing.name).replace(/\s+/g, ' ').trim()
    if (!NAME_RE.test(name) || name.length > 40) {
      toast.error('Название не подходит', { description: 'До 40 символов: буквы, цифры, пробел и . _ + , -' })
      return
    }
    setSaving(true)
    try {
      const saved = await labSave({
        id: asNew ? undefined : editing?.id,
        name,
        model,
        basedOn: draft?.basedOn,
        origin: 'manual'
      })
      await refreshCustom()
      setDraft({ ...draft!, editingId: saved.id, name: saved.name, model: saved.model })
      setSaveOpen(false)
      onSaved?.()
      toast.success(`Стратегия «${saved.name}» сохранена`, {
        style: POWER_ON_BANNER_STYLE,
        description: 'Она появилась в каталоге на вкладке «Стратегии».',
        action: {
          label: 'Включить',
          onClick: () => {
            void labActivate(saved.file).catch((e) => toast.error('Не удалось включить', { description: e instanceof Error ? e.message : String(e) }))
          }
        }
      })
    } catch (e) {
      toast.error('Не удалось сохранить', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const toggleFake = (f: string): void => {
    const cur = model.tcp.fakeTls
    if (cur.includes(f)) {
      if (cur.length === 1) return
      updTcp({ fakeTls: cur.filter((x) => x !== f) })
    } else if (cur.length < 4) {
      updTcp({ fakeTls: [...cur, f] })
    }
  }

  const blocks: { key: 'quic' | 'discordVoice' | 'cloudflare' | 'game'; icon: React.ReactNode; title: string; text: string; on: boolean; set: (v: boolean) => void }[] = [
    {
      key: 'quic',
      icon: <Youtube />,
      title: 'QUIC и YouTube',
      text: 'UDP 443 — быстрый протокол YouTube и Google в браузере: подделка перед первым пакетом.',
      on: model.quic.enabled,
      set: (v) => update({ quic: { ...model.quic, enabled: v } })
    },
    {
      key: 'discordVoice',
      icon: <MessageSquare />,
      title: 'Голос Discord',
      text: 'UDP 19294–19344 и 50000–50100: подделка перед первыми пакетами голосового канала.',
      on: model.discordVoice,
      set: (v) => update({ discordVoice: v })
    },
    {
      key: 'cloudflare',
      icon: <Cloud />,
      title: 'Порты Cloudflare',
      text: 'TCP 2053, 2083, 2087, 2096, 8443 для discord.media — тем же приёмом, что и сайты.',
      on: model.cloudflare,
      set: (v) => update({ cloudflare: v })
    },
    {
      key: 'game',
      icon: <Gamepad2 />,
      title: 'Игры (Game Filter)',
      text: 'Игровые порты из «Настроек». Работает, только если Game Filter там включён.',
      on: model.game,
      set: (v) => update({ game: v })
    }
  ]

  return (
    <div className="flex flex-col gap-3" data-tour="zapret-builder">
      <LzPanel className="p-4">
        <LzSectionHead
          title={editing ? `Изменение: ${editing.name}` : 'Новая стратегия'}
          hint="Соберите стратегию из блоков: приём для сайтов, числа к нему и что ещё обрабатывать. Проверьте её на Discord, YouTube, Google и Cloudflare и сохраните под своим названием."
          sub={
            draft?.basedOn
              ? `На основе «${draft.basedOn}»${draft.approximate ? ', приблизительно: часть флагов исходной стратегии в конструкторе не меняется' : ''}`
              : 'Скелет как у стратегий Flowseal; меняются приём для сайтов и блоки ниже'
          }
          right={
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={locked}
                className="size-8 rounded-lg"
                onClick={() => {
                  setDraft(defaults ? { model: defaults, name: '' } : null)
                  setCheck(null)
                  setCheckError(null)
                }}
                title="Начать заново с приёма по умолчанию"
                aria-label="Начать заново"
              >
                <RotateCcw className="size-3.5" />
              </Button>
              {checking ? (
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => void labStopCheck()}>
                  <Square className="size-3.5" /> Остановить
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  disabled={locked || !!formError}
                  title={disabled ? disabledReason : 'Запустить эту стратегию на ~10 секунд и проверить Discord, YouTube, Google и Cloudflare. Zapret на это время выключится и потом вернётся как был.'}
                  onClick={() => void runCheck()}
                  data-tour="zapret-builder-check"
                >
                  <FlaskConical className="size-3.5" /> Проверить
                </Button>
              )}
              {editing && (
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" disabled={locked || !!formError} onClick={() => void doSave(false)}>
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Сохранить
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 rounded-lg text-xs"
                disabled={locked || !!formError}
                onClick={() => {
                  setSaveName(editing ? `${editing.name} 2`.slice(0, 40) : draft?.name || '')
                  setSaveOpen((v) => !v)
                }}
                data-tour="zapret-builder-save"
              >
                <Save className="size-3.5" /> {editing ? 'Сохранить как новую…' : 'Сохранить как…'}
              </Button>
            </>
          }
        />

        {saveOpen && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-primary/40 bg-primary/[0.06] p-3">
            <Field label="Название стратегии" hint="Как она будет называться в каталоге. Можно по-русски. Файл: general (LZ название).bat" className="min-w-[240px] flex-1">
              <Input
                autoFocus
                value={saveName}
                maxLength={40}
                placeholder="Например: Дом, вечер"
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void doSave(true)}
                className="h-8 text-sm"
              />
            </Field>
            <Button size="sm" className="h-8 rounded-lg text-xs" disabled={saving || !saveName.trim()} onClick={() => void doSave(true)}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Сохранить
            </Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs" onClick={() => setSaveOpen(false)}>
              Отмена
            </Button>
          </div>
        )}

        {/* Результат проверки */}
        {(checking || check || checkError) && (
          <div
            className={cn(
              'relative mt-3 overflow-hidden rounded-xl border px-3 py-2.5',
              checking
                ? 'border-primary/30 bg-primary/[0.06]'
                : checkError
                  ? 'border-st-err/40 bg-st-err/[0.07]'
                  : check?.result.allOpen
                    ? 'border-primary/40 bg-primary/[0.08]'
                    : 'border-st-warn/40 bg-st-warn/[0.07]'
            )}
          >
            {checking ? (
              <>
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <Loader2 className="size-3.5 animate-spin text-primary" /> Запускаю стратегию и проверяю сайты…
                  <span className="font-normal text-muted-foreground">Zapret потом вернётся как был.</span>
                </div>
                <div className="lz-rail-flow mt-2 h-1 rounded-full text-primary/70" aria-hidden />
              </>
            ) : checkError ? (
              <div className="text-[12.5px] text-st-err-text">{checkError}</div>
            ) : check ? (
              <div className="space-y-2">
                <div className="text-[12.5px] font-semibold text-foreground">
                  {check.result.allOpen ? 'Всё открылось' : `Открылось ${check.result.okChecks} из ${check.result.totalChecks} проверок`}
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">за {Math.round(check.ms / 1000)} с</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {check.result.targets.map((t) => (
                    <span
                      key={t.id}
                      title={`TLS 1.2: ${t.tls12 ? 'да' : 'нет'}, TLS 1.3: ${t.tls13 ? 'да' : 'нет'}${t.stallOk === null ? '' : `, без обрыва на 16–20 КБ: ${t.stallOk ? 'да' : 'нет'}`}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-semibold',
                        t.ok ? 'border-foreground/[0.08] bg-foreground/[0.035] text-foreground' : 'border-st-err/30 bg-st-err/[0.07] text-st-err-text'
                      )}
                    >
                      {t.ok ? <CircleCheck className="size-3.5 text-primary" /> : <CircleX className="size-3.5" />}
                      {t.label}
                      <span className="font-normal text-muted-foreground">
                        TLS 1.2 {t.tls12 ? '✓' : '✕'} · 1.3 {t.tls13 ? '✓' : '✕'}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Приём для сайтов */}
        <section className="mt-4" data-tour="zapret-builder-family">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[color:var(--text-title)]">
            Приём для сайтов
            <span className="font-normal text-muted-foreground">TCP 443 и 80</span>
            <Hint text="Главное в стратегии: как обмануть фильтр провайдера, когда браузер открывает сайт. Наведите на карточку — там описание и на какой стратегии Flowseal она основана." />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
            {families.map((f) => (
              <FamilyCard key={f.id} f={f} on={f.id === model.family} onPick={() => pickFamily(f.id)} disabled={locked} />
            ))}
          </div>
        </section>
        {spec && (
          <p className="mt-3 max-w-[96ch] text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{spec.title}.</span> {spec.what}
          </p>
        )}
        {spec && spec.uses.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3.5 rounded-xl border border-foreground/[0.07] bg-foreground/[0.025] p-3.5 md:grid-cols-2 xl:grid-cols-3">
            {uses('repeats') && (
              <Field label="Повторы подделки" hint={HINTS.repeats}>
                <NumberField value={model.tcp.repeats || limits.repeats.min} min={limits.repeats.min} max={limits.repeats.max} presets={[4, 6, 8, 11]} onChange={(v) => updTcp({ repeats: v })} disabled={locked} />
              </Field>
            )}
            {uses('fooling') && (
              <Field label="Чем испортить подделку" hint={HINTS.fooling}>
                <div className="flex flex-wrap gap-1.5">
                  {FOOLING.map((f) => (
                    <Chip
                      key={f.id}
                      on={model.tcp.fooling.includes(f.id)}
                      disabled={locked}
                      onClick={() => {
                        const cur = model.tcp.fooling
                        const next = cur.includes(f.id) ? cur.filter((x) => x !== f.id) : [...cur, f.id]
                        if (next.length) updTcp({ fooling: next })
                      }}
                    >
                      {f.label}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            {uses('badseqIncrement') && model.tcp.fooling.includes('badseq') && (
              <Field label="Сдвиг номера (badseq)" hint={HINTS.badseqIncrement}>
                <NumberField
                  value={model.tcp.badseqIncrement || 2}
                  min={limits.badseqIncrement.min}
                  max={limits.badseqIncrement.max}
                  presets={[2, 1000]}
                  onChange={(v) => updTcp({ badseqIncrement: v })}
                  disabled={locked}
                />
              </Field>
            )}
            {uses('seqovl') && (
              <Field label="Наложение, байт" hint={HINTS.seqovl}>
                <NumberField value={model.tcp.seqovl} min={limits.seqovl.min} max={limits.seqovl.max} presets={[568, 652, 664, 681]} onChange={(v) => updTcp({ seqovl: v })} disabled={locked} />
              </Field>
            )}
            {uses('splitPos') && (
              <Field label="Где резать" hint={HINTS.splitPos} error={posError}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SPLIT_PRESETS.map((p) => (
                    <Chip key={p} on={model.tcp.splitPos === p} disabled={locked} onClick={() => updTcp({ splitPos: p })}>
                      {p}
                    </Chip>
                  ))}
                  {model.family === 'fakedsplit' && (
                    <Chip on={!model.tcp.splitPos} disabled={locked} onClick={() => updTcp({ splitPos: '' })} title="Не указывать: winws решит сам">
                      авто
                    </Chip>
                  )}
                  <Input
                    value={posText}
                    disabled={locked}
                    onChange={(e) => setPosText(e.target.value.trim())}
                    onBlur={() => isPos(posText) && posText !== model.tcp.splitPos && updTcp({ splitPos: posText })}
                    placeholder="своё"
                    className="h-7 w-28 text-xs"
                  />
                </div>
              </Field>
            )}
            {uses('seqovlPattern') && (
              <Field label="Чем заполнить наложение" hint={HINTS.seqovlPattern}>
                <div className="flex flex-wrap gap-1.5">
                  {tlsFiles.filter((f) => f.startsWith('tls_')).map((f) => (
                    <Chip key={f} on={model.tcp.seqovlPattern === f} disabled={locked} onClick={() => updTcp({ seqovlPattern: f })} title={f}>
                      {shortBin(f)}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            {uses('fakeTls') && (
              <Field label="Файлы подделки" hint={HINTS.fakeTls} className="md:col-span-2 xl:col-span-1">
                <div className="flex flex-wrap gap-1.5">
                  {[...tlsFiles, FAKE_ZERO, FAKE_ORIG].map((f) => (
                    <Chip key={f} on={model.tcp.fakeTls.includes(f)} disabled={locked} onClick={() => toggleFake(f)} title={f}>
                      {shortBin(f)}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            {uses('tlsMod') && (
              <Field label="Изменения подделки" hint={HINTS.tlsMod}>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['', 'нет'],
                      ['none', 'как есть'],
                      ['rnd', 'случайные + имя']
                    ] as const
                  ).map(([v, l]) => (
                    <Chip key={v || 'off'} on={model.tcp.tlsMod === v} disabled={locked} onClick={() => updTcp({ tlsMod: v, tlsSni: v === 'rnd' && !model.tcp.tlsSni && uses('tlsSni') ? 'www.google.com' : model.tcp.tlsSni })}>
                      {l}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            {uses('tlsSni') && model.tcp.tlsMod === 'rnd' && (
              <Field label="Имя сайта в подделке" hint={HINTS.tlsSni} error={sniError}>
                <Input value={model.tcp.tlsSni} disabled={locked} onChange={(e) => updTcp({ tlsSni: e.target.value.trim().toLowerCase() })} className="h-8 text-xs" placeholder="www.google.com" />
              </Field>
            )}
            {uses('host') && (
              <Field label="Подставное имя сайта" hint={HINTS.host} error={hostError}>
                <div className="flex items-center gap-2">
                  <Input value={model.tcp.host} disabled={locked} onChange={(e) => updTcp({ host: e.target.value.trim().toLowerCase() })} className="h-8 text-xs" placeholder="ya.ru" />
                  {uses('altorder') && (
                    <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title={HINTS.altorder}>
                      <Switch checked={model.tcp.altorder} disabled={locked} onCheckedChange={(v) => updTcp({ altorder: v })} /> другой порядок
                    </label>
                  )}
                </div>
              </Field>
            )}
            {uses('fakeHttp') && (
              <Field label="Подделка для HTTP (порт 80)" hint={HINTS.fakeHttp}>
                <div className="flex flex-wrap gap-1.5">
                  <Chip on={!model.tcp.fakeHttp} disabled={locked} onClick={() => updTcp({ fakeHttp: '' })}>
                    нет
                  </Chip>
                  {tlsFiles.filter((f) => f.startsWith('tls_')).map((f) => (
                    <Chip key={f} on={model.tcp.fakeHttp === f} disabled={locked} onClick={() => updTcp({ fakeHttp: f })} title={f}>
                      {shortBin(f)}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}
        {spec && spec.uses.length === 0 && (
          <div className="mt-3 text-[12px] text-muted-foreground">У этого приёма нет чисел для настройки.</div>
        )}
      </LzPanel>

      {/* Остальные блоки */}
      <LzPanel className="p-4">
        <LzSectionHead title="Что ещё обрабатывать" hint="Кроме сайтов стратегия может обходить фильтр для QUIC, голоса Discord, портов Cloudflare и игр. Выключите то, что вам не нужно." />
        <section className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4" data-tour="zapret-builder-blocks">
          {blocks.map((b) => (
            <div
              key={b.key}
              className={cn(
                'relative flex flex-col overflow-hidden rounded-xl border p-3 transition-[background-color,border-color] duration-200',
                b.on ? 'border-primary/40 bg-primary/[0.07]' : 'border-foreground/[0.08] bg-foreground/[0.025]'
              )}
            >
              <span aria-hidden className={cn('absolute inset-x-3 top-0 h-[3px] rounded-b-full transition-colors', b.on ? 'bg-primary' : 'bg-transparent')} />
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors [&_svg]:size-4',
                    b.on ? 'bg-primary/15 text-primary' : 'bg-foreground/[0.05] text-muted-foreground'
                  )}
                >
                  {b.icon}
                </span>
                <span className="min-w-0 flex-1 text-[13px] font-semibold text-foreground">{b.title}</span>
                <Switch checked={b.on} disabled={locked} onCheckedChange={b.set} aria-label={b.title} />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{b.text}</p>
              {b.key === 'quic' && model.quic.enabled && (
                <div className="mt-2.5 space-y-2.5 border-t border-foreground/[0.07] pt-2.5">
                  <Field label="Повторы" hint="Сколько раз отправить поддельный пакет QUIC. У Flowseal 6 или 11.">
                    <NumberField value={model.quic.repeats} min={limits.quicRepeats.min} max={limits.quicRepeats.max} presets={[6, 11]} onChange={(v) => update({ quic: { ...model.quic, repeats: v } })} disabled={locked} />
                  </Field>
                  {quicFiles.length > 1 && (
                    <Field label="Подделка" hint="Файл поддельного начала QUIC из сборки.">
                      <div className="flex flex-wrap gap-1.5">
                        {quicFiles.map((f) => (
                          <Chip key={f} on={model.quic.fake === f} disabled={locked} onClick={() => update({ quic: { ...model.quic, fake: f } })} title={f}>
                            {shortBin(f)}
                          </Chip>
                        ))}
                      </div>
                    </Field>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </LzPanel>

      {/* Предпросмотр */}
      <LzPanel>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-expanded={previewOpen}
        >
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !previewOpen && '-rotate-90')} />
          <span className="text-[13px] font-semibold text-foreground">Итоговая командная строка winws</span>
          <span className="text-[12px] text-muted-foreground">для тех, кто хочет проверить флаги</span>
        </button>
        {previewOpen && (
          <div className="relative border-t border-foreground/[0.07] px-4 py-3">
            <Button
              size="xs"
              variant="ghost"
              className="absolute top-3 right-3"
              onClick={() => {
                void navigator.clipboard.writeText(preview).then(() => toast.success('Скопировано'))
              }}
            >
              <Copy className="size-3" /> Копировать
            </Button>
            <pre className="custom-scrollbar max-h-56 overflow-auto pr-24 font-mono text-[10.5px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{preview || '…'}</pre>
          </div>
        )}
      </LzPanel>

      {editing && JSON.stringify(editing.model) === JSON.stringify(model) && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={() => {
              void labActivate(editing.file)
                .then(() => toast.success(`Включена «${editing.name}»`, { style: POWER_ON_BANNER_STYLE }))
                .catch((e) => toast.error('Не удалось включить', { description: e instanceof Error ? e.message : String(e) }))
            }}
            disabled={locked}
          >
            <Play className="size-3.5" /> Включить «{editing.name}»
          </Button>
        </div>
      )}
    </div>
  )
}

export default ZapretBuilder
