/**
 * Е6: копия профиля перед обновлением программы.
 *
 * Когда человек нажимает «Установить» в окне обновления, в папку данных
 * (profile-backups/) пишется обычный профиль .lazeyka — тот же, что даёт
 * «Сохранить профиль в файл» (без секретов, см. profile-sanitize.ts). Хранятся
 * последние 3. В «Настройки → Профиль и сброс» их можно восстановить.
 * Работает только в момент установки обновления, в фоне ничего не делает.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { dataDir } from '../utils/dirs'
import { getAppConfigSync } from '../config'
import { appLog } from '../utils/app-logger'
import { buildLazeykaProfile, restoreLazeykaProfile } from './profile-manager'
import { parseBackupName, backupName, BACKUPS_KEPT } from './profile-backups-logic'

export interface ProfileBackup {
  /** Имя файла — им же копия восстанавливается. */
  id: string
  /** Когда сохранена (мс). */
  at: number
  /** Версия, с которой обновлялись. */
  from: string
  /** Версия, на которую обновлялись (если известна). */
  to: string | null
  bytes: number
}

function dir(): string {
  return path.join(dataDir(), 'profile-backups')
}

export function listProfileBackups(): ProfileBackup[] {
  const d = dir()
  if (!existsSync(d)) return []
  const out: ProfileBackup[] = []
  for (const name of readdirSync(d)) {
    const meta = parseBackupName(name)
    if (!meta) continue
    let bytes = 0
    try {
      bytes = statSync(path.join(d, name)).size
    } catch {
      continue
    }
    out.push({ id: name, ...meta, bytes })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Сохранить копию перед установкой обновления. Ошибка не мешает обновлению. */
export async function backupProfileBeforeUpdate(toVersion?: string): Promise<void> {
  try {
    if (getAppConfigSync().backupBeforeUpdate === false) return
    const from = app.getVersion()
    const to = toVersion ? String(toVersion).replace(/^v/i, '') : null
    const list = listProfileBackups()
    // Повторная попытка той же установки в течение часа — копию не множим.
    const last = list[0]
    if (last && last.from === from && last.to === to && Date.now() - last.at < 3_600_000) return
    mkdirSync(dir(), { recursive: true })
    const name = backupName(Date.now(), from, to)
    writeFileSync(path.join(dir(), name), JSON.stringify(await buildLazeykaProfile(), null, 2), 'utf-8')
    appLog('info', `Копия профиля перед обновлением: ${name}`)
    for (const old of listProfileBackups().slice(BACKUPS_KEPT)) {
      try {
        unlinkSync(path.join(dir(), old.id))
      } catch {
        /* занят — уберётся в следующий раз */
      }
    }
  } catch (e) {
    appLog('warn', `Копия профиля перед обновлением не сохранена: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Восстановить настройки из копии. */
export async function restoreProfileBackup(id: string): Promise<{ success: boolean; message: string }> {
  // Только имя файла из списка: «..\\x» не пройдёт разбор имени.
  if (path.basename(id) !== id || !parseBackupName(id)) throw new Error('Копия не найдена')
  const file = path.join(dir(), id)
  if (!existsSync(file)) throw new Error('Копия не найдена')
  return restoreLazeykaProfile(readFileSync(file, 'utf-8'))
}
