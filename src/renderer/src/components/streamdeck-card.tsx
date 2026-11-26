import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, ChevronDown, Copy, FolderOpen, Keyboard, LayoutGrid, Link2, Loader2, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Hint } from '@renderer/components/prematch/hint'
import { LzPanel, LzSectionHead, Segmented } from '@renderer/components/lz'
import { ElgatoBrandIcon } from '@renderer/components/service-icons'
import { cn } from '@renderer/lib/utils'
import { platform } from '@renderer/utils/init'
import { scenariosList, type Scenario } from '@renderer/utils/ipc'
import {
  DEEPLINK_ROWS,
  actionOf,
  streamDeckLinks,
  streamDeckRotateKey,
  streamDeckInfo,
  streamDeckInstall,
  streamDeckReveal,
  type StreamDeckInfo,
  type StreamDeckResult
} from '@renderer/utils/streamdeck-api'

const isMac = platform === 'darwin'

type Tab = 'elgato' | 'other'

function CopyLink({ label, url }: { label: string; url: string }): React.ReactElement {
  const [done, setDone] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(url).then(
      () => {
        setDone(true)
        toast.success('Ссылка скопирована', { description: actionOf(url) })
        setTimeout(() => setDone(false), 1500)
      },
      () => toast.error('Не удалось скопировать')
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`Скопировать ссылку lazeyka://${actionOf(url)}`}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1 text-[11px] transition-colors hover:border-primary/40 hover:bg-foreground/[0.04]"
    >
      {done ? <Check className="size-3 text-st-ok-text" /> : <Copy className="size-3 text-muted-foreground" />}
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{actionOf(url)}</span>
    </button>
  )
}

