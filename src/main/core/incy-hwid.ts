/**
 * Идентификатор устройства для подписок с ограничением по числу устройств.
 *
 * Панели вроде Remnawave умеют ограничивать, на скольких устройствах живёт одна
 * подписка. Работает это так: клиент при загрузке подписки шлёт заголовок
 * `x-hwid` со стабильным идентификатором машины, панель считает уникальные
 * значения и, когда лимит выбран, отдаёт 404. Если клиент заголовок не шлёт
 * вовсе, а у провайдера ограничение включено, подписка не загрузится совсем —
 * и человек увидит непонятную ошибку вместо объяснения.
 *
 * Формат заголовков задан Happ и описан в документации Remnawave:
 * https://docs.rw/docs/features/hwid-device-limit/
 *
 * Что именно уходит провайдеру — видно в настройках INCY, там же выключатель.
 * Никакого «отпечатка» помимо этих четырёх полей мы не собираем.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { getAppConfig, patchAppConfig } from '../config'

export interface HwidHeaders {
  'x-hwid': string
  'x-device-os': string
  'x-ver-os': string
  'x-device-model': string
}

let cached: string | null = null

/**
 * MachineGuid Windows — единственный доступный без прав администратора
 * идентификатор, который переживает переустановку приложения и не меняется
 * сам по себе. Живёт в реестре с момента установки системы.
 */
function readMachineGuid(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const m = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i)
        resolve(m ? m[1] : null)
      }
    )
  })
}

/**
 * Устойчивый идентификатор машины.
 *
 * Отдаём не сам MachineGuid, а его хэш: провайдеру нужно лишь отличать
 * устройства друг от друга, а системный идентификатор в чистом виде — лишняя
 * подробность о человеке, которой можно не делиться.
 *
 * Если реестр недоступен (не Windows, урезанная система), один раз
 * генерируется случайный идентификатор и сохраняется в конфиг. Он так же
 * стабилен, пока цел конфиг; при его потере провайдер увидит новое устройство.
 */
export async function getDeviceHwid(): Promise<string> {
  if (cached) return cached

  const guid = await readMachineGuid()
  if (guid) {
    cached = createHash('sha256').update(`lazeyka:${guid}`).digest('hex').slice(0, 32)
    return cached
  }

  const cfg = await getAppConfig()
  let fallback = cfg.deviceHwidSeed
  if (!fallback) {
    fallback = randomUUID()
    try {
      await patchAppConfig({ deviceHwidSeed: fallback })
    } catch {
      /* не сохранился — идентификатор проживёт до перезапуска, это лучше пустого */
    }
  }
  cached = createHash('sha256').update(`lazeyka:${fallback}`).digest('hex').slice(0, 32)
  return cached
}

/** Кириллица → латиница, чтобы имя машины осталось узнаваемым. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

/**
 * Привести значение к тому, что вообще можно положить в HTTP-заголовок.
 *
 * Node отвергает заголовки с символами вне latin1 — а имя компьютера у людей
 * сплошь и рядом кириллицей. Живой отчёт от пользователя: подписка перестала
 * обновляться с «Invalid character in header content [x-device-model]», то
 * есть запрос не уходил вовсе.
 *
 * Просто выбросить нелатинские символы мало: из «ПК-Алексей» осталось бы
 * «-», и в списке устройств у провайдера человек себя не узнал бы. Поэтому
 * кириллица транслитерируется, а всё остальное непечатаемое отбрасывается.
 */
function headerSafe(value: string, fallback: string): string {
  const translit = value
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase()
      const mapped = TRANSLIT[lower]
      if (mapped === undefined) return ch
      // Сохраняем регистр: «Алексей» → «Aleksey», а не «aleksey».
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1)
    })
    .join('')

  const cleaned = translit
    .replace(/[^\x20-\x7e]/g, '') // остальное непечатаемое — за борт
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)

  return cleaned || fallback
}

/**
 * Заголовки, которые уходят вместе с запросом подписки.
 *
 * `x-device-model` — имя компьютера: именно оно показывается провайдеру в
 * списке устройств, и по нему человек узнаёт свою машину среди прочих. Всё
 * остальное — операционная система и её версия.
 */
export async function getHwidHeaders(): Promise<HwidHeaders> {
  const platform =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  return {
    'x-hwid': await getDeviceHwid(),
    'x-device-os': platform,
    'x-ver-os': headerSafe(os.release(), 'unknown'),
    'x-device-model': headerSafe(os.hostname() || '', 'PC')
  }
}
