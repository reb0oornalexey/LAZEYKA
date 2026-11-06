/**
 * Сценарий, запущенный горячей клавишей (из main), — та же отметка и
 * уведомление, что и при нажатии кнопки на вкладке «Сценарии».
 */
import { toast } from 'sonner'
import { POWER_ON_BANNER_STYLE } from '@renderer/lib/utils'

export const SCENARIO_LAST_KEY = 'lazeyka.scenarioLastRun'
export const SCENARIO_EVENT = 'lazeyka:scenario'

interface Applied {
  id: string
  name: string
  emoji: string
  ok: boolean
  at: number
  steps: { what: string; ok: boolean; message?: string }[]
}

export type ScenarioEventDetail = { kind: 'running'; id: string } | { kind: 'applied'; id: string; at: number; ok: boolean }

function emit(d: ScenarioEventDetail): void {
  window.dispatchEvent(new CustomEvent<ScenarioEventDetail>(SCENARIO_EVENT, { detail: d }))
}

export function installScenarioEvents(): void {
  try {
    window.electron.ipcRenderer.on('scenario:running', (_e, id: string) => emit({ kind: 'running', id }))
    window.electron.ipcRenderer.on('scenario:applied', (_e, a: Applied) => {
      const lr = { id: a.id, at: a.at, ok: a.ok }
      try {
        localStorage.setItem(SCENARIO_LAST_KEY, JSON.stringify(lr))
      } catch {
        /* noop */
      }
      emit({ kind: 'applied', ...lr })
      const bad = a.steps.filter((x) => !x.ok)
      if (bad.length) {
        toast.error(`«${a.name}»: не всё получилось`, { description: bad.map((b) => `${b.what}: ${b.message ?? ''}`).join('\n'), duration: 12000 })
      } else {
        toast.success(`${a.emoji} ${a.name} — готово (горячая клавиша)`, {
          description: a.steps.map((x) => `${x.what}: ${x.message ?? 'ок'}`).join(' · '),
          style: POWER_ON_BANNER_STYLE
        })
      }
    })
  } catch {
    /* нет моста */
  }
}
