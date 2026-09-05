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

/**
 * За чем следим.
 *
 * `kind` важнее, чем кажется. Steam и Discord запущены почти всегда, когда
 * человек играет, и раньше поиск брал первое совпадение по порядку массива —
 * а Steam стоял выше игр. Из-за этого при запущенной CS2 на экране всё равно
 * значился «Steam», и выглядело так, будто игры не определяются вовсе.
 * Теперь игра всегда перебивает лаунчер и мессенджер.
 */
type TargetKind = 'game' | 'app'

const TARGET_GAME_PROCESSES: { name: string; title: string; kind: TargetKind }[] = [
  // ---- Игры ---------------------------------------------------------------
  { name: 'cs2.exe', title: 'Counter-Strike 2', kind: 'game' },
  { name: 'csgo.exe', title: 'Counter-Strike: GO', kind: 'game' },
  { name: 'dota2.exe', title: 'Dota 2', kind: 'game' },
  { name: 'VALORANT-Win64-Shipping.exe', title: 'Valorant', kind: 'game' },
  { name: 'r5apex.exe', title: 'Apex Legends', kind: 'game' },
  { name: 'r5apex_dx12.exe', title: 'Apex Legends', kind: 'game' },
  { name: 'Overwatch.exe', title: 'Overwatch 2', kind: 'game' },
  { name: 'GTA5.exe', title: 'Grand Theft Auto V', kind: 'game' },
  { name: 'GTA5_Enhanced.exe', title: 'Grand Theft Auto V', kind: 'game' },
  { name: 'RDR2.exe', title: 'Red Dead Redemption 2', kind: 'game' },
  { name: 'FortniteClient-Win64-Shipping.exe', title: 'Fortnite', kind: 'game' },
  { name: 'RobloxPlayerBeta.exe', title: 'Roblox', kind: 'game' },
  { name: 'LeagueClient.exe', title: 'League of Legends', kind: 'game' },
  { name: 'League of Legends.exe', title: 'League of Legends', kind: 'game' },
  { name: 'RustClient.exe', title: 'Rust', kind: 'game' },
  { name: 'PUBG.exe', title: 'PUBG', kind: 'game' },
  { name: 'TslGame.exe', title: 'PUBG', kind: 'game' },
  { name: 'DeadByDaylight-Win64-Shipping.exe', title: 'Dead by Daylight', kind: 'game' },
  { name: 'EscapeFromTarkov.exe', title: 'Escape from Tarkov', kind: 'game' },
  { name: 'Warframe.x64.exe', title: 'Warframe', kind: 'game' },
  { name: 'destiny2.exe', title: 'Destiny 2', kind: 'game' },
  { name: 'ModernWarfare.exe', title: 'Call of Duty', kind: 'game' },
  { name: 'cod.exe', title: 'Call of Duty', kind: 'game' },
  { name: 'bf2042.exe', title: 'Battlefield 2042', kind: 'game' },
  { name: 'Minecraft.Windows.exe', title: 'Minecraft', kind: 'game' },
  { name: 'javaw.exe', title: 'Minecraft (Java)', kind: 'game' },
  { name: 'WorldOfTanks.exe', title: 'Мир танков', kind: 'game' },
  { name: 'WoT.exe', title: 'Мир танков', kind: 'game' },
  { name: 'Wow.exe', title: 'World of Warcraft', kind: 'game' },
  { name: 'FactoryGame-Win64-Shipping.exe', title: 'Satisfactory', kind: 'game' },
  { name: 'Palworld-Win64-Shipping.exe', title: 'Palworld', kind: 'game' },
  { name: 'HD2.exe', title: 'Helldivers 2', kind: 'game' },
  { name: 'helldivers2.exe', title: 'Helldivers 2', kind: 'game' },
  { name: 'Marvel-Win64-Shipping.exe', title: 'Marvel Rivals', kind: 'game' },
  { name: 'DeltaForceClient-Win64-Shipping.exe', title: 'Delta Force', kind: 'game' },
  { name: 'FiveM.exe', title: 'FiveM', kind: 'game' },
  { name: 'FiveM_GTAProcess.exe', title: 'FiveM', kind: 'game' },
  { name: 'RainbowSix.exe', title: 'Rainbow Six Siege', kind: 'game' },
  { name: 'RainbowSix_BE.exe', title: 'Rainbow Six Siege', kind: 'game' },
  { name: 'RocketLeague.exe', title: 'Rocket League', kind: 'game' },
  { name: 'gta_sa.exe', title: 'GTA: San Andreas', kind: 'game' },
  { name: 'samp.exe', title: 'SA-MP', kind: 'game' },

  // ---- Лаунчеры и голосовое общение --------------------------------------
  // Тоже включают фильтр — Discord без него часто немой, — но игрой не
  // считаются и в названии проигрывают любой запущенной игре.
  { name: 'Discord.exe', title: 'Discord', kind: 'app' },
  { name: 'DiscordPTB.exe', title: 'Discord PTB', kind: 'app' },
  { name: 'DiscordCanary.exe', title: 'Discord Canary', kind: 'app' },
  { name: 'steam.exe', title: 'Steam', kind: 'app' },
  { name: 'EpicGamesLauncher.exe', title: 'Epic Games', kind: 'app' },
  { name: 'Battle.net.exe', title: 'Battle.net', kind: 'app' },
  { name: 'RiotClientServices.exe', title: 'Riot Client', kind: 'app' }
]

