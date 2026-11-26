/**
 * Упаковка плагина Stream Deck в .streamDeckPlugin (zip каталога .sdPlugin).
 * Без Electron, только adm-zip и файловая система: проверяется отдельным скриптом.
 * Файлы кладутся без записей-каталогов и с путями через «/» — как у scripts/pack-streamdeck.mjs.
 */
import AdmZip from 'adm-zip'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const PLUGIN_DIR_NAME = 'com.reb0oorn.lazeyka.sdPlugin'
export const PLUGIN_FILE_NAME = 'com.reb0oorn.lazeyka.streamDeckPlugin'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * Собирает архив из каталога плагина. Возвращает число файлов. Бросает ошибку, если нет manifest.json.
 * `overrides` — файлы, которые подменяются при упаковке (путь внутри .sdPlugin через «/» → содержимое),
 * например plugin/codes.js с кодами подписи ссылок этой установки.
 */
export function packPlugin(srcDir: string, outFile: string, overrides: Record<string, string | Buffer> = {}): number {
  const files = walk(srcDir)
  if (!files.some((f) => path.basename(f) === 'manifest.json' && path.dirname(f) === srcDir)) {
    throw new Error('В папке плагина нет manifest.json')
  }
  const zip = new AdmZip()
  const used = new Set<string>()
  for (const f of files) {
    const rel = path.relative(srcDir, f).split(path.sep).join('/')
    const over = overrides[rel]
    if (over !== undefined) used.add(rel)
    zip.addFile(`${PLUGIN_DIR_NAME}/${rel}`, over !== undefined ? Buffer.from(over) : readFileSync(f))
  }
  for (const [rel, data] of Object.entries(overrides)) {
    if (used.has(rel)) continue
    if (rel.startsWith('/') || rel.split('/').includes('..')) continue
    zip.addFile(`${PLUGIN_DIR_NAME}/${rel}`, Buffer.from(data))
  }
  mkdirSync(path.dirname(outFile), { recursive: true })
  writeFileSync(outFile, zip.toBuffer())
  return files.length
}
