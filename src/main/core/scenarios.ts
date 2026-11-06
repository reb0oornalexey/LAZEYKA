/**
 * Сценарии — набор действий одной кнопкой: «Игры», «Работа», «Кино»…
 *
 * Каждый пункт сценария либо «не трогать», либо включить/выключить
 * компонент (с выбором стратегии Zapret, узла INCY, списка ExitLag, DNS).
 * Применяется по порядку: DNS → Zapret → ExitLag-настройки → INCY → Telegram,
 * ошибка одного шага не мешает остальным — в ответе список того, что вышло.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import { getAppConfig, patchAppConfig } from '../config'
import { getZapretStatus, restartZapret, startZapret, stopZapret } from './zapret'
import { getTgwsStatus, startTgws, stopTgws } from './tgws'
import { connectIncyNode, disconnectIncy, getIncyStatus, loadIncySettings, patchIncySettings } from './incy-engine'
import { applySystemDns } from './dns-doh'

export type Toggle = 'keep' | 'on' | 'off'

export interface Scenario {
  id: string
  name: string
  emoji: string
  /** Свой значок: data:URL картинки (из программы/игры) или «lucide:Имя» — системный. Пусто — эмодзи. */
  icon?: string
  zapret: Toggle
  zapretStrategy?: string
  incy: Toggle
  /** Узел для «on»; пусто — выбранный сейчас. */
  incyNodeId?: string
  exitlag: Toggle
  /** Приложения ExitLag для «on»; пусто — текущий список. */
  exitlagApps?: string[]
  tgws: Toggle
  /** 'keep' | 'dhcp' | id сервера DNS. */
  dns: string
  /** Горячая клавиша запуска сценария (Electron accelerator). */
  hotkey?: string
}

export interface ScenarioStep {
  what: string
  ok: boolean
  message?: string
}

function file(): string {
  return path.join(dataDir(), 'scenarios.json')
}

export function listScenarios(): Scenario[] {
  try {
    if (!existsSync(file())) return []
    const j = JSON.parse(readFileSync(file(), 'utf-8')) as Scenario[]
    return Array.isArray(j) ? j.filter((s) => s && s.id && s.name) : []
  } catch {
    return []
  }
}

function write(list: Scenario[]): Scenario[] {
  mkdirSync(path.dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(list, null, 2), 'utf-8')
  return list
}

export function saveScenario(s: Scenario): Scenario[] {
  const clean: Scenario = {
    ...s,
    id: s.id || `sc-${Date.now().toString(36)}`,
    name: String(s.name || 'Сценарий').slice(0, 40),
    emoji: String(s.emoji || '⚡').slice(0, 4),
    // Картинка — не больше ~200 КБ (значок 64×64 весит единицы КБ).
    icon:
      typeof s.icon === 'string' && (s.icon.startsWith('lucide:') || (s.icon.startsWith('data:image/') && s.icon.length < 200_000))
        ? s.icon
        : undefined
  }
  const list = listScenarios()
  const i = list.findIndex((x) => x.id === clean.id)
  if (i >= 0) list[i] = clean
  else list.push(clean)
  return write(list)
}

export function deleteScenario(id: string): Scenario[] {
  return write(listScenarios().filter((s) => s.id !== id))
}

async function step(steps: ScenarioStep[], what: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const msg = await fn()
    steps.push({ what, ok: true, message: msg || undefined })
  } catch (e) {
    steps.push({ what, ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}

export async function applyScenario(id: string): Promise<ScenarioStep[]> {
  const s = listScenarios().find((x) => x.id === id)
  if (!s) throw new Error('Сценарий не найден')
  const steps: ScenarioStep[] = []

  if (s.dns && s.dns !== 'keep') {
    await step(steps, 'DNS', async () => {
      const r = await applySystemDns(s.dns)
      if (!r.success) throw new Error(r.message)
      return r.message
    })
  }

  if (s.zapret !== 'keep') {
    await step(steps, 'Zapret', async () => {
      const running = getZapretStatus().state === 'running'
      if (s.zapret === 'off') {
        if (running) await stopZapret()
        return 'выключен'
      }
      const cfg = await getAppConfig()
      const changed = Boolean(s.zapretStrategy) && cfg.zapret?.activeStrategy !== s.zapretStrategy
      if (changed && cfg.zapret) await patchAppConfig({ zapret: { ...cfg.zapret, activeStrategy: s.zapretStrategy } })
      if (running && changed) await restartZapret()
      else if (!running) await startZapret()
      return s.zapretStrategy ? `стратегия ${s.zapretStrategy}` : 'включён'
    })
  }

  if (s.exitlag !== 'keep') {
    await step(steps, 'ExitLag', async () => {
      const cur = loadIncySettings()
      const patch: Record<string, unknown> = { perAppProxy: s.exitlag === 'on' }
      if (s.exitlag === 'on') {
        patch.perAppMode = 'proxy_only'
        if (s.exitlagApps?.length) patch.perAppProcesses = s.exitlagApps
      }
      patchIncySettings(patch as never)
      return s.exitlag === 'on'
        ? `VPN только для: ${(s.exitlagApps?.length ? s.exitlagApps : cur.perAppProcesses ?? []).join(', ') || 'список пуст'}`
        : 'выключен'
    })
  }

  if (s.incy !== 'keep') {
    await step(steps, 'INCY', async () => {
      const st = getIncyStatus()
      if (s.incy === 'off') {
        if (st.state === 'running' || st.state === 'connecting') await disconnectIncy()
        return 'отключён'
      }
      const target = s.incyNodeId || undefined
      if (st.state === 'running' && (!target || st.activeNodeId === target)) return 'уже подключён'
      const r = await connectIncyNode(target)
      if (r.state !== 'running') throw new Error(r.lastError || 'не удалось подключиться')
      return 'подключён'
    })
  }

  if (s.tgws !== 'keep' && process.platform !== 'darwin') {
    await step(steps, 'Telegram', async () => {
      const running = getTgwsStatus().state === 'running'
      if (s.tgws === 'on' && !running) await startTgws()
      if (s.tgws === 'off' && running) await stopTgws()
      return s.tgws === 'on' ? 'включён' : 'выключен'
    })
  }

  return steps
}
