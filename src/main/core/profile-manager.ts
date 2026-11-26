import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import { getAppConfig, patchAppConfig } from '../config'
import { zapretBundleDir } from '../utils/dirs'
import { getActiveFakesState, setActiveFake, setGameFilterMode, setIpsetFilterMode } from './zapret-service-settings'
import { randomBytes } from 'node:crypto'
import { configForExport, configForImport } from './profile-sanitize'
import { isAcceptableStrategyValue, listStrategyFiles } from './zapret-strategy'
import { isLinuxZapretStrategy, resolveLinuxStrategy } from './zapret-linux'

export interface LazeykaProfileBundle {
  format: 'lazeyka-profile'
  version: 1 | 2
  exportedAt: number
  appName: 'LAZEYKA'
  /** Без секретов и служебных меток — см. profile-sanitize.ts. */
  config: Partial<AppConfig>
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

  writeFileSync(filePath, JSON.stringify(await buildLazeykaProfile(), null, 2), 'utf-8')
  return { success: true, filePath, message: 'Профиль успешно экспортирован' }
}

/** Собрать профиль .lazeyka (без диалога): экспорт и копии перед обновлением (Е6). */
export async function buildLazeykaProfile(): Promise<LazeykaProfileBundle> {
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
    // Секрет прокси Telegram, зерно устройства и прочие ключи в профиль не идут.
    config: configForExport(config) as Partial<AppConfig>,
    hostListContent: listsMap['list-general.txt'] || '',
    lists: listsMap,
    activeDiscordFake: fakes.discordActive,
    activeGameFake: fakes.gameActive
  }
  return bundle
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

  return restoreLazeykaProfile(content)
}

/** Применить профиль из текста файла (импорт и «Восстановить» копии перед обновлением). */
export async function restoreLazeykaProfile(content: string): Promise<{ success: boolean; message: string }> {
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
  // Пути к исполняемым файлам из чужого профиля не принимаем: tgws.binaryPath
  // запускается с правами администратора, и присланный «профиль» мог
  // подсунуть любой exe (в том числе с сетевой папки). Секреты (прокси
  // Telegram, зерно устройства) тоже не принимаем — остаются свои.
  const notes: string[] = []
  if (bundle.config && typeof bundle.config === 'object') {
    const incoming = configForImport(bundle.config) as Partial<AppConfig>
    // Стратегия Zapret запускается от администратора: только имя из своей папки стратегий.
    const z = incoming.zapret as Partial<ZapretConfig> | undefined
    if (z && 'activeStrategy' in z && z.activeStrategy !== undefined) {
      if (process.platform === 'linux' && typeof z.activeStrategy === 'string') {
        const mapped = resolveLinuxStrategy(z.activeStrategy, false)
        if (mapped) z.activeStrategy = mapped
      }
      const ok =
        process.platform === 'win32'
          ? listStrategyFiles(zapretBundleDir()).includes(String(z.activeStrategy))
          : process.platform === 'linux'
          ? isLinuxZapretStrategy(z.activeStrategy)
          : isAcceptableStrategyValue(z.activeStrategy, process.platform)
      if (!ok) {
        delete z.activeStrategy
        notes.push('стратегия Zapret из профиля не найдена — выберите её заново')
      }
    }
    await patchAppConfig(incoming)
  }
  // Секрета прокси Telegram нет (новая установка или старый конфиг) — создаём свой.
  {
    const cfg = await getAppConfig()
    if (cfg.tgws && !/^[0-9a-f]{32}$/i.test(cfg.tgws.secret ?? '')) {
      await patchAppConfig({ tgws: { ...cfg.tgws, secret: randomBytes(16).toString('hex') } })
    }
  }

  // 2. Restore hostlists
  const listsDir = path.join(zapretBundleDir(), 'lists')
  if (!existsSync(listsDir)) {
    try { mkdirSync(listsDir, { recursive: true }) } catch { /* ignore */ }
  }

  if (bundle.lists && typeof bundle.lists === 'object') {
    for (const [filename, listData] of Object.entries(bundle.lists)) {
      // Только простое имя файла: «..\\..\\x.txt» записал бы файл куда угодно.
      if (typeof listData === 'string' && path.basename(filename) === filename && /^[\w .()-]+\.txt$/i.test(filename)) {
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

  return {
    success: true,
    message: notes.length
      ? `Настройки и профиль восстановлены (${notes.join('; ')})`
      : 'Настройки и профиль успешно восстановлены'
  }
}
