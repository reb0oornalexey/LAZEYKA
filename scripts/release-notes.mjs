import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [windowsDir = 'dist', linuxPackage] = process.argv.slice(2)
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const sections = changelog.replace(/\r\n/g, '\n').split(/^## LAZEYKA /m).slice(1)
const section = sections.find((entry) => entry.startsWith(version + '\n'))
if (!section) throw new Error(`В CHANGELOG.md нет версии ${version}`)
const body = section.slice(version.length).trim().replace(/^### /gm, '## ')

const packages = [
  path.join(windowsDir, 'LAZEYKA_x64.exe'),
  path.join(windowsDir, 'LAZEYKA_x64-portable.7z')
]
if (linuxPackage) packages.push(linuxPackage)

const checksums = []
for (const file of packages) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  checksums.push(`- \`${path.basename(file)}\` — \`${hash.digest('hex')}\``)
}

const notes = `release-notes-v${version}.md`
await writeFile(notes, `${body}\n\n## SHA-256\n\n${checksums.join('\n')}\n`, 'utf8')
console.log(notes)
