import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export async function setWindowsSystemProxy(port = 20808, bypassDomains: string[] = []): Promise<void> {
  if (process.platform !== 'win32') return

  const domainList = bypassDomains.length > 0 ? bypassDomains.join(';') : '<local>'
  const override = `${domainList};<local>;127.*;10.*;192.168.*`

  try {
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f && reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${port}" /f && reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${override}" /f`
    await execAsync(cmd, { windowsHide: true })
  } catch { /* best effort */ }
}

export async function clearWindowsSystemProxy(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`
    await execAsync(cmd, { windowsHide: true })
  } catch { /* best effort */ }
}
