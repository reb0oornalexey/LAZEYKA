/**
 * Действия сценария для конструктора «Когда… → Сделать…».
 *
 * Это только описание для интерфейса: формат сценария не меняется. Каждое
 * действие читает и пишет те же поля, что и раньше (zapret / incy / exitlag /
 * tgws / dns и поля 1.3.0 из lib/scenario-extra.ts). «Не трогать» = шага нет.
 * Порядок ACTIONS — порядок выполнения по умолчанию в главном процессе
 * (src/main/core/scenarios.ts → applyScenario): DNS → Zapret → ExitLag → VPN →
 * Telegram → режим стримера → мини-окно → раздача → Discord → «Перед каткой».
 * Сценарий может хранить свой порядок (`order`) — его задают перетаскиванием шагов.
 */
import React from 'react'
import {
  Crosshair,
  EyeOff,
  Gamepad2,
  Globe,
  Network,
  PictureInPicture2,
  Send,
  ShieldCheck,
  type LucideProps
} from 'lucide-react'
import ZapretIcon from '@renderer/components/zapret-icon'
import { DiscordBrandIcon } from '@renderer/components/service-icons'
import { EXTRA_ROWS, type ExtraKey, type FullScenario } from '@renderer/lib/scenario-extra'
import type { DohProvider, IncyNode } from '@renderer/utils/ipc'
import { platform } from '@renderer/utils/init'

const isMac = platform === 'darwin'

export type ActionId = 'dns' | 'zapret' | 'exitlag' | 'incy' | 'tgws' | ExtraKey
export type GroupId = 'bypass' | 'vpn' | 'play' | 'window'

export interface ActionOption {
  value: string
  label: string
  /** on — действие что-то включает, off — выключает (для цвета чипа). */
  tone: 'on' | 'off' | 'neutral'
}

export interface ScenarioAction {
  id: ActionId
  group: GroupId
  title: string
  /** Одна строка в палитре: что делает. */
  desc: string
  /** Подсказка «i» у шага. */
  hint: string
  icon: React.FC<{ className?: string }>
  /** Варианты без «Не трогать». У DNS варианты строятся из списка серверов. */
  options: ActionOption[]
  /** Что ставится при добавлении шага. */
  initial: string
  /** Слова для поиска в палитре. */
  keywords: string
}

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: 'bypass', title: 'Обход блокировок' },
  { id: 'vpn', title: 'VPN' },
  { id: 'play', title: 'Игры и стрим' },
  { id: 'window', title: 'Окно и сеть' }
]

const ON_OFF: ActionOption[] = [
  { value: 'on', label: 'Включить', tone: 'on' },
  { value: 'off', label: 'Выключить', tone: 'off' }
]

const Discord: React.FC<{ className?: string }> = ({ className }) => <DiscordBrandIcon className={className} />
const Zapret: React.FC<LucideProps> = (p) => <ZapretIcon {...p} />

function extra(key: ExtraKey): { hint: string; options: ActionOption[] } {
  const row = EXTRA_ROWS.find((r) => r.key === key)!
  return {
    hint: row.hint,
    options: row.options
      .filter((o) => o.value !== 'keep')
      .map((o) => ({ value: o.value, label: o.label, tone: o.tone ?? 'neutral' }))
  }
}

