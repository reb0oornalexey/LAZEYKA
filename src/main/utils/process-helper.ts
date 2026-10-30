import { exec, execFile } from 'node:child_process'
import { collectRunningMacApps, outerBundle } from './mac-apps'

export interface RunningProcessInfo {
  name: string
  title?: string
  /** macOS: что записать в список ExitLag (путь бандла `.app` или файла). */
  rule?: string
  /** macOS: исполняемые файлы приложения, которые сейчас запущены. */
  names?: string[]
}

/**
 * List active desktop processes and applications on Windows.
 * Uses `tasklist /V` with UTF-8 codepage to capture human-readable window titles.
 */
export function listRunningProcesses(): Promise<RunningProcessInfo[]> {
  if (process.platform === 'darwin') return listRunningProcessesDarwin()
  return new Promise((resolve) => {
    exec(
      'chcp 65001 >nul && tasklist /V /FO CSV /NH',
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve([])
        }

        const lines = stdout.split(/\r?\n/).filter(Boolean)
        const map = new Map<string, RunningProcessInfo>()

        const ignoreList = new Set([
          'svchost.exe',
          'conhost.exe',
          'tasklist.exe',
          'cmd.exe',
          'powershell.exe',
          'csrss.exe',
          'smss.exe',
          'services.exe',
          'lsass.exe',
          'wininit.exe',
          'fontdrvhost.exe',
          'sihost.exe',
          'dwm.exe',
          'ctfmon.exe',
          'searchindexer.exe',
          'runtimebroker.exe',
          'system',
          'registry',
          'memory compression',
          'wmi_provider_host.exe',
          'wmiprvse.exe',
          'audiodg.exe',
          'spoolsv.exe'
        ])

        for (const line of lines) {
          const matches = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1])
          if (matches.length < 2) continue

          const rawName = matches[0]?.trim()
          if (!rawName || !rawName.toLowerCase().endsWith('.exe')) continue

          const lowerName = rawName.toLowerCase()
          if (ignoreList.has(lowerName)) continue

          const windowTitle = matches[matches.length - 1]?.trim()
          const isTrivialTitle =
            !windowTitle ||
            [
              'n/a',
              'н/д',
              'unknown',
              'olemainthreadwndname',
              'default ime',
              'msctls_statusbar32',
              'quick settings',
              'pyinstaller onefile hidden window'
            ].includes(windowTitle.toLowerCase())

          const cleanTitle = isTrivialTitle ? undefined : windowTitle

          if (!map.has(lowerName)) {
            map.set(lowerName, { name: rawName, title: cleanTitle })
          } else if (cleanTitle && !map.get(lowerName)!.title) {
            map.get(lowerName)!.title = cleanTitle
          }
        }

        const result = Array.from(map.values())
        // Sort processes: apps with distinct window titles first, then by name
        result.sort((a, b) => {
          if (a.title && !b.title) return -1
          if (!a.title && b.title) return 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })

        resolve(result)
      }
    )
  })
}

/**
 * macOS: запущенные приложения, сгруппированные по бандлам `.app` (трафик
 * Chrome идёт из «Google Chrome Helper», а не из «Google Chrome»): название —
 * имя бандла, правило — путь бандла, внутри — все его запущенные процессы.
 */
async function listRunningProcessesDarwin(): Promise<RunningProcessInfo[]> {
  const apps = await collectRunningMacApps()
  return apps
    .filter((a) => a.isApp || !outerBundle(a.rule))
    .map((a) => ({
      name: a.title,
      title: a.names.length > 1 ? `${a.path} · ещё ${a.names.length - 1} внутри` : a.path,
      rule: a.rule,
      names: a.names
    }))
}

/** Запущен ли процесс с таким именем образа (`pgrep -x`) — macOS; на других платформах false. */
export function isProcessRunningByName(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve(false)
    execFile('/usr/bin/pgrep', ['-x', name], (err) => resolve(!err))
  })
}

/** Завершить процессы по имени образа (`pkill -x`) — macOS; на других платформах no-op. */
export function killProcessByName(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve()
    execFile('/usr/bin/pkill', ['-x', name], () => resolve())
  })
}