let timer: NodeJS.Timeout | null = null
/** Процесс, из-за которого сейчас включён фильтр (не название — оно неуникально). */
let activeProcess: string | null = null
let activeGame: string | null = null
let savedPreviousMode: GameFilterMode = 'off'

/**
 * Имена запущенных процессов.
 *
 * Раньше строки CSV просто искались подстрокой `"имя.exe"`. Это ломалось на
 * длинных именах: `tasklist` укорачивает колонку с именем образа, и
 * `FortniteClient-Win64-Shipping.exe` в выводе выглядит обрезанным — точного
 * совпадения не случалось никогда. Теперь имя вынимается из первого поля CSV,
 * а сравнение терпит обрезку.
 */
async function checkRunningProcesses(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('tasklist /FO CSV /NH', {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    })
    const names: string[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"/)
      if (m) names.push(m[1].toLowerCase())
    }
    return names
  } catch {
    return []
  }
}

/** Запущен ли процесс с таким именем, с поправкой на обрезку имени в tasklist. */
function isRunning(running: string[], name: string): boolean {
  const wanted = name.toLowerCase()
  return running.some((got) => got === wanted || (got.length < wanted.length && wanted.startsWith(got)))
}

export async function runGameModeWatcherCycle(): Promise<void> {
  // The live timer IS the enabled state. This used to read
  // `cfg.smartGameModeEnabled`, a field that was never declared in AppConfig
  // and never written — so every scheduled cycle returned here and the game
  // mode never actually flipped the Game Filter, despite the UI showing it on.
  if (!timer) return

  const running = await checkRunningProcesses()
  const found = TARGET_GAME_PROCESSES.filter((g) => isRunning(running, g.name))
  // Игра важнее лаунчера: при запущенных Steam и CS2 показать надо CS2.
  const matched = found.find((g) => g.kind === 'game') ?? found[0] ?? null

  const currentMode = getGameFilterMode()

  if (matched && !activeProcess) {
    activeProcess = matched.name
    activeGame = matched.title
    savedPreviousMode = currentMode
    if (currentMode !== 'all') {
      await setGameFilterMode('all')
      showSystemNotification('Игровой режим LAZEYKA', `Обнаружена игра: ${matched.title}. Game Filter включен (TCP + UDP).`)
    }
    return
  }

  // Победитель сменился: запустили игру поверх работающего Steam или,
  // наоборот, закрыли игру, а лаунчер остался. Фильтр уже включён и трогать
  // его незачем — но показывать надо то, что происходит сейчас.
  if (matched && activeProcess && matched.name !== activeProcess) {
    const previous = activeGame
    activeProcess = matched.name
    activeGame = matched.title
    if (previous !== matched.title && matched.kind === 'game') {
      showSystemNotification('Игровой режим LAZEYKA', `Обнаружена игра: ${matched.title}.`)
    }
    return
  }

  if (!matched && activeProcess) {
    const old = activeGame
    activeProcess = null
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
    if (activeProcess && getGameFilterMode() !== savedPreviousMode) {
      void setGameFilterMode(savedPreviousMode).catch(() => void 0)
    }
    activeProcess = null
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
