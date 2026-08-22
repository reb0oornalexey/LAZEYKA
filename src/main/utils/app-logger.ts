import { BrowserWindow } from 'electron'
import { logToFile } from './file-logger'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

export function appLog(type: ControllerLog['type'], payload: string): void {
  const entry: ControllerLog = {
    time: Date.now(),
    type,
    source: 'app',
    payload
  }
  // Persist as well as broadcast: the renderer's buffer is capped and dies
  // with the window, so anything worth showing is worth keeping on disk.
  logToFile(entry)
  broadcast('log', entry)
  // Also mirror to stdout for dev convenience.
  const tag = type === 'error' ? '[app:error]' : type === 'warn' ? '[app:warn]' : '[app]'
  console.log(`${tag} ${payload}`)
}
