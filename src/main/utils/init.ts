import {
  appConfigPath,
  dataDir,
  logDir,
  runtimeDir,
  themesDir,
  tgwsRuntimeDir,
  zapretRuntimeDir,
  incyRuntimeDir,
  resourcesDir
} from './dirs'
import { defaultConfig } from './template'
import { stringifyYaml } from './yaml'
import { mkdir, writeFile, cp } from 'fs/promises'
import { existsSync, readdirSync, copyFileSync } from 'fs'
import path from 'path'
import { app } from 'electron'

async function initDirs(): Promise<void> {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir(), { recursive: true })
  }
  const dirs = [
    themesDir(),
    logDir(),
    runtimeDir(),
    tgwsRuntimeDir(),
    zapretRuntimeDir(),
    incyRuntimeDir()
  ]
  await Promise.all(
    dirs.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initRuntimeBundles(): Promise<void> {
  try {
    // 1. Zapret bundle in %APPDATA%/lazeyka/runtime/zapret
    const zapretDest = zapretRuntimeDir()
    const zapretSrc = path.join(resourcesDir(), 'zapret')
    if (existsSync(zapretSrc)) {
      const hasGeneral = existsSync(path.join(zapretDest, 'general.bat'))
      const hasLists = existsSync(path.join(zapretDest, 'lists'))
      if (!hasGeneral || !hasLists) {
        // Deep copy all files from bundled zapret
        await cp(zapretSrc, zapretDest, { recursive: true, force: false })
      } else {
        // Ensure all default list files exist in runtime/zapret/lists
        const srcLists = path.join(zapretSrc, 'lists')
        const dstLists = path.join(zapretDest, 'lists')
        if (existsSync(srcLists)) {
          if (!existsSync(dstLists)) await mkdir(dstLists, { recursive: true })
          const listFiles = readdirSync(srcLists)
          for (const f of listFiles) {
            const targetFile = path.join(dstLists, f)
            if (!existsSync(targetFile)) {
              try {
                copyFileSync(path.join(srcLists, f), targetFile)
              } catch { /* ignore */ }
            }
          }
        }
      }
    }

    // 2. TGWS headless proxy in %APPDATA%/lazeyka/runtime/tgws
    const tgwsDest = tgwsRuntimeDir()
    const tgwsSrc = path.join(resourcesDir(), 'tgws')
    if (existsSync(tgwsSrc)) {
      const tgwsExe = path.join(tgwsDest, 'TgWsProxy_windows.exe')
      if (!existsSync(tgwsExe)) {
        try {
          await cp(tgwsSrc, tgwsDest, { recursive: true, force: false })
        } catch { /* ignore */ }
      }
    }

    // 3. INCY cores in %APPDATA%/lazeyka/runtime/incy
    //
    // Two cores live here now: sing-box.exe (Hysteria2 + the TUN adapter) and
    // xray.exe (VLESS/VMess/Trojan/SS, plus fragmentation and noise packets).
    // wintun.dll is what lets sing-box create the TUN device on Windows.
    //
    // The old code copied the whole folder only when sing-box.exe was missing,
    // so an install that already had sing-box from a previous version would
    // never receive xray.exe. Each file is now topped up independently.
    //
    // The geo databases (geoip.dat / geosite.dat, ~30 MB together) are
    // deliberately NOT copied: `xrayAssetsDir()` reads them straight from
    // resources/, and duplicating them into runtime would just double the
    // disk footprint.
    const incyDest = incyRuntimeDir()
    const incySrc = path.join(resourcesDir(), 'incy')
    if (existsSync(incySrc)) {
      for (const file of ['sing-box.exe', 'xray.exe', 'wintun.dll']) {
        const from = path.join(incySrc, file)
        const to = path.join(incyDest, file)
        if (existsSync(from) && !existsSync(to)) {
          try {
            copyFileSync(from, to)
          } catch { /* ignore — the resources/ copy is used as fallback */ }
        }
      }
    }
  } catch (e) {
    console.warn('[init] initRuntimeBundles warning:', e)
  }
}

async function initConfig(): Promise<void> {
  if (!existsSync(appConfigPath())) {
    await writeFile(appConfigPath(), stringifyYaml(defaultConfig))
  }
}

function initDeeplink(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('lazeyka', process.execPath, [
        path.resolve(process.argv[1])
      ])
      app.setAsDefaultProtocolClient('tg-ws', process.execPath, [
        path.resolve(process.argv[1])
      ])
    }
  } else {
    app.setAsDefaultProtocolClient('lazeyka')
    app.setAsDefaultProtocolClient('tg-ws')
  }
}

export async function init(): Promise<void> {
  await initDirs()
  await initRuntimeBundles()
  await initConfig()
  initDeeplink()
}