/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Собирает streamdeck/dist/com.reb0oorn.lazeyka.streamDeckPlugin (zip каталога .sdPlugin).
// Без зависимостей: zip пишется вручную (метод deflate из node:zlib).
// Запуск: node scripts/pack-streamdeck.mjs
import { deflateRawSync } from 'node:zlib'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginName = 'com.reb0oorn.lazeyka.sdPlugin'
const srcDir = join(repo, 'streamdeck', pluginName)
const outFile = join(repo, 'streamdeck', 'dist', 'com.reb0oorn.lazeyka.streamDeckPlugin')

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const d = new Date()
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()

const locals = []
const centrals = []
let offset = 0
for (const file of walk(srcDir)) {
  // Внутри архива путь начинается с каталога плагина, разделитель всегда «/».
  const name = join(pluginName, relative(srcDir, file)).split(sep).join('/')
  const nameBuf = Buffer.from(name, 'utf-8')
  const data = readFileSync(file)
  const comp = deflateRawSync(data)
  const crc = crc32(data)

  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(20, 4)
  lh.writeUInt16LE(0x0800, 6) // имена в UTF-8
  lh.writeUInt16LE(8, 8) // deflate
  lh.writeUInt16LE(dosTime, 10)
  lh.writeUInt16LE(dosDate, 12)
  lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(comp.length, 18)
  lh.writeUInt32LE(data.length, 22)
  lh.writeUInt16LE(nameBuf.length, 26)
  lh.writeUInt16LE(0, 28)
  locals.push(lh, nameBuf, comp)

  const ch = Buffer.alloc(46)
  ch.writeUInt32LE(0x02014b50, 0)
  ch.writeUInt16LE(20, 4)
  ch.writeUInt16LE(20, 6)
  ch.writeUInt16LE(0x0800, 8)
  ch.writeUInt16LE(8, 10)
  ch.writeUInt16LE(dosTime, 12)
  ch.writeUInt16LE(dosDate, 14)
  ch.writeUInt32LE(crc, 16)
  ch.writeUInt32LE(comp.length, 20)
  ch.writeUInt32LE(data.length, 24)
  ch.writeUInt16LE(nameBuf.length, 28)
  ch.writeUInt32LE(offset, 42)
  centrals.push(ch, nameBuf)
  offset += lh.length + nameBuf.length + comp.length
}

const centralBuf = Buffer.concat(centrals)
const count = centrals.length / 2
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(count, 8)
end.writeUInt16LE(count, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, Buffer.concat([...locals, centralBuf, end]))
console.log(`Готово: ${outFile} (файлов: ${count})`)
