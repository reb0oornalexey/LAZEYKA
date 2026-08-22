import { readFile } from 'fs/promises'
import { themesDir } from '../utils/dirs'
import { nativeTheme } from 'electron'
import path from 'path'
import { existsSync } from 'fs'
import { mainWindow } from '..'

let insertedCSSKeyMain: string | undefined

export function setNativeTheme(theme: AppTheme): void {
  nativeTheme.themeSource = theme
}

/**
 * Read a user CSS theme from the themes folder.
 *
 * Internal to this module now. The wider theme feature — listing available
 * themes, importing .css files, writing them back — was never wired to any UI:
 * `resolveThemes`, `importThemes` and `writeTheme` had no callers anywhere in
 * the app. They were removed rather than left as an invitation to assume the
 * feature exists. What remains is the part `App.tsx` actually uses: applying
 * `customTheme` from the config on startup.
 */
async function readTheme(theme: string): Promise<string> {
  const full = path.join(themesDir(), theme)
  if (!existsSync(full)) return ''
  return await readFile(full, 'utf-8')
}

export async function applyTheme(theme: string): Promise<void> {
  const css = await readTheme(theme)
  try {
    if (insertedCSSKeyMain) {
      await mainWindow?.webContents.removeInsertedCSS(insertedCSSKeyMain)
    }
    insertedCSSKeyMain = await mainWindow?.webContents.insertCSS(css) ?? undefined
  } catch { /* noop */ }
}