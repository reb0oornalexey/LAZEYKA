import { execFile } from 'child_process'
import { promisify } from 'util'

const execFilePromise = promisify(execFile)

let isAdminCached: boolean | null = null

export async function isRunningAsAdmin(): Promise<boolean> {
  if (isAdminCached !== null) {
    return isAdminCached
  }

  // 1. fltmc.exe is the most reliable check across all Windows editions and tweaks
  try {
    await execFilePromise('fltmc.exe', [], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch { /* proceed to next check */ }

  // 2. fsutil check
  try {
    await execFilePromise('fsutil.exe', ['dirty', 'query', process.env.SystemDrive || 'C:'], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch { /* proceed to next check */ }

  // 3. net session fallback
  try {
    await execFilePromise('net.exe', ['session'], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch {
    isAdminCached = false
    return false
  }
}

