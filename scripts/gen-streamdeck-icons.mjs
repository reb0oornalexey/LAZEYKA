/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Рисует значки плагина Stream Deck: однотонный квадрат с буквой, PNG без зависимостей.
// Запуск: node scripts/gen-streamdeck-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../streamdeck/com.reb0oorn.lazeyka.sdPlugin/imgs')

// Буквы 5x7.
const GLYPHS = {
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX']
}

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
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, bg, fg, letter) {
  const px = Buffer.alloc(size * size * 4)
  const rows = GLYPHS[letter]
  const scale = Math.max(1, Math.floor((size * 0.56) / 7))
  const gw = 5 * scale
  const gh = 7 * scale
  const ox = Math.floor((size - gw) / 2)
  const oy = Math.floor((size - gh) / 2)
  const edge = Math.max(1, Math.round(size / 36))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = bg
      if (x < edge || y < edge || x >= size - edge || y >= size - edge) color = fg.map((v, i) => Math.round((v + bg[i]) / 2))
      const gx = Math.floor((x - ox) / scale)
      const gy = Math.floor((y - oy) / scale)
      if (x >= ox && y >= oy && gx < 5 && gy < 7 && rows[gy][gx] === 'X') color = fg
      const o = (y * size + x) * 4
      px[o] = color[0]
      px[o + 1] = color[1]
      px[o + 2] = color[2]
      px[o + 3] = 255
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const WHITE = [255, 255, 255]
// [папка, буква, цвет фона, размеры без @2x и с @2x, имя файла]
const sets = [
  { dir: 'actions/vpn', letter: 'V', bg: [37, 99, 235] },
  { dir: 'actions/zapret', letter: 'Z', bg: [22, 163, 74] },
  { dir: 'actions/telegram', letter: 'T', bg: [14, 165, 233] },
  { dir: 'actions/exitlag', letter: 'E', bg: [217, 119, 6] },
  { dir: 'actions/scenario', letter: 'S', bg: [124, 58, 237] }
]
for (const s of sets) {
  mkdirSync(join(root, s.dir), { recursive: true })
  // Значок в списке действий 20x20 / 40x40, картинка кнопки 72x72 / 144x144.
  writeFileSync(join(root, s.dir, 'icon.png'), png(20, s.bg, WHITE, s.letter))
  writeFileSync(join(root, s.dir, 'icon@2x.png'), png(40, s.bg, WHITE, s.letter))
  writeFileSync(join(root, s.dir, 'key.png'), png(72, s.bg, WHITE, s.letter))
  writeFileSync(join(root, s.dir, 'key@2x.png'), png(144, s.bg, WHITE, s.letter))
}
mkdirSync(join(root, 'plugin'), { recursive: true })
const dark = [17, 24, 39]
const cyan = [34, 211, 238]
// Значок плагина 256x256 / 512x512, значок категории 28x28 / 56x56.
writeFileSync(join(root, 'plugin/icon.png'), png(256, dark, cyan, 'L'))
writeFileSync(join(root, 'plugin/icon@2x.png'), png(512, dark, cyan, 'L'))
writeFileSync(join(root, 'plugin/category.png'), png(28, dark, cyan, 'L'))
writeFileSync(join(root, 'plugin/category@2x.png'), png(56, dark, cyan, 'L'))
console.log('Значки записаны в', root)
