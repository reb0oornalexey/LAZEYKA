import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { spawn } from 'child_process'
import path from 'path'
import { app } from 'electron'
import { dataDir } from '../utils/dirs'
import { getAppConfig, patchAppConfig } from '../config'
import { loadUpdateCache, saveUpdateCache } from '../utils/update-cache'

const REPO = 'reb0oornalexey/LAZEYKA'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

export const UPGRADE_MARKER_NAME = '.lazeyka-upgrade'

export interface AppUpdateInfo {
  installed: string
  latest?: string
  hasUpdate: boolean
  tag?: string
  assetName?: string
  assetUrl?: string
  assetSize?: number
  releaseUrl?: string
  releaseNotes?: string
  publishedAt?: string
  /** Скрывать ли окно обновления прямо сейчас (снуз ещё не истёк). */
  dismissed?: boolean
  /** Версия отложена, но снуз когда-нибудь кончится (epoch ms). */
  snoozedUntil?: number
  /** Версию пропустили насовсем — напомнит только следующий релиз. */
  skipped?: boolean
}

/** «Позже» = сутки тишины. Достаточно, чтобы не бесить, и мало, чтобы не забыть. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000

/**
 * Показывать ли окно обновления для этого тега.
 *
 * Вынесено отдельной функцией, потому что то же самое решение принимают три
 * места: проверка по запросу из интерфейса, фоновый вотчер и меню трея.
 */
export function isUpdateDismissed(
  tag: string | undefined,
  dismissedTag: string | undefined,
  until: number | undefined,
  now = Date.now()
): { dismissed: boolean; snoozedUntil?: number; skipped: boolean } {
  if (!tag || !dismissedTag || dismissedTag !== tag) {
    return { dismissed: false, skipped: false }
  }
  // Конфиг старой сборки: срока нет. Считаем «пропущена» — иначе человек,
  // нажавший «Позже» до обновления, получил бы окно сразу после установки.
  if (until === undefined || until === 0) return { dismissed: true, skipped: true }
  if (now < until) return { dismissed: true, snoozedUntil: until, skipped: false }
  return { dismissed: false, snoozedUntil: until, skipped: false }
}

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}
interface GhRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
  assets?: GhAsset[]
}

function parseVersion(s?: string): string | null {
  if (!s) return null
  const stripped = s.replace(/^v/i, '').trim()
  if (!/^\d+(\.\d+)+/.test(stripped)) return null
  const m = stripped.match(/^\d+(\.\d+)+([.\-+][\w.\-+]+)?/)
  return m ? m[0] : null
}

function compareVersion(a: string, b: string): number {
  const norm = (v: string): (number | string)[] =>
    v
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : p))
  const aa = norm(a)
  const bb = norm(b)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i++) {
    const av = aa[i] ?? 0
    const bv = bb[i] ?? 0
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av > bv) return 1
      if (av < bv) return -1
    } else {
      const as = String(av)
      const bs = String(bv)
      if (as > bs) return 1
      if (as < bs) return -1
    }
  }
  return 0
}

let cache: { at: number; data: AppUpdateInfo } | null = null
let cacheHydrated = false
/**
 * Сколько ответ GitHub считается свежим.
 *
 * Было шесть часов, и это оборачивалось так: выкладываешь релиз, у человека
 * приложение молчит полдня, а перезапуск не помогает — кэш лежит файлом на
 * диске и переживает перезапуск. «Обновлений нет» и «мы не спрашивали» с
 * экрана выглядели одинаково.
 *
 * Полчаса — достаточно редко, чтобы не долбить GitHub (60 запросов в час на
 * IP без авторизации), и достаточно часто, чтобы перезапуск приложения был
 * рабочим способом получить свежий ответ.
 */
const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_NAME = 'app'

function hydrateCacheFromDisk(): void {
  if (cacheHydrated) return
  cacheHydrated = true
  const persisted = loadUpdateCache<AppUpdateInfo>(CACHE_NAME)
  if (persisted) cache = persisted
}

