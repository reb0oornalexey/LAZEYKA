import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { createInterface } from 'node:readline'

export const LINUX_TUN_NAME = 'lazeyka0'
export const LINUX_TUN_TABLE = 28962
const helper = '/usr/lib/lazeyka/incy-tun'

export function hasLinuxTun(): boolean {
  if (process.platform !== 'linux') return false
  try {
    accessSync(helper, constants.X_OK)
    accessSync('/dev/net/tun', constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function startLinuxTun(
  config: string,
  onDead: (reason: string) => void,
  log: (line: string) => void
): { ready: Promise<void>; stop(): Promise<void> } {
  if (!hasLinuxTun()) throw new Error('Установите пакет LAZEYKA для Linux с поддержкой TUN.')
  const payload = JSON.stringify(JSON.parse(config)) + '\n'
  const child = spawn('/usr/bin/pkexec', ['--disable-internal-agent', helper])
  const stdout = createInterface({ input: child.stdout })
  const stderr = createInterface({ input: child.stderr })
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveExit!: () => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const exited = new Promise<void>((resolve) => { resolveExit = resolve })
  let stopping = false
  let started = false
  let lastError = ''

  const timer = setTimeout(() => {
    rejectReady(new Error('Истекло время ожидания запуска TUN.'))
    void stop().catch(() => void 0)
  }, 120_000)
  stdout.on('line', (line) => {
    if (line === 'LAZEYKA_TUN_READY' && !stopping) {
      started = true
      clearTimeout(timer)
      resolveReady()
    } else if (line) log(line)
  })
  stderr.on('line', (line) => {
    if (!line) return
    lastError = line
    log(line)
  })
  child.stdin.on('error', () => void 0)
  child.on('error', (error) => { lastError = error.message })
  child.on('close', (code) => {
    clearTimeout(timer)
    resolveExit()
    const reason = code === 126
      ? 'Запуск TUN отменён.'
      : code === 127
        ? 'Подтвердите запуск TUN в диалоге администратора Linux.'
        : lastError || 'Служба TUN завершилась.'
    if (!started) rejectReady(new Error(stopping ? 'Подключение отменено.' : reason))
    else if (!stopping) onDead(reason)
  })
  child.stdin.write(payload)

  async function stop(): Promise<void> {
    if (!stopping) {
      stopping = true
      clearTimeout(timer)
      child.stdin.end()
      // Пока PolicyKit ждёт подтверждение, stdin ещё не читается.
      if (!started) child.kill('SIGTERM')
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Служба TUN не подтвердила остановку.')), 16_000)
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
  return { ready, stop }
}