const ALL: ScenarioAction[] = [
  {
    id: 'dns',
    group: 'bypass',
    title: 'DNS',
    desc: 'Сменить DNS-сервер системы',
    hint: 'Ставит в системе выбранный DNS-сервер. «Стандартный» возвращает адрес, который выдаёт роутер (DHCP).',
    icon: ShieldCheck,
    options: [],
    initial: 'dhcp',
    keywords: 'dns днс сервер cloudflare google adguard'
  },
  {
    id: 'zapret',
    group: 'bypass',
    title: 'Zapret',
    desc: 'Обход блокировок со своей стратегией',
    hint: 'Включает или выключает Zapret. Можно выбрать стратегию: если Zapret уже работает с другой, он перезапустится с выбранной.',
    icon: Zapret,
    options: ON_OFF,
    initial: 'on',
    keywords: 'zapret запрет обход блокировки стратегия youtube discord'
  },
  {
    id: 'exitlag',
    group: 'vpn',
    title: 'ExitLag',
    desc: 'VPN только для выбранных игр и программ',
    hint: 'Пускает через VPN только программы из списка, остальное идёт напрямую. Список можно запомнить в сценарии или брать текущий с вкладки ExitLag.',
    icon: Gamepad2,
    options: ON_OFF,
    initial: 'on',
    keywords: 'exitlag игра игры программы приложения vpn пинг'
  },
  {
    id: 'incy',
    group: 'vpn',
    title: 'VPN (INCY)',
    desc: 'Подключиться к узлу или отключиться',
    hint: 'Подключает VPN к выбранному узлу или отключает его. Без выбранного узла берётся тот, что выбран сейчас на вкладке INCY.',
    icon: Globe,
    options: [
      { value: 'on', label: 'Подключить', tone: 'on' },
      { value: 'off', label: 'Отключить', tone: 'off' }
    ],
    initial: 'on',
    keywords: 'vpn впн incy инси узел сервер страна'
  },
  {
    id: 'tgws',
    group: 'bypass',
    title: 'Telegram-прокси',
    desc: 'Прокси, чтобы Telegram работал',
    hint: 'Включает или выключает встроенный прокси для Telegram.',
    icon: Send,
    options: ON_OFF,
    initial: 'on',
    keywords: 'telegram телеграм прокси tg'
  },
  {
    id: 'streamer',
    group: 'play',
    title: 'Режим стримера',
    desc: 'Скрыть IP, узлы и ссылки от зрителей',
    ...extra('streamer'),
    icon: EyeOff,
    initial: 'on',
    keywords: 'стример стрим obs скрыть ip трансляция'
  },
  {
    id: 'mini',
    group: 'window',
    title: 'Мини-окно',
    desc: 'Маленькое окно поверх остальных',
    ...extra('mini'),
    icon: PictureInPicture2,
    initial: 'panel',
    keywords: 'мини окно поверх панель индикатор оверлей'
  },
  {
    id: 'lan',
    group: 'window',
    title: 'Раздача в сети',
    desc: 'Пульт и прокси для телефона, приставки, ТВ',
    ...extra('lan'),
    icon: Network,
    initial: 'on',
    keywords: 'раздача локальная сеть телефон приставка телевизор пульт lan'
  },
  {
    id: 'discord',
    group: 'play',
    title: 'Статус в Discord',
    desc: 'Строка «Играет в LAZEYKA» в профиле',
    ...extra('discord'),
    icon: Discord,
    initial: 'on',
    keywords: 'discord дискорд статус профиль'
  },
  {
    id: 'prematch',
    group: 'play',
    title: 'Перед каткой',
    desc: 'Замер пинга и потерь до сервера игры',
    ...extra('prematch'),
    icon: Crosshair,
    initial: 'on',
    keywords: 'перед каткой пинг потери сервер игра матч'
  }
]

/** Действия, доступные на этой системе (на macOS нет Telegram-прокси). */
export const ACTIONS: ScenarioAction[] = ALL.filter((a) => !(isMac && a.id === 'tgws'))

export const ACTION_BY_ID = Object.fromEntries(ALL.map((a) => [a.id, a])) as Record<ActionId, ScenarioAction>

/** Текущее значение действия в сценарии; 'keep' — шага нет. */
export function getValue(s: FullScenario, id: ActionId): string {
  const v = (s as unknown as Record<string, unknown>)[id]
  return typeof v === 'string' && v ? v : 'keep'
}

/** Новое значение действия. Для полей 1.3.0 «не трогать» не записывается (как раньше). */
export function setValue(s: FullScenario, id: ActionId, v: string): FullScenario {
  if (id === 'streamer' || id === 'mini' || id === 'lan' || id === 'prematch' || id === 'discord')
    return { ...s, [id]: v === 'keep' ? undefined : v }
  return { ...s, [id]: v } as FullScenario
}

/**
 * Шаги сценария в порядке выполнения: сначала свой порядок (`order`, задаётся перетаскиванием),
 * остальные — в порядке по умолчанию (как в главном процессе: orderedStepKeys).
 */
export function stepsOf(s: FullScenario): ActionId[] {
  const active = ACTIONS.filter((a) => getValue(s, a.id) !== 'keep').map((a) => a.id)
  const own = (Array.isArray(s.order) ? s.order : []).filter((k): k is ActionId => active.includes(k as ActionId))
  return [...own, ...active.filter((id) => !own.includes(id))]
}

/** Записать порядок шагов (после перетаскивания или добавления шага в конец). */
export function withOrder(s: FullScenario, ids: ActionId[]): FullScenario {
  return { ...s, order: ids.length ? [...ids] : undefined }
}

export interface Ctx {
  nodes: IncyNode[]
  dns: DohProvider[]
}

export interface StepChip {
  id: ActionId
  label: string
  /** Подробность после названия: стратегия, узел, режим. */
  detail?: string
  tone: 'on' | 'off' | 'neutral'
  sensitive?: string
}

