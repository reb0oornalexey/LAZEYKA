import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, connect } from 'node:net'
import { once } from 'node:events'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const base = path.resolve(process.argv[2] ?? '.')
assert(['linux', 'darwin'].includes(process.platform), 'Run on the target operating system')
const core = (name) => path.join(base, 'incy', name)
for (const name of ['sing-box', 'xray']) {
  const version = execFileSync(core(name), ['version'], { encoding: 'utf8', timeout: 10_000 })
  assert.match(version, /\d+\.\d+\.\d+/)
  console.log(version.split('\n')[0])
}
if (process.platform === 'darwin') {
  execFileSync(core('sing-box'), ['lxd', '--help'], { timeout: 10_000 })
}
const pythonDir = path.join(base, 'tgws', 'python')
const python = process.platform === 'darwin' ? path.join(pythonDir, 'bin', 'python3') : '/usr/bin/python3'
const tgws = [path.join(pythonDir, 'lazeyka_tgws.py'), path.join(base, 'tgws', 'app')]
const env = { ...process.env, PYTHONNOUSERSITE: '1' }
delete env.PYTHONHOME
delete env.PYTHONPATH
const help = execFileSync(python, [...tgws, '--help'], { encoding: 'utf8', env, timeout: 10_000 })
assert.match(help, /--secret/)
assert.match(help, /--port/)

const temporaryListener = createServer().listen(0, '127.0.0.1')
await once(temporaryListener, 'listening')
const { port } = temporaryListener.address()
await new Promise((resolve) => temporaryListener.close(resolve))
async function isOpen() {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.setTimeout(350, () => { socket.destroy(); resolve(false) })
  })
}

assert.equal(await isOpen(), false, 'Port before starting the proxy')
const child = spawn(python, ['-u', ...tgws, '--host', '127.0.0.1', '--port', String(port),
  '--secret', randomBytes(16).toString('hex'), '--no-cfproxy'], { env })
let logs = ''
child.stdout.on('data', (data) => { logs += data.toString() })
child.stderr.on('data', (data) => { logs += data.toString() })
let spawnError
child.on('error', (error) => { spawnError = error })
try {
  let listening = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) break
    if (await isOpen()) { listening = true; break }
    await delay(150)
  }
  assert(listening, 'TgWsProxy did not listen\n' + logs.replace(/[0-9a-f]{32,}/gi, '[redacted]'))
} finally {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit')
    child.kill('SIGTERM')
    const killAfter = setTimeout(() => child.kill('SIGKILL'), 3000)
    try { await ended } finally { clearTimeout(killAfter) }
  }
}
assert.equal(await isOpen(), false, 'Port released after stopping the proxy')
console.log('TgWsProxy started and stopped on loopback.')
