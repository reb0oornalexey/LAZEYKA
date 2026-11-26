import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Hint } from '@renderer/components/prematch/hint'
import { incyCheckExcludedRoutes, incyResetKillSwitch, type IncySettings } from '@renderer/utils/ipc'

type Update = (patch: Partial<IncySettings>, silent?: boolean) => Promise<void>

/** Строка настроек: заголовок, пояснение и переключатель. */
const ToggleRow: React.FC<{
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  border?: boolean
  tour?: string
}> = ({ title, hint, checked, onChange, border = true, tour }) => (
  <div data-tour={tour} className={`flex items-center justify-between gap-3 ${border ? 'pt-2 border-t border-border/50' : ''}`}>
    <div className="flex flex-col">
      <Label className="text-sm">{title}</Label>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
)

/** «Не применять настройки провайдера». */
export const IgnoreProviderSettingsRow: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({
  settings,
  onUpdate
}) => (
  <ToggleRow
    title="Не применять настройки провайдера"
    hint="Подписка может сама включать фрагментацию, шумовые пакеты и защищённый поиск адреса сервера. Если включить этот переключатель, такие указания игнорируются, и работают только ваши настройки."
    checked={Boolean(settings.ignoreProviderSettings)}
    onChange={(v) => void onUpdate({ ignoreProviderSettings: v })}
  />
)

/** «Искать адрес сервера через защищённый DNS». */
export const SecureServerLookupRow: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({
  settings,
  onUpdate
}) => (
  <ToggleRow
    title="Искать адрес сервера через защищённый DNS"
    hint="Помогает, если ваш интернет-провайдер подменяет адреса VPN-серверов. Запрос идёт в dns.google (8.8.8.8), если провайдер подписки не указал свой сервер."
    checked={Boolean(settings.secureServerLookup)}
    onChange={(v) => void onUpdate({ secureServerLookup: v })}
    tour="incy-secure-dns"
  />
)

/** «Подробный лог ядра». */
export const VerboseCoreLogRow: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({
  settings,
  onUpdate
}) => (
  <ToggleRow
    title="Подробный лог ядра"
    hint="Включайте для диагностики и выключайте после: лог быстро растёт."
    checked={Boolean(settings.verboseCoreLog)}
    onChange={(v) => void onUpdate({ verboseCoreLog: v })}
    tour="incy-verbose-log"
  />
)

const MTU_PRESETS = [1420, 1380, 1280]

/** Быстрый выбор MTU: Авто, 1420, 1380, 1280 или своё значение. */
export const MtuPicker: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({ settings, onUpdate }) => {
  const mtu = settings.tunMtu ?? 0
  const isPreset = mtu === 0 || MTU_PRESETS.includes(mtu)
  const [custom, setCustom] = useState(!isPreset)
  const [text, setText] = useState(isPreset ? '' : String(mtu))

  useEffect(() => {
    // Значение изменили снаружи (например, восстановили из резервной копии).
    const preset = mtu === 0 || MTU_PRESETS.includes(mtu)
    if (preset) setCustom(false)
    else {
      setCustom(true)
      setText(String(mtu))
    }
  }, [mtu])

  const applyCustom = (): void => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n) || n < 1280 || n > 9000) {
      toast.error('MTU — число от 1280 до 9000')
      return
    }
    void onUpdate({ tunMtu: n })
  }

  return (
    <div data-tour="incy-mtu" className="space-y-1.5 pt-2 border-t border-border/50">
      <Label className="text-sm">MTU адаптера TUN</Label>
      <div className="grid grid-cols-5 gap-1.5">
        {[{ v: 0, l: 'Авто' }, ...MTU_PRESETS.map((v) => ({ v, l: String(v) }))].map((o) => (
          <Button
            key={o.v}
            size="sm"
            variant={!custom && mtu === o.v ? 'default' : 'outline'}
            onClick={() => {
              setCustom(false)
              void onUpdate({ tunMtu: o.v })
            }}
            className="text-xs h-7"
          >
            {o.l}
          </Button>
        ))}
        <Button
          size="sm"
          variant={custom ? 'default' : 'outline'}
          onClick={() => setCustom(true)}
          className="text-xs h-7"
        >
          Своё
        </Button>
      </div>
      {custom && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1280}
            max={9000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyCustom()
            }}
            placeholder="1280–9000"
            className="w-28 h-7 text-xs font-mono"
          />
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={applyCustom}>
            Применить
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Оставьте «Авто». Уменьшайте, если часть сайтов не открывается или загрузки обрываются, особенно на мобильном
        интернете. Только для режима TUN.
      </p>
    </div>
  )
}