function strategyTitle(file: string): string {
  return file.replace(/\.bat$/i, '')
}

/** Короткие подписи шагов для плитки: «Zapret · general», «VPN выкл.» … */
export function chipsOf(s: FullScenario, ctx: Ctx): StepChip[] {
  const out: StepChip[] = []
  for (const id of stepsOf(s)) {
    const a = ACTION_BY_ID[id]
    const v = getValue(s, id)
    const opt = a.options.find((o) => o.value === v)
    const tone = opt?.tone ?? 'on'
    const short = id === 'incy' ? 'VPN' : id === 'tgws' ? 'Telegram' : id === 'discord' ? 'Discord' : a.title
    if (id === 'dns') {
      out.push({
        id,
        label: 'DNS',
        detail: v === 'dhcp' ? 'стандартный' : (ctx.dns.find((d) => d.id === v)?.name ?? v),
        tone: 'neutral'
      })
      continue
    }
    if (tone === 'off') {
      out.push({ id, label: short, detail: id === 'prematch' ? 'завершить' : id === 'mini' ? 'скрыть' : 'выкл.', tone })
      continue
    }
    let detail: string | undefined
    let sensitive: string | undefined
    if (id === 'zapret' && s.zapretStrategy) detail = strategyTitle(s.zapretStrategy)
    if (id === 'exitlag' && s.exitlagApps?.length) detail = `${s.exitlagApps.length} прил.`
    if (id === 'incy' && s.incyNodeId) {
      detail = ctx.nodes.find((n) => n.id === s.incyNodeId)?.name ?? 'свой узел'
      sensitive = 'node'
    }
    if (id === 'mini') detail = v === 'panel' ? 'панель' : 'индикатор'
    if (id === 'streamer' && v === 'auto') detail = 'авто'
    if (id === 'prematch') detail = 'начать'
    out.push({ id, label: short, detail, tone, sensitive })
  }
  return out
}

export const BLANK: FullScenario = {
  id: '',
  name: '',
  emoji: '⚡',
  zapret: 'keep',
  incy: 'keep',
  exitlag: 'keep',
  tgws: 'keep',
  dns: 'keep'
}

export interface Template {
  key: string
  /** Для кого и когда — одна строка в выборе шаблона. */
  about: string
  build: (strategies: { file: string; title: string }[]) => FullScenario
}

const tg = (v: 'on' | 'off'): 'on' | 'off' | 'keep' => (isMac ? 'keep' : v)

/** Готовые сценарии из существующих действий. Ничего не запускают сами: открываются в конструкторе. */
export const TEMPLATES: Template[] = [
  {
    key: 'prematch',
    about: 'Обход для Discord, VPN для игры, замер пинга и индикатор поверх',
    build: () => ({
      ...BLANK,
      name: 'Перед каткой',
      emoji: '🎯',
      zapret: 'on',
      exitlag: 'on',
      prematch: 'on',
      mini: 'indicator',
      discord: 'on'
    })
  },
  {
    key: 'stream',
    about: 'Скрыть адреса от зрителей, держать панель служб под рукой',
    build: () => ({ ...BLANK, name: 'Стрим', emoji: '🎬', zapret: 'on', tgws: tg('on'), streamer: 'on', mini: 'panel' })
  },
  {
    key: 'discord',
    about: 'Только обход для Discord, VPN и ExitLag выключены',
    build: (st) => ({
      ...BLANK,
      name: 'Только Discord',
      emoji: '💬',
      zapret: 'on',
      zapretStrategy: st.find((x) => /discord/i.test(x.file))?.file,
      incy: 'off',
      exitlag: 'off'
    })
  },
  {
    key: 'work',
    about: 'Обход, VPN и Telegram для обычного дня',
    build: () => ({ ...BLANK, name: 'Работа', emoji: '💼', zapret: 'on', incy: 'on', tgws: tg('on') })
  },
  {
    key: 'console',
    about: 'Раздать обход на приставку, телефон или телевизор',
    build: () => ({ ...BLANK, name: 'Приставка', emoji: '🕹️', zapret: 'on', lan: 'on' })
  },
  {
    key: 'off',
    about: 'Выключить службы и убрать мини-окно одной кнопкой',
    build: () => ({
      ...BLANK,
      name: 'Всё выключить',
      emoji: '🌙',
      zapret: 'off',
      incy: 'off',
      exitlag: 'off',
      tgws: tg('off'),
      mini: 'hide'
    })
  }
]
