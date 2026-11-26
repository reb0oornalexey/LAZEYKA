/**
 * Действия сценариев версии 1.3.0 (режим стримера, мини-окно, раздача в сети, «Перед каткой», Discord).
 * Поле отсутствует или равно 'keep' — «не трогать», так читаются и сохранённые раньше сценарии.
 * Те же значения разбирает src/main/core/scenario-extra-logic.ts.
 */
import type { Scenario } from '@renderer/utils/ipc'

export type ExtraKey = 'streamer' | 'mini' | 'lan' | 'prematch' | 'discord'

export interface ScenarioExtraFields {
  streamer?: 'keep' | 'on' | 'off' | 'auto'
  mini?: 'keep' | 'panel' | 'indicator' | 'hide'
  lan?: 'keep' | 'on' | 'off'
  prematch?: 'keep' | 'on' | 'off'
  discord?: 'keep' | 'on' | 'off'
}

export type FullScenario = Scenario & ScenarioExtraFields

export interface ExtraRow {
  key: ExtraKey
  title: string
  hint: string
  options: { value: string; label: string; tone?: 'on' | 'off' }[]
}

const KEEP = { value: 'keep', label: 'Не трогать' }

export const EXTRA_ROWS: ExtraRow[] = [
  {
    key: 'streamer',
    title: 'Режим стримера',
    hint: 'Размывает на экране IP-адреса, названия узлов и ссылки подписок, чтобы зрители их не увидели. «Авто» держит режим включённым, пока запущен OBS или другая программа для стримов.',
    options: [KEEP, { value: 'on', label: 'Включить', tone: 'on' }, { value: 'off', label: 'Выключить', tone: 'off' }, { value: 'auto', label: 'Авто' }]
  },
  {
    key: 'mini',
    title: 'Мини-окно',
    hint: 'Маленькое окно поверх остальных. «Панель» — переключатели служб и пинг, «Индикатор» — только включённое зелёными точками. «Скрыть» закрывает окно.',
    options: [KEEP, { value: 'panel', label: 'Панель', tone: 'on' }, { value: 'indicator', label: 'Индикатор', tone: 'on' }, { value: 'hide', label: 'Скрыть', tone: 'off' }]
  },
  {
    key: 'lan',
    title: 'Раздача в локальной сети',
    hint: 'Включает раздел «Локальная сеть»: пульт и прокси для других устройств в вашей сети. При первом включении Windows может спросить про брандмауэр.',
    options: [KEEP, { value: 'on', label: 'Включить', tone: 'on' }, { value: 'off', label: 'Выключить', tone: 'off' }]
  },
  {
    key: 'prematch',
    title: 'Сессия «Перед каткой»',
    hint: 'Начинает или завершает замер пинга и потерь до сервера игры. Нужна цель, заданная на вкладке «Перед каткой»; если её нет, шаг пропускается и это записывается в журнал.',
    options: [KEEP, { value: 'on', label: 'Начать', tone: 'on' }, { value: 'off', label: 'Завершить', tone: 'off' }]
  },
  {
    key: 'discord',
    title: 'Статус в Discord',
    hint: 'Строка «Играет в LAZEYKA» в вашем профиле Discord. «Выключить» сразу убирает её.',
    options: [KEEP, { value: 'on', label: 'Включить', tone: 'on' }, { value: 'off', label: 'Выключить', tone: 'off' }]
  }
]

const LABEL: Record<ExtraKey, Record<string, string>> = {
  streamer: { on: 'Режим стримера', off: 'Режим стримера выкл.', auto: 'Режим стримера · авто' },
  mini: { panel: 'Мини-окно · панель', indicator: 'Мини-окно · индикатор', hide: 'Мини-окно скрыть' },
  lan: { on: 'Раздача в сети', off: 'Раздача в сети выкл.' },
  prematch: { on: 'Перед каткой: начать', off: 'Перед каткой: завершить' },
  discord: { on: 'Discord', off: 'Discord выкл.' }
}

/** Подписи для плашек карточки сценария. */
export function describeExtra(s: ScenarioExtraFields): string[] {
  const out: string[] = []
  for (const row of EXTRA_ROWS) {
    const v = s[row.key]
    if (v && v !== 'keep' && LABEL[row.key][v]) out.push(LABEL[row.key][v])
  }
  return out
}