/** «Исключённые маршруты»: подсети, которые идут мимо туннеля TUN. */
export const ExcludedRoutesEditor: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({
  settings,
  onUpdate
}) => {
  const saved = settings.excludedRoutes ?? []
  const [text, setText] = useState(saved.join('\n'))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setText((settings.excludedRoutes ?? []).join('\n'))
  }, [settings.excludedRoutes])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const check = await incyCheckExcludedRoutes(text)
      if (check.invalid.length > 0) {
        toast.error(`Неверные записи: ${check.invalid.slice(0, 3).join(', ')}${check.invalid.length > 3 ? '…' : ''}`)
        return
      }
      if (check.overflow > 0) {
        toast.error('В списке не больше 64 подсетей')
        return
      }
      await onUpdate({ excludedRoutes: check.valid })
      setText(check.valid.join('\n'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось проверить список')
    } finally {
      setBusy(false)
    }
  }

  const dirty = text.split(/[\s,;]+/).filter(Boolean).join('\n') !== saved.join('\n')

  return (
    <div data-tour="incy-excluded-routes" className="space-y-1.5 pt-2 border-t border-border/50">
      <Label className="text-sm">
        Исключённые маршруты <Hint text="Подсети из этого списка не попадают в туннель и открываются напрямую: например, адрес принтера, рабочая сеть или игровой сервер. Формат: 10.20.0.0/16 или 2001:db8::/32, по одной записи в строке. Действует только в режиме TUN." />
      </Label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={'10.20.0.0/16\n192.168.50.0/24'}
        className="w-full rounded-md border border-border bg-card/30 px-2 py-1.5 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="text-xs h-7" disabled={busy || !dirty} onClick={() => void save()}>
          Сохранить список
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Подсетей: {saved.length} из 64. После сохранения туннель переподключится.
        </span>
      </div>
    </div>
  )
}

/** «Сбросить Kill Switch»: снять блокировку, если интернет остался закрытым. */
export const KillSwitchResetRow: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await incyResetKillSwitch()
      toast.success(res.message)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось снять блокировку')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-tour="incy-killswitch-reset" className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <Label className="text-sm">
          Сбросить Kill Switch <Hint text="Снимает блокировку трафика, если после сбоя программы интернет остался закрытым: останавливает ядро блокировки, убирает её временный конфиг и системный прокси. Заодно завершает ядра, оставшиеся от прошлого запуска. Работающее VPN-подключение не затрагивается. Больше ничего Kill Switch в систему не ставит: правил брандмауэра нет." />
        </Label>
        <span className="text-xs text-muted-foreground">
          Нажмите, если интернета нет, а VPN не подключён.
        </span>
      </div>
      <Button size="sm" variant="outline" className="text-xs h-7" disabled={busy} onClick={() => void run()}>
        Сбросить
      </Button>
    </div>
  )
}

// ---- Проверка ввода и пояснения к настройкам ---------------------------------

/**
 * Поле ввода с проверкой: значение сохраняется по уходу из поля или по Enter,
 * и только если оно верное. Иначе под полем остаётся пояснение, а сохранённое
 * значение не меняется. Так по одной цифре не уходят в настройки (каждое
 * сохранение переподключает туннель) и неверные значения не попадают в файл.
 */
export const DraftField: React.FC<{
  value: string
  validate: (v: string) => string | null
  onCommit: (v: string) => void
  placeholder?: string
  className?: string
  inputMode?: 'numeric' | 'text'
  label?: string
}> = ({ value, validate, onCommit, placeholder, className, inputMode, label }) => {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(value)
    setError(null)
  }, [value])

  const commit = (): void => {
    const text = draft.trim()
    if (text === value) {
      setError(null)
      return
    }
    const problem = validate(text)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    onCommit(text)
  }

  return (
    <div>
      {label && <Label className="text-[10px] text-muted-foreground">{label}</Label>}
      <Input
        value={draft}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(value)
            setError(null)
          }
        }}
        aria-invalid={error ? true : undefined}
        className={`${className ?? 'h-6 text-xs font-mono mt-0.5'} ${error ? 'border-st-err/60' : ''}`}
      />
      {error && <p className="mt-0.5 text-[10px] leading-snug text-st-err-text">{error}</p>}
    </div>
  )
}

export const PACKETS_ERROR = 'Допустимо: tlshello, all, число или диапазон (например 1-3)'
export const RANGE_ERROR = 'Нужно число или диапазон через дефис, например 50-100'

export const validPackets = (v: string): string | null =>
  /^(tlshello|all|\d+(-\d+)?)$/i.test(v.trim()) ? null : PACKETS_ERROR
export const validRange = (v: string): string | null => (/^\d+(-\d+)?$/.test(v.trim()) ? null : RANGE_ERROR)

/** Порт локального прокси (SOCKS5 + HTTP). */
export const MixedPortField: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({ settings, onUpdate }) => (
  <div data-tour="incy-mixed-port" className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
    <div className="flex flex-col">
      <Label className="text-sm">
        Локальный порт прокси (SOCKS5 + HTTP){' '}
        <Hint text="Порт, на котором ядро принимает подключения программ (127.0.0.1). Допустимо от 1024 до 65532: следующие три порта занимают служебные соединения ядер. Новое значение применяется сразу, туннель переподключится. Если порт занят другой программой, подключение не удастся." />
      </Label>
      <span className="text-xs text-muted-foreground">От 1024 до 65532. Меняйте, только если порт занят другой программой.</span>
    </div>
    <div className="w-24">
      <DraftField
        value={String(settings.mixedPort)}
        inputMode="numeric"
        className="h-7 text-xs font-mono"
        validate={(v) => {
          const n = Number(v)
          return /^\d+$/.test(v) && n >= 1024 && n <= 65532 ? null : 'Порт — число от 1024 до 65532'
        }}
        onCommit={(v) => void onUpdate({ mixedPort: Number(v) })}
      />
    </div>
  </div>
)

