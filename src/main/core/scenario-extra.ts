/**
 * Применение действий сценария из версии 1.3.0 (см. scenario-extra-logic.ts).
 * Каждое действие — отдельный шаг со своим итогом; ошибка одного не мешает остальным.
 */
import { appLog } from '../utils/app-logger'
import { applyStreamerModeFromScenario, setDiscordFromScenario } from './streamer'
import { applyMiniFromScenario } from './mini-window'
import { setLanEnabledFromScenario } from './lan-hub'
import { prematchScenarioInfo, startSessionFromScenario, stopSessionFromScenario } from './prematch'
import { EXTRA_KEYS, normalizeExtra, prematchPlan, type ScenarioExtra } from './scenario-extra-logic'

export interface ExtraStep {
  what: string
  ok: boolean
  message?: string
}

async function run(steps: ExtraStep[], what: string, fn: () => Promise<string>): Promise<void> {
  try {
    steps.push({ what, ok: true, message: (await fn()) || undefined })
  } catch (e) {
    steps.push({ what, ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

/** Один шаг 1.3.0 по ключу (для своего порядка шагов). Нет значения в сценарии — шага нет. */
export async function applyExtraStep(key: (typeof EXTRA_KEYS)[number], raw: unknown, steps: ExtraStep[]): Promise<void> {
  const s: ScenarioExtra = normalizeExtra(raw)
  if (key === 'streamer') {
    if (s.streamer) {
      const mode = s.streamer
      await run(steps, 'Режим стримера', async () => {
        applyStreamerModeFromScenario(mode)
        return mode === 'on' ? 'включён' : mode === 'off' ? 'выключен' : 'авто'
      })
    }
    return
  }
  if (key === 'mini') {
    if (s.mini) {
      const m = s.mini
      await run(steps, 'Мини-окно', async () => {
        applyMiniFromScenario(m)
        return m === 'panel' ? 'панель' : m === 'indicator' ? 'индикатор' : 'скрыто'
      })
    }
    return
  }
  if (key === 'lan') {
    if (s.lan) {
      const want = s.lan === 'on'
      await run(steps, 'Раздача в сети', async () => {
        const changed = await setLanEnabledFromScenario(want)
        if (!changed) return want ? 'уже включена' : 'уже выключена'
        return want ? 'включена' : 'выключена'
      })
    }
    return
  }
  if (key === 'discord') {
    if (s.discord) {
      const want = s.discord === 'on'
      await run(steps, 'Статус в Discord', async () => {
        setDiscordFromScenario(want)
        return want ? 'включён' : 'выключен'
      })
    }
    return
  }
  if (key === 'prematch') {
    if (s.prematch) {
      const want = s.prematch
      await run(steps, 'Перед каткой', async () => {
        const info = prematchScenarioInfo()
        const target = info.target
        const plan = prematchPlan(want, info.active, target)
        switch (plan) {
          case 'start':
            await startSessionFromScenario(target)
            return 'сессия начата'
          case 'stop':
            stopSessionFromScenario()
            return 'сессия завершена'
          case 'already-on':
            return 'сессия уже идёт'
          case 'already-off':
            return 'сессии нет'
          case 'skip-no-target':
            appLog('info', '[сценарии] «Перед каткой» пропущено: цель не задана')
            return 'пропущено: цель не задана на вкладке «Перед каткой»'
        }
      })
    }
    return
  }
}

/** Все шаги 1.3.0 в порядке по умолчанию: стример → мини-окно → раздача → Discord → «Перед каткой». */
export async function applyExtraSteps(raw: unknown): Promise<ExtraStep[]> {
  const steps: ExtraStep[] = []
  for (const k of ['streamer', 'mini', 'lan', 'discord', 'prematch'] as const) await applyExtraStep(k, raw, steps)
  return steps
}
