import { renameSync, unlinkSync, writeFileSync } from 'node:fs'

/**
 * Запись файла без риска оставить его обрезанным.
 *
 * Сначала пишем во временный файл рядом, потом переименовываем поверх
 * старого (на Windows `rename` заменяет файл целиком). Если питание пропадёт
 * посреди записи, останется старая целая версия, а не половина новой.
 * Антивирус или OneDrive иногда держат файл долю секунды — тогда пробуем
 * ещё пару раз, а в крайнем случае пишем напрямую, как раньше.
 */
export function writeFileAtomic(file: string, data: string | Buffer, encoding: BufferEncoding = 'utf-8'): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, typeof data === 'string' ? encoding : undefined)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch {
      const until = Date.now() + 40 * (attempt + 1)
      while (Date.now() < until) {
        /* короткая пауза: файл держит антивирус */
      }
    }
  }
  try {
    unlinkSync(tmp)
  } catch {
    /* noop */
  }
  writeFileSync(file, data, typeof data === 'string' ? encoding : undefined)
}