/** Переключатель вкладок панели в стиле приложения (сегменты). */
function Tabs({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }): React.ReactElement {
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'elgato', label: 'Elgato Stream Deck', icon: <ElgatoBrandIcon className="size-3.5" /> },
    { id: 'other', label: 'Другие пульты и макро-клавиатуры', icon: <LayoutGrid className="size-3.5" /> }
  ]
  return (
    <div role="tablist" className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            'inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors',
            value === it.id ? 'bg-foreground/[0.08] text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** Шаг-способ в вкладке «Другие пульты». */
function Way({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex gap-3 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">{icon}</span>
      <div className="min-w-0 space-y-1.5">
        <div className="text-xs font-semibold">
          <span className="text-muted-foreground">Способ {n}. </span>
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

/** Сгруппированный список ссылок lazeyka://… с копированием в один клик. */
function LinksList({
  scenarios,
  signed,
  onRotate,
  rotating
}: {
  scenarios: Scenario[]
  signed: Record<string, string>
  onRotate: () => void
  rotating: boolean
}): React.ReactElement {
  const rows = DEEPLINK_ROWS.filter((r) => !(r.winOnly && isMac))
  // Подписанная ссылка этой установки; пока её нет — обычная (будет спрашивать подтверждение).
  const sig = (url: string): string => signed[actionOf(url)] ?? url
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs font-semibold">
        Ссылки-команды
        <Hint text="Нажмите на ссылку, чтобы скопировать её. В каждой ссылке есть код этой установки: такая ссылка выполняется без вопроса. Ссылку без кода (например, открытую веб-страницей) программа выполнит только после вашего подтверждения." />
        <span className="ml-auto" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[11px]"
          disabled={rotating}
          onClick={onRotate}
          data-tour="streamdeck-rotate-links"
          title="Выпустить новый код: ранее скопированные ссылки и установленный плагин начнут спрашивать подтверждение"
        >
          {rotating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Обновить ссылки
        </Button>
        <Hint text="Если ссылка попала к кому-то ещё, нажмите «Обновить ссылки». Старые ссылки перестанут выполняться без подтверждения. После этого скопируйте ссылки заново и переустановите плагин Stream Deck." />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.title} className="space-y-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2">
            <div className="flex items-center gap-1 text-xs font-semibold">
              {r.title}
              <Hint text={r.hint} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.links.map((l) => (
                <CopyLink key={l.url} label={l.label} url={sig(l.url)} />
              ))}
            </div>
          </div>
        ))}
        <div className="space-y-1.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2 md:col-span-2">
          <div className="flex items-center gap-1 text-xs font-semibold">
            Ваши сценарии
            <Hint text="Ссылка применяет сценарий целиком. Для каждого вашего сценария ссылка уже готова." />
          </div>
          {scenarios.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Сценариев пока нет. Создайте их на странице «Сценарии», и здесь появятся ссылки.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {scenarios.map((s) => (
                <CopyLink key={s.id} label={`${s.emoji ? `${s.emoji} ` : ''}${s.name}`} url={sig(`lazeyka://scenario/${s.id}`)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Вкладка «Elgato Stream Deck»: установка плагина. */
function ElgatoTab({ onShowLinks }: { onShowLinks: () => void }): React.ReactElement {
  const [info, setInfo] = useState<StreamDeckInfo | null>(null)
  const [busy, setBusy] = useState<'install' | 'reveal' | null>(null)
  const [result, setResult] = useState<StreamDeckResult | null>(null)

  useEffect(() => {
    streamDeckInfo().then(setInfo).catch(() => void 0)
  }, [])

  const install = async (force: boolean): Promise<void> => {
    setBusy('install')
    try {
      const r = await streamDeckInstall(force)
      setResult(r)
      if (r.status === 'opened') toast.success('Плагин передан приложению Stream Deck')
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const reveal = async (): Promise<void> => {
    setBusy('reveal')
    try {
      setResult(await streamDeckReveal())
    } catch (e) {
      setResult({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Плагин добавляет в приложение Stream Deck раздел «LAZEYKA» с готовыми кнопками: VPN, Zapret, Telegram-прокси, ExitLag, мини-окно и ваши сценарии. Нужно приложение Stream Deck 6.4 или новее.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5 text-xs" disabled={busy !== null || info?.source === 'none'} onClick={() => void install(false)}>
          {busy === 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          Установить плагин
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={busy !== null || info?.source === 'none'} onClick={() => void reveal()}>
          {busy === 'reveal' ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
          Показать файл в папке
        </Button>
        {info && (
          <span className={cn('flex items-center gap-1.5 text-[11px]', info.elgatoFound ? 'text-st-ok-text' : 'text-muted-foreground')}>
            <span aria-hidden className={cn('inline-block size-1.5 rounded-full', info.elgatoFound ? 'bg-st-ok' : 'bg-muted-foreground/50')} />
            {info.elgatoFound ? 'Приложение Stream Deck найдено' : 'Приложение Stream Deck не найдено'}
          </span>
        )}
      </div>

      {info?.source === 'none' && (
        <div className="rounded-lg bg-st-warn/10 px-3 py-2 text-xs text-st-warn-text">
          Файлов плагина в этой сборке программы нет. Переустановите LAZEYKA или соберите плагин вручную: node scripts/pack-streamdeck.mjs.
        </div>
      )}

      {result && (
        <div
          className={cn(
            'space-y-1.5 rounded-lg px-3 py-2 text-xs',
            result.status === 'opened' || result.status === 'revealed' ? 'bg-st-ok/15 text-st-ok-text' : 'bg-st-warn/10 text-st-warn-text'
          )}
        >
          <div>{result.message}</div>
          {result.status === 'not-found' && (
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy !== null} onClick={() => void install(true)}>
              Всё равно открыть
            </Button>
          )}
          {result.file && <div className="break-all font-mono text-[10px] opacity-80">{result.file}</div>}
        </div>
      )}

      <div className="flex gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Плагин, установленный этой кнопкой, знает код вашей установки, и его кнопки выполняются без вопроса. Если кнопки начали спрашивать
          «Выполнить?» (плагин ставили раньше, вручную или после «Обновить ссылки»), переустановите плагин. Новые сценарии тоже появятся в плагине
          без вопроса только после переустановки.
        </span>
      </div>

      <div className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Не хотите ставить плагин? Кнопку можно настроить и без него: действием, которое открывает ссылку или сайт, со ссылкой lazeyka://…{' '}
        <button type="button" onClick={onShowLinks} className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">
          Список ссылок
        </button>
      </div>
    </div>
  )
}

/** Вкладка «Другие пульты и макро-клавиатуры»: два универсальных способа и ссылки. */
function OtherTab(): React.ReactElement {
  const navigate = useNavigate()
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [rotating, setRotating] = useState(false)

  const loadSigned = async (list: Scenario[]): Promise<void> => {
    const actions = [
      ...DEEPLINK_ROWS.flatMap((r) => r.links.map((l) => actionOf(l.url))),
      ...list.map((s) => `scenario/${s.id}`)
    ]
    setSigned(await streamDeckLinks(actions))
  }

  useEffect(() => {
    scenariosList()
      .then((list) => {
        setScenarios(list)
        return loadSigned(list)
      })
      .catch(() => void 0)
  }, [])

  const rotate = async (): Promise<void> => {
    if (
      !window.confirm(
        'Выпустить новый код ссылок? Все скопированные раньше ссылки и установленный плагин Stream Deck начнут спрашивать подтверждение. Ссылки нужно будет скопировать заново, плагин — переустановить.'
      )
    )
      return
    setRotating(true)
    try {
      await streamDeckRotateKey()
      await loadSigned(scenarios)
      toast.success('Ссылки обновлены', { description: 'Скопируйте их заново и переустановите плагин Stream Deck' })
    } catch (e) {
      toast.error('Не удалось обновить ссылки', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRotating(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Fifine (AmpliGame, Control Deck), Loupedeck, Razer Stream Controller, Mirabox, Ajazz, а также дополнительные кнопки мыши и клавиатуры.
        У каждой из этих программ свои названия действий, но почти везде есть одно из двух, которые подходят для LAZEYKA.
      </p>

      <div className="grid gap-2 lg:grid-cols-2">
        <Way n={1} icon={<Link2 className="size-4" />} title="Кнопка открывает ссылку">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            В программе пульта выберите для кнопки действие, которое открывает ссылку или сайт, и вставьте ссылку из списка ниже. Ссылку откроет
            система, а LAZEYKA выполнит команду. Если программа закрыта, ссылка её запустит.
          </p>
        </Way>
        <Way n={2} icon={<Keyboard className="size-4" />} title="Кнопка нажимает сочетание клавиш">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Задайте в LAZEYKA горячие клавиши, а в программе пульта выберите действие, которое нажимает сочетание клавиш, и укажите то же
            сочетание. Подходит, если пульт не умеет открывать ссылки.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => navigate('/settings?open=controls&focus=hotkeys')}
          >
            <Keyboard className="size-3.5" />
            Горячие клавиши в «Настройках»
          </Button>
        </Way>
      </div>

      <LinksList scenarios={scenarios} signed={signed} onRotate={() => void rotate()} rotating={rotating} />

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        {isMac
          ? 'Без пульта ссылку можно открыть из «Быстрых команд», из Automator или командой open в терминале.'
          : 'Без пульта ссылку можно вставить в ярлык на рабочем столе (правая кнопка мыши, «Создать», «Ярлык») или открыть командой start в командной строке.'}
      </p>
    </div>
  )
}

/**
 * Плитка «Кнопки для стрим-пульта» на странице «Стример». Свёрнута, пока
 * пользователь не нажмёт «Открыть»: тогда раскрывается панель с двумя вкладками —
 * плагин для Elgato Stream Deck и универсальные способы для остальных пультов.
 * Пока панель закрыта, ни в главный процесс, ни к сценариям запросов нет.
 */
export default function StreamDeckCard(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('elgato')

  return (
    <div data-tour="streamdeck" className="ui-card rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
          <LayoutGrid className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-semibold">
            Кнопки для стрим-пульта
            <span className="font-normal text-muted-foreground">(Stream Deck, Fifine и другие)</span>
          </div>
          <div className="text-[11.5px] leading-snug text-muted-foreground">
            Кнопка на пульте включает и выключает VPN, Zapret, Telegram-прокси, показывает мини-окно или запускает ваш сценарий.
          </div>
        </div>
        <Button size="sm" variant={open ? 'ghost' : 'outline'} className="shrink-0 gap-1.5 text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Свернуть' : 'Открыть'}
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <Tabs value={tab} onChange={setTab} />
          {tab === 'elgato' ? <ElgatoTab onShowLinks={() => setTab('other')} /> : <OtherTab />}
        </div>
      )}
    </div>
  )
}

/**
 * Тот же стрим-пульт, но сразу открытый — для вкладки «Стрим-пульт» страницы
 * «Стример» (Е9). Запросы к главному процессу идут только при показе вкладки.
 */
export function StreamDeckPanel(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('elgato')
  return (
    <LzPanel data-tour="streamdeck" className="p-4">
      <LzSectionHead
        title="Кнопки для стрим-пульта"
        hint="Кнопка на пульте включает и выключает VPN, Zapret, Telegram-прокси, показывает мини-окно или запускает ваш сценарий."
        sub="Stream Deck, Fifine, Loupedeck и другие пульты и макро-клавиатуры"
        right={
          <Segmented
            items={[
              { id: 'elgato' as Tab, label: 'Elgato Stream Deck', icon: ElgatoBrandIcon },
              { id: 'other' as Tab, label: 'Другие пульты', icon: LayoutGrid }
            ]}
            value={tab}
            onChange={setTab}
            aria-label="Какой пульт"
            className="w-[380px]"
          />
        }
      />
      <div className="mt-3">{tab === 'elgato' ? <ElgatoTab onShowLinks={() => setTab('other')} /> : <OtherTab />}</div>
    </LzPanel>
  )
}
