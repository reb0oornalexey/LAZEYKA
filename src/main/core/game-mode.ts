import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { patchAppConfig } from '../config'
import { getGameFilterMode, setGameFilterMode, type GameFilterMode } from './zapret-service-settings'
import { showSystemNotification } from '../utils/notifications'

const execAsync = promisify(exec)

export interface GameModeStatus {
  enabled: boolean
  activeGameDetected: string | null
  originalFilterMode: GameFilterMode
}

const TARGET_GAME_PROCESSES: { name: string; title: string }[] = [
  { name: 'Discord.exe', title: 'Discord' },
  { name: 'DiscordPTB.exe', title: 'Discord PTB' },
  { name: 'DiscordCanary.exe', title: 'Discord Canary' },
  { name: 'steam.exe', title: 'Steam' },
  { name: 'cs2.exe', title: 'Counter-Strike 2' },
  { name: 'VALORANT-Win64-Shipping.exe', title: 'Valorant' },
  { name: 'dota2.exe', title: 'Dota 2' },
  { name: 'r5apex.exe', title: 'Apex Legends' },
  { name: 'Overwatch.exe', title: 'Overwatch 2' },
  { name: 'GTA5.exe', title: 'Grand Theft Auto V' },
  { name: 'FortniteClient-Win64-Shipping.exe', title: 'Fortnite' },
  { name: 'RobloxPlayerBeta.exe', title: 'Roblox' },
  { name: 'LeagueClient.exe', title: 'League of Legends' }
]

let timer: NodeJS.Timeout | null = null
let activeGame: string | null = null
let savedPreviousMode: GameFilterMode = 'off'

async function checkRunningProcesses(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('tasklist /FO CSV /NH', { windowsHide: true })
    return stdout.toLowerCase().split(/\r?\n/)
  } catch {
    return []
  }
}

export async function runGameModeWatcherCycle(): Promise<void> {
  // The live timer IS the enabled state. This used to read
  // `cfg.smartGameModeEnabled`, a field that was never declared in AppConfig
  // and never written — so every scheduled cycle returned here and the game
  // mode never actually flipped the Game Filter, despite the UI showing it on.
  if (!timer) return

  const taskList = await checkRunningProcesses()
  const matched = TARGET_GAME_PROCESSES.find((g) =>
    taskList.some((line) => line.includes(`"${g.name.toLowerCase()}"`))
  )

  const currentMode = getGameFilterMode()

  if (matched && !activeGame) {
    activeGame = matched.title
    savedPreviousMode = currentMode
    if (currentMode !== 'all') {
      await setGameFilterMode('all')
      showSystemNotification('Игровой режим LAZEYKA', `Обнаружена игра: ${matched.title}. Game Filter включен (TCP + UDP).`)
    }
  } else if (!matched && activeGame) {
    const old = activeGame
    activeGame = null
    if (currentMode !== savedPreviousMode) {
      await setGameFilterMode(savedPreviousMode)
      showSystemNotification('Игровой режим LAZEYKA', `${old} закрыта. Game Filter возвращён в исходный режим.`)
    }
  }
}

/**
 * Start or stop the game watcher. `persist = false` is used when restoring the
 * saved state at boot so the restore doesn't rewrite the config it just read.
 */
export function setGameModeWatcher(enabled: boolean, persist = true): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  if (enabled) {
    savedPreviousMode = getGameFilterMode()
    timer = setInterval(() => {
      void runGameModeWatcherCycle()
    }, 8000)
    void runGameModeWatcherCycle()
  } else {
    // Turning the watcher off while a game is running would otherwise strand
    // the Game Filter in "all" forever — restore what we found before.
    if (activeGame && getGameFilterMode() !== savedPreviousMode) {
      void setGameFilterMode(savedPreviousMode).catch(() => void 0)
    }
    activeGame = null
  }

  if (!persist) return
  void (async () => {
    try {
      await patchAppConfig({ smartGameModeEnabled: enabled })
    } catch { /* noop */ }
  })()
}

/**
 * Re-arm the watcher at startup if the user left it on. Called from
 * main/index.ts once the config is loaded.
 */
export function restoreGameModeFromConfig(cfg: AppConfig): void {
  if (!cfg.smartGameModeEnabled) return
  setGameModeWatcher(true, false)
}

export function getGameModeStatus(): GameModeStatus {
  return {
    enabled: Boolean(timer),
    activeGameDetected: activeGame,
    originalFilterMode: savedPreviousMode
  }
}
