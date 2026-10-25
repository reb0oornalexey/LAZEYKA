// Тёмная/Светлая по умолчанию должны совпадать с исходным main.css из github-release.
import './ts-loader.mjs'
import fs from 'node:fs'
const { DARK_TOKENS, LIGHT_TOKENS } = await import('../src/renderer/src/lib/appearance/palettes.ts')
const css = fs.readFileSync(new URL('../github-release/src/renderer/src/assets/main.css', import.meta.url), 'utf8')

function block(selector) {
  const i = css.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`))
  if (i < 0) throw new Error('нет блока ' + selector)
  const start = css.indexOf('{', i) + 1
  let depth = 1, j = start
  while (depth && j < css.length) { const ch = css[j++]; if (ch === '{') depth++; else if (ch === '}') depth-- }
  const body = css.slice(start, j - 1)
  const out = {}
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\s+/g, ' ').trim()
  return out
}
const norm = (v) => String(v).replace(/\s+/g, ' ').trim().toLowerCase()
let bad = 0, total = 0
for (const [name, ours, theirs] of [['light', LIGHT_TOKENS, block(':root')], ['dark', DARK_TOKENS, block('.dark')]]) {
  for (const [k, v] of Object.entries(theirs)) {
    if (!(k in ours)) continue // переменные, которых нет в пресетах, остаются CSS-значениями по умолчанию
    total++
    if (norm(ours[k]) !== norm(v)) { bad++; console.log(`FAIL ${name} --${k}: пресет «${ours[k]}» ≠ исходник «${v}»`) }
  }
}
console.log(bad ? `Расхождений: ${bad} из ${total}` : `OK: совпадают все ${total} значений Тёмная/Светлая с github-release/main.css`)
process.exit(bad ? 1 : 0)
