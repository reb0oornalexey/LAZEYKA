/**
 * Вывод консольных программ Windows → строка.
 *
 * cmd.exe и системные утилиты (sc, netsh, taskkill, ping) пишут в OEM-кодировке
 * консоли — для русской Windows это CP866. Прочитанный как UTF-8, такой вывод
 * превращается в «кракозябры» (�������). Сначала пробуем UTF-8 (sing-box, Xray,
 * winws и .bat с `chcp 65001` пишут именно его), при ошибке — CP866.
 */
const utf8 = new TextDecoder('utf-8', { fatal: true })
let oem: TextDecoder | null = null
try {
  oem = new TextDecoder('ibm866')
} catch {
  oem = null
}

export function decodeConsole(buf: Buffer | string): string {
  if (typeof buf === 'string') return buf
  try {
    return utf8.decode(buf)
  } catch {
    return oem ? oem.decode(buf) : buf.toString('latin1')
  }
}

/**
 * Потоковый вариант: кусок stdout может оборваться посреди многобайтового
 * UTF-8 символа — тогда хвост (до 3 байт) переносится в следующий кусок, а не
 * считается «не UTF-8».
 */
export function createConsoleDecoder(): (buf: Buffer) => string {
  let carry = Buffer.alloc(0)
  return (chunk: Buffer): string => {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
    carry = Buffer.alloc(0)
    for (let cut = 0; cut <= 3 && cut < buf.length; cut++) {
      try {
        const text = utf8.decode(buf.subarray(0, buf.length - cut))
        carry = Buffer.from(buf.subarray(buf.length - cut))
        return text
      } catch {
        /* пробуем отрезать ещё байт */
      }
    }
    return oem ? oem.decode(buf) : buf.toString('latin1')
  }
}