/** Проверка записей «Адреса мимо VPN»: домен, IP, подсеть CIDR или маска со звёздочкой. */
export function checkBypassEntries(text: string): { entries: string[]; invalid: string[] } {
  const entries: string[] = []
  const invalid: string[] = []
  for (const raw of text.split(/[;\n]+/)) {
    const v = raw.trim()
    if (!v) continue
    let ok = /^[^\s;/]{1,253}$/.test(v)
    if (v.includes('/')) {
      const m = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/.exec(v)
      ok = Boolean(m) && Number(m?.[2]) <= (m?.[1].includes(':') ? 128 : 32)
    }
    if (ok) {
      if (!entries.includes(v)) entries.push(v)
    } else invalid.push(v)
  }
  return { entries, invalid }
}

/** «Адреса мимо VPN»: домены и подсети, которые всегда открываются напрямую. */
export const ExtraBypassEditor: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({ settings, onUpdate }) => {
  const saved = settings.extraBypassAddresses ?? ''
  const [text, setText] = useState(saved.split(';').filter(Boolean).join('\n'))
  useEffect(() => {
    setText((settings.extraBypassAddresses ?? '').split(';').filter(Boolean).join('\n'))
  }, [settings.extraBypassAddresses])

  const save = async (): Promise<void> => {
    const { entries, invalid } = checkBypassEntries(text)
    if (invalid.length > 0) {
      toast.error(`Неверные записи: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`)
      return
    }
    await onUpdate({ extraBypassAddresses: entries.join(';') })
  }
  const dirty = checkBypassEntries(text).entries.join(';') !== saved

  return (
    <div data-tour="incy-bypass-addresses" className="space-y-1.5 pt-2 border-t border-border/50">
      <Label className="text-sm">
        Адреса мимо VPN{' '}
        <Hint text="Сайты и подсети из списка всегда открываются напрямую, без VPN, в режимах «Раздельно» и «Глобально». В списке: домены (example.ru), IP-адреса и подсети (203.0.113.0/24). Маски вроде 192.168.* не нужны: локальная сеть и так идёт напрямую. В режиме «Системный прокси» список также попадает в исключения прокси Windows." />
      </Label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={'example.ru\n203.0.113.0/24'}
        className="w-full rounded-md border border-border bg-card/30 px-2 py-1.5 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="text-xs h-7" disabled={!dirty} onClick={() => void save()}>
          Сохранить список
        </Button>
        <span className="text-[11px] text-muted-foreground">По одной записи в строке. Туннель переподключится сам.</span>
      </div>
    </div>
  )
}

/** «Определять сайт по соединению» (sniffing). */
export const SniffingRow: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({ settings, onUpdate }) => (
  <ToggleRow
    title="Определять сайт по соединению"
    hint="Ядро читает имя сайта из начала соединения, чтобы правила по доменам (российские сайты напрямую, ваши правила) работали и для программ, которые обращаются по IP-адресу. Выключайте только для проверки: тогда доменные правила перестанут срабатывать для таких соединений."
    checked={settings.sniffing !== false}
    onChange={(v) => void onUpdate({ sniffing: v })}
    tour="incy-sniffing"
  />
)

/** «Запрещать QUIC (UDP 443)» на ядре Xray. */
export const QuicBlockRow: React.FC<{ settings: IncySettings; onUpdate: Update }> = ({ settings, onUpdate }) => (
  <ToggleRow
    title="Запрещать QUIC (UDP 443) на ядре Xray"
    hint="Браузеры и приложения, не получив QUIC, переходят на обычное TCP-соединение: оно обычно стабильнее через VPN и не мешает фрагментации. Действует только на узлах, которые обслуживает Xray (фрагментация, шумы, параметры узла из ссылки)."
    checked={settings.xudpProxy443 !== 'allow'}
    onChange={(v) => void onUpdate({ xudpProxy443: v ? 'reject' : 'allow' })}
    tour="incy-quic-block"
  />
)

/**
 * Пояснение «изменения применяются сразу»: большинство настроек туннеля при
 * изменении переподключают его автоматически (через 1 с), а Kill Switch в эти
 * секунды не защищает: ядро заменяется целиком.
 */
export const ApplyNote: React.FC<{ connected: boolean; killSwitch: boolean; extra?: string; tour?: string }> = ({
  connected,
  killSwitch,
  extra,
  tour
}) => (
  <p data-tour={tour} className="text-[11px] leading-snug text-muted-foreground">
    {connected
      ? 'Изменения применяются сразу: туннель сам переподключится на 1–3 секунды.'
      : 'VPN не подключён: настройки применятся при следующем подключении.'}
    {connected && killSwitch ? ' В эти секунды Kill Switch не защищает: ядро заменяется целиком.' : ''}
    {extra ? ` ${extra}` : ''}
  </p>
)
