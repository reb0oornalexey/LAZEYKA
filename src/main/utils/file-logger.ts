/**
 * Append-only log file writer with day-based rotation.
 *
 * Until now nothing was ever written to disk: `logDir()` was created at
 * startup, `logPath()` knew how to name a file, and `maxLogDays` sat in the
 * config — but the only place log lines lived was a 500-entry ring buffer in
 * the renderer, wiped on every restart. That made post-mortem debugging
 * impossible: by the time a user noticed something had gone wrong and went to
 * collect logs, the evidence was already gone (and anything from before the
 * last restart never existed at all).
 *
 * Design notes:
 *
 *  - **Batched, not per-line.** Log lines arrive in bursts (a core's stdout can
 *    emit dozens per second). Appending each one synchronously would put disk
 *    I/O on the path of every packet the cores log about. Lines are queued and
 *    flushed on a short timer instead.
 *  - **Failures are silent.** A log write must never break the app or recurse
 *    into logging about failing to log.
 *  - **Rotation deletes, it does not compress.** Files are named by date, so
 *    "older than N days" is a filename comparison — no need to read anything.
 */

import { appendFile, readdir, unlink } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { logDir } from './dirs'

/** Lines waiting to be written. */
let queue: string[] = []
let flushTimer: NodeJS.Timeout | null = null
let writing = false

/** How long to batch before hitting the disk. */
const FLUSH_INTERVAL_MS = 1000

/** Hard cap so a runaway core cannot grow the queue without bound. */
const MAX_QUEUE = 5000

function currentLogFile(): string {
  const d = new Date()
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}.log`
  return path.join(logDir(), name)
}

async function flush(): Promise<void> {
  if (writing || queue.length === 0) return
  writing = true
  const batch = queue
  queue = []
  try {
    const dir = logDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    await appendFile(currentLogFile(), batch.join('\n') + '\n', 'utf-8')
  } catch {
    /* disk full, permissions, folder removed — dropping the batch is correct */
  } finally {
    writing = false
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
  // Never hold the process open just to write a log line.
  flushTimer.unref?.()
}

/**
 * Queue one entry for the day's log file. Mirrors what the Logs page shows, in
 * a format that stays greppable: `HH:MM:SS [level] [source] text`.
 */
export function logToFile(entry: ControllerLog): void {
  try {
    const t = new Date(entry.time || Date.now())
    const hh = String(t.getHours()).padStart(2, '0')
    const mm = String(t.getMinutes()).padStart(2, '0')
    const ss = String(t.getSeconds()).padStart(2, '0')
    // Strip ANSI so the file stays readable in any editor.
    // eslint-disable-next-line no-control-regex
    const clean = String(entry.payload ?? '').replace(/\[[0-9;]*[A-Za-z]/g, '')
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue
      if (queue.length >= MAX_QUEUE) return
      queue.push(`${hh}:${mm}:${ss} [${entry.type}] [${entry.source}] ${line}`)
    }
    scheduleFlush()
  } catch {
    /* logging must never throw */
  }
}

/**
 * Delete log files older than `maxDays`. Called once at startup — daily
 * rotation does not need to be more precise than that for a desktop app.
 */
export async function pruneOldLogs(maxDays: number): Promise<void> {
  const days = Number(maxDays)
  if (!Number.isFinite(days) || days <= 0) return
  try {
    const dir = logDir()
    if (!existsSync(dir)) return
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    for (const name of await readdir(dir)) {
      const m = name.match(/^(\d{4})-(\d{2})-(\d{2})\.log$/)
      if (!m) continue
      const when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
      if (when < cutoff) {
        try {
          await unlink(path.join(dir, name))
        } catch {
          /* locked or already gone */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

/** Write anything still queued. Called on quit so the last lines survive. */
export async function flushLogsNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flush()
}

/** Absolute path of today's log file — shown in the UI so users can find it. */
export function currentLogFilePath(): string {
  return currentLogFile()
}
