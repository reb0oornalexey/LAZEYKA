import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import { getAppConfig, patchAppConfig } from '../config'
import { zapretBundleDir } from '../utils/dirs'
import { getActiveFakesState, setActiveFake, setGameFilterMode, setIpsetFilterMode } from './zapret-service-settings'

export interface LazeykaProfileBundle {
  format: 'lazeyka-profile'
  version: 1 | 2
  exportedAt: number
  appName: 'LAZEYKA'
  config: AppConfig
  hostListContent?: string
  lists?: Record<string, string>
  activeDiscordFake?: string | null
  activeGameFake?: string | null
}

export async function exportLazeykaProfile(): Promise<{ success: boolean; filePath?: string; message?: string }> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт настроек LAZEYKA',
    defaultPath: `lazeyka-backup-${new Date().toISOString().slice(0, 10)}.lazeyka`,
    filters: [
      { name: 'LAZEYKA Profile (*.lazeyka)', extensions: ['lazeyka'] },
      { name: 'JSON Backup (*.json)', extensions: ['json'] }
    ]
  })

  if (canceled || !filePath) {
    return { success: false, message: 'Отменено пользователем' }
  }

  const config = await getAppConfig()
  const listsMap: Record<string, string> = {}

  const listsDir = path.join(zapretBundleDir(), 'lists')
  if (existsSync(listsDir)) {
    try {
      const files = readdirSync(listsDir)
      for (const file of files) {
        if (file.endsWith('.txt')) {
          try {
            listsMap[file] = readFileSync(path.join(listsDir, file), 'utf-8')
          } catch { /* ignore single file read errors */ }
        }
      }
    } catch { /* ignore dir error */ }
  }

  const fakes = getActiveFakesState()

  const bundle: LazeykaProfileBundle = {
    format: 'lazeyka-profile',
    version: 2,
    exportedAt: Date.now(),
    appName: 'LAZEYKA',
    config,
    hostListContent: listsMap['list-general.txt'] || '',
    lists: listsMap,
    activeDiscordFake: fakes.discordActive,
    activeGameFake: fakes.gameActive
  }

  writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8')
  return { success: true, filePath, message: 'Профиль успешно экспортирован' }
}

export async function importLazeykaProfile(): Promise<{ success: boolean; message: string }> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Импорт настроек LAZEYKA',
    filters: [
      { name: 'LAZEYKA Profile (*.lazeyka, *.json)', extensions: ['lazeyka', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (canceled || filePaths.length === 0) {
    return { success: false, message: 'Отменено пользователем' }
  }

  const target = filePaths[0]
  let content: string
  try {
    content = readFileSync(target, 'utf-8')
  } catch (e: any) {
    throw new Error(`Не удалось прочитать файл: ${e.message || String(e)}`)
  }

  let bundle: any
  try {
    bundle = JSON.parse(content)
  } catch {
    throw new Error('Файл поврежден или имеет неверный формат JSON')
  }

  // `!bundle.config` оставлен как запасной признак: файл без метки формата, но
  // с секцией конфига — это профиль, просто сохранённый очень старой версией.
  if (bundle.format !== 'lazeyka-profile' && !bundle.config) {
    throw new Error('Выбранный файл не является профилем LAZEYKA')
  }

  // 1. Restore config
  if (bundle.config) {
    await patchAppConfig(bundle.config)
  }

  // 2. Restore hostlists
  const listsDir = path.join(zapretBundleDir(), 'lists')
  if (!existsSync(listsDir)) {
    try { mkdirSync(listsDir, { recursive: true }) } catch { /* ignore */ }
  }

  if (bundle.lists && typeof bundle.lists === 'object') {
    for (const [filename, listData] of Object.entries(bundle.lists)) {
      if (typeof listData === 'string' && filename.endsWith('.txt')) {
        try {
          writeFileSync(path.join(listsDir, filename), listData, 'utf-8')
        } catch (e) {
          console.warn(`[profile-manager] Failed to restore list ${filename}:`, e)
        }
      }
    }
  } else if (typeof bundle.hostListContent === 'string') {
    const listPath = path.join(listsDir, 'list-general.txt')
    try {
      writeFileSync(listPath, bundle.hostListContent, 'utf-8')
    } catch { /* ignore */ }
  }

  // 3. Restore fakes
  if (bundle.activeDiscordFake) {
    try { setActiveFake('discord', bundle.activeDiscordFake) } catch { /* ignore */ }
  }
  if (bundle.activeGameFake) {
    try { setActiveFake('game', bundle.activeGameFake) } catch { /* ignore */ }
  }

  // 4. Restore filters
  if (bundle.config?.zapret?.gameFilterMode) {
    try { await setGameFilterMode(bundle.config.zapret.gameFilterMode as any) } catch { /* ignore */ }
  }
  if (bundle.config?.zapret?.ipsetMode) {
    try { await setIpsetFilterMode(bundle.config.zapret.ipsetMode as any) } catch { /* ignore */ }
  }

  return { success: true, message: 'Настройки и профиль успешно восстановлены' }
}
