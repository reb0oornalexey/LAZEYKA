/**
 * Секрет установки для подписи ссылок lazeyka:// (см. deeplink-sign.ts).
 *
 * 32 случайных байта в файле `deeplink.key` папки данных. Создаётся при первом
 * обращении (регистрация IPC при запуске программы). Никуда не выводится:
 * не пишется в лог, не входит в профиль `.lazeyka` (профиль берёт только
 * config.yaml и списки Zapret) и в отчёт для поддержки.
 *
 * «Обновить ссылки» выпускает новый секрет: все выданные раньше ссылки и
 * установленный плагин Stream Deck перестают проходить без подтверждения.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../utils/dirs'

const KEY_BYTES = 32
let cached: Buffer | null = null

function keyFile(): string {
  return path.join(dataDir(), 'deeplink.key')
}

function writeKey(key: Buffer): void {
  const file = keyFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, key.toString('base64'), { encoding: 'utf-8', mode: 0o600 })
  try {
    renameSync(tmp, file)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* noop */
    }
    throw e
  }
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows: права наследуются от папки профиля */
  }
}

function readKey(): Buffer | null {
  try {
    const buf = Buffer.from(readFileSync(keyFile(), 'utf-8').trim(), 'base64')
    return buf.length === KEY_BYTES ? buf : null
  } catch {
    return null
  }
}

/** Секрет установки; при отсутствии или порче файла создаётся новый. */
export function getDeeplinkKey(): Buffer {
  if (cached) return cached
  const existing = readKey()
  if (existing) {
    cached = existing
    return existing
  }
  const fresh = randomBytes(KEY_BYTES)
  writeKey(fresh)
  cached = fresh
  return fresh
}

/** Выпустить новый секрет. Старые подписанные ссылки перестают работать без подтверждения. */
export function rotateDeeplinkKey(): void {
  const fresh = randomBytes(KEY_BYTES)
  writeKey(fresh)
  cached = fresh
}