export async function checkAppUpdate(force = false): Promise<AppUpdateInfo> {
  hydrateCacheFromDisk()
  const installed = app.getVersion()
  const cfg = await getAppConfig()
  const dismissedTag = cfg.dismissedAppUpdateTag
  const dismissedUntil = cfg.dismissedAppUpdateUntil

  /** Собрать ответ из того, что уже лежит в кэше. */
  const fromCache = (): AppUpdateInfo => {
    const data = cache!.data
    const cachedLatest = data.latest
    return {
      ...data,
      installed,
      hasUpdate: !!cachedLatest && compareVersion(cachedLatest, installed) > 0,
      ...isUpdateDismissed(data.tag, dismissedTag, dismissedUntil)
    }
  }

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS && cache.data.tag) {
    return fromCache()
  }

  let release: GhRelease
  try {
    const res = await fetch(RELEASES_LATEST_URL, { headers: REQUEST_HEADERS })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    release = (await res.json()) as GhRelease
  } catch (e) {
    // Сеть отвалилась или GitHub упёрся в лимит запросов. Если человек нажал
    // «Проверить обновления» сам — он должен увидеть причину, а не бодрое
    // «всё свежее». В фоне же лучше отдать вчерашний ответ, чем ничего.
    if (!force && cache?.data.tag) return fromCache()
    throw new Error(
      `Не удалось проверить обновления LAZEYKA: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  if (release.draft || release.prerelease) {
    const info: AppUpdateInfo = { installed, hasUpdate: false }
    cache = { at: Date.now(), data: info }
    saveUpdateCache(CACHE_NAME, info)
    return info
  }

  const tag = release.tag_name?.trim() || undefined
  const latest = parseVersion(tag) || parseVersion(release.name) || undefined

  // Pick the per-machine NSIS installer artifact. electron-builder.yml writes
  // it as `LAZEYKA_x64.exe`; we accept any `LAZEYKA*.exe` to survive minor
  // naming changes.
  const assets = release.assets ?? []
  const installerAsset =
    assets.find((a) => /^LAZEYKA_x64\.exe$/i.test(a.name)) ??
    assets.find((a) => /^LAZEYKA.*\.exe$/i.test(a.name) && !/portable/i.test(a.name))

  const hasUpdate = !!latest && compareVersion(latest, installed) > 0

  const info: AppUpdateInfo = {
    installed,
    latest,
    hasUpdate,
    tag,
    assetName: installerAsset?.name,
    assetUrl: installerAsset?.browser_download_url,
    assetSize: installerAsset?.size,
    releaseUrl: release.html_url,
    releaseNotes: release.body?.trim() || undefined,
    publishedAt: release.published_at,
    ...isUpdateDismissed(tag, dismissedTag, dismissedUntil)
  }

  cache = { at: Date.now(), data: info }
  saveUpdateCache(CACHE_NAME, info)
  return info
}

/**
 * Отложить или пропустить обновление.
 *
 * `forever = false` («Позже») — тишина на сутки, потом спросим снова.
 * `forever = true`  («Пропустить эту версию») — молчим до следующего релиза.
 */
export async function dismissAppUpdate(tag: string, forever = false): Promise<void> {
  if (!tag) return
  const until = forever ? 0 : Date.now() + SNOOZE_MS
  await patchAppConfig({ dismissedAppUpdateTag: tag, dismissedAppUpdateUntil: until })
  if (cache && cache.data.tag === tag) {
    cache.data.dismissed = true
    cache.data.skipped = forever
    cache.data.snoozedUntil = forever ? undefined : until
  }
}

// Path of the upgrade marker, written next to LAZEYKA.exe so the OLD
// installer's customUnInstall macro can find it via $INSTDIR.
function upgradeMarkerPath(): string {
  const exeDir = path.dirname(process.execPath)
  return path.join(exeDir, UPGRADE_MARKER_NAME)
}

function writeUpgradeMarker(): void {
  try {
    const p = upgradeMarkerPath()
    const dir = path.dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(p, `lazeyka-upgrade ${Date.now()}\n`, 'utf8')
  } catch (e) {
    console.warn('[app-updater] write upgrade marker failed:', e)
  }
}

/**
 * Download the installer and launch it in silent mode, then quit LAZEYKA
 * so NSIS can replace the on-disk files. The installer auto-relaunches the
 * new LAZEYKA when it's done; the user perceives the upgrade as ~5–10 s
 * of "closed and reopened".
 */
export async function installAppUpdate(
  assetUrl: string,
  expectedVersion?: string
): Promise<{ scheduled: true }> {
  if (!assetUrl) throw new Error('Пустая ссылка на установщик')
  if (process.platform !== 'win32') {
    throw new Error('Авто-обновление поддерживается только на Windows')
  }

  let buf: Buffer
  try {
    const res = await fetch(assetUrl, {
      headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    buf = Buffer.from(ab)
  } catch (e) {
    throw new Error(
      `Не удалось скачать установщик: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  if (buf.length < 5 * 1024 * 1024) {
    throw new Error(`Загруженный файл слишком маленький (${buf.length} байт)`)
  }

  // Write the installer to %TEMP% so it's auto-cleaned by Windows. Using
  // a stable name plus a timestamp keeps concurrent retries (rare) from
  // colliding while leaving older copies for Disk Cleanup to remove.
  const dir = app.getPath('temp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const installerPath = path.join(dir, `LAZEYKA-update-${Date.now()}.exe`)
  writeFileSync(installerPath, buf)

  // Tell the OLD installer's customUnInstall macro that this run is an
  // in-place upgrade and the user-data wipe MUST be skipped — otherwise
  // %APPDATA%\lazeyka (every config the user has) would vanish.
  writeUpgradeMarker()

  if (expectedVersion) {
    try {
      // Обе половины отметки, иначе остался бы висеть срок от предыдущего
      // «Позже» и приклеился бы к следующему тегу.
      await patchAppConfig({ dismissedAppUpdateTag: undefined, dismissedAppUpdateUntil: undefined })
    } catch {
      /* noop — user can dismiss manually if cleanup fails */
    }
  }

  // Spawn detached so the installer survives our app.quit().
  //
  // `--force-run` — штатный флаг electron-builder, который поднимает
  // приложение после установки. Для assisted-установщика (`oneClick: false`)
  // автозапуск в тихом режиме включается ТОЛЬКО этим флагом:
  //
  //   ${if} ${isForceRun}
  //   ${andIf} ${Silent}
  //     !insertmacro doStartApp
  //
  // Мы передавали лишь `/S --updated`, поэтому установщик молча завершался и
  // приложение приходилось открывать руками. Сторож на PowerShell ниже писался
  // как обходной путь именно для этого и остаётся запасным вариантом на случай,
  // если антивирус прибьёт запуск из установщика.
  const child = spawn(installerPath, ['/S', '--updated', '--force-run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.on('error', (e) => console.error('[app-updater] installer spawn error:', e))
  const installerPid = child.pid
  child.unref()

  // Re-launch watcher. With `oneClick: false` (assisted installer) the
  // built-in `--updated` relaunch flag is unreliable when the installer
  // runs elevated, so we maintain our own watcher: poll the installer
  // PID, wait for LAZEYKA.exe to settle, then start it.
  if (installerPid) {
    try {
      const exePath = process.execPath
      const exeDir = path.dirname(exePath)
      const ts = Date.now()
      const logPath = path.join(dir, `LAZEYKA-relaunch-${ts}.log`)
      /**
       * Время изменения ТЕКУЩЕГО (ещё старого) LAZEYKA.exe.
       *
       * Сторож ждал просто наличия файла — но старый файл лежит на месте почти
       * весь апгрейд, так что проверка проходила сразу. Запуск мог случиться в
       * окно, когда деинсталлятор делает `taskkill /F /IM LAZEYKA.exe /T`, и
       * только что поднятое приложение тут же убивали.
       *
       * Метка времени — единственный надёжный признак, что файл действительно
       * заменили новым.
       */
      let oldExeMtime = 0
      try {
        oldExeMtime = statSync(exePath).mtimeMs
      } catch { /* файла нет — тогда сойдёт любое появление */ }
      const watcherScript = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$installerPid = ${installerPid}`,
        `$exe = '${exePath.replace(/'/g, "''")}'`,
        `$exeDir = '${exeDir.replace(/'/g, "''")}'`,
        `$logPath = '${logPath.replace(/'/g, "''")}'`,
        `$oldMtime = ${Math.floor(oldExeMtime)}`,
        // Diagnostic log — survives even if the relaunch fails so we
        // can ask users to attach %TEMP%\LAZEYKA-relaunch-*.log when
        // a future bug report comes in.
        'function Log($m) {',
        "  try { Add-Content -LiteralPath $logPath -Value \"$([DateTime]::Now.ToString('HH:mm:ss.fff')) $m\" } catch {}",
        '}',
        'Log \"watcher started, installerPid=$installerPid exe=$exe\"',
        // 1) Wait for the installer to finish (up to 5 min — silent NSIS
        //    upgrades take 5–15s but slow disks / AV may stretch it).
        '$deadline = (Get-Date).AddMinutes(5)',
        'while ((Get-Date) -lt $deadline) {',
        '  if (-not (Get-Process -Id $installerPid -ErrorAction SilentlyContinue)) { Log \"installer exited\"; break }',
        '  Start-Sleep -Milliseconds 500',
        '}',
        // 2) Defender often holds the freshly-written LAZEYKA.exe for a
        //    few seconds for an on-write scan; 1s wasn't always enough.
        'Start-Sleep -Seconds 3',
        // 3) Дождаться, пока файл действительно ЗАМЕНЯТ, а не просто увидеть
        //    его на месте: старый exe лежит там почти весь апгрейд. Признак
        //    замены — изменившееся время модификации.
        '$filePoll = (Get-Date).AddSeconds(90)',
        '$replaced = $false',
        'while ((Get-Date) -lt $filePoll) {',
        '  if (Test-Path -LiteralPath $exe) {',
        // Epoch считаем через явный конструктор DateTime: `Get-Date "1970-01-01Z"`
        // в Windows PowerShell 5.1 разбирается в зависимости от локали и может
        // отдать не UTC. Здесь вид времени задан жёстко.
        '    $epoch = New-Object DateTime 1970,1,1,0,0,0,([DateTimeKind]::Utc)',
        '    $mt = [int64](((Get-Item -LiteralPath $exe).LastWriteTimeUtc - $epoch).TotalMilliseconds)',
        '    if ($oldMtime -le 0 -or $mt -ne $oldMtime) { $replaced = $true; Log "exe replaced (mtime $oldMtime -> $mt)"; break }',
        '  }',
        '  Start-Sleep -Milliseconds 500',
        '}',
        'if (-not (Test-Path -LiteralPath $exe)) { Log \"exe missing at $exe — giving up\"; exit 1 }',
        'if (-not $replaced) { Log "mtime unchanged — запускаем всё равно, файл на месте" }',
        // 4) Убедиться, что старый процесс уже не жив. Деинсталлятор делает
        //    `taskkill /F /IM LAZEYKA.exe /T`; если стартовать раньше него,
        //    он прибьёт только что поднятое приложение.
        '$procPoll = (Get-Date).AddSeconds(30)',
        '$name = [IO.Path]::GetFileNameWithoutExtension($exe)',
        'while ((Get-Date) -lt $procPoll -and (Get-Process -Name $name -ErrorAction SilentlyContinue)) {',
        '  Start-Sleep -Milliseconds 500',
        '}',
        'if (Get-Process -Name $name -ErrorAction SilentlyContinue) {',
        '  Log "приложение уже запущено (установщик поднял сам) — выходим"',
        '  exit 0',
        '}',
        // 5) Try to launch via Start-Process first (preferred — surfaces
        //    in the user's interactive session). If that throws, fall
        //    back to the .NET Process API which goes through CreateProcess
        //    directly.
        'try {',
        '  Start-Process -FilePath $exe -WorkingDirectory $exeDir',
        '  Log \"Start-Process OK\"',
        '} catch {',
        '  Log \"Start-Process failed: $_ — trying .NET fallback\"',
        '  try {',
        '    [System.Diagnostics.Process]::Start($exe) | Out-Null',
        '    Log \"Process.Start OK\"',
        '  } catch {',
        '    Log \"all relaunch attempts failed: $_\"',
        '  }',
        '}'
      ].join('\n')
      const watcherPath = path.join(dir, `LAZEYKA-relaunch-${ts}.ps1`)
      // Prepend BOM so PowerShell reads the script as UTF-8 even on
      // legacy systems where the OEM code page would otherwise mangle
      // non-ASCII characters in install paths.
      writeFileSync(watcherPath, '\ufeff' + watcherScript, 'utf8')
      const watcher = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-WindowStyle',
          'Hidden',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          watcherPath
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }
      )
      watcher.on('error', (e) =>
        console.error('[app-updater] relaunch watcher spawn error:', e)
      )
      watcher.unref()
    } catch (e) {
      // Watcher is best-effort — if it fails the user just has to
      // double-click the desktop shortcut after install. Don't block
      // the upgrade itself on this.
      console.warn('[app-updater] relaunch watcher setup failed:', e)
    }
  }

  // Give NSIS a beat to acquire the install lock, then quit. If we quit
  // synchronously the installer's "is target running?" probe sometimes
  // races and shows a "close LAZEYKA" prompt despite /S.
  setTimeout(() => {
    try {
      app.quit()
    } catch {
      /* falling through to process.exit below */
    }
    setTimeout(() => process.exit(0), 1000)
  }, 800)

  return { scheduled: true }
}

// Convenience used by index.ts on startup if autoCheckUpdate is enabled.
export function silentBackgroundCheck(): void {
  checkAppUpdate(false).catch(() => void 0)
}

// Re-export so unrelated modules don't have to depend on the cache
// internals when they want to hint that a fresh check is appropriate
// (e.g. after the user explicitly cleared `dismissedAppUpdateTag`).
export function invalidateAppUpdateCache(): void {
  cache = null
}

void dataDir // keep import slot, used implicitly via update-cache
