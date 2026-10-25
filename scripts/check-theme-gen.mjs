// Проверка подбора темы под обои: node scripts/check-theme-gen.mjs
// Картинки берём из scripts/wallpaper-pixels.json (его делает dump-wallpaper-pixels.py; sharp в проекте нет).
import './ts-loader.mjs'
import fs from 'node:fs'
const { quantize, statsOf } = await import('../src/renderer/src/lib/appearance/palette.ts')
const { generateTheme } = await import('../src/renderer/src/lib/appearance/theme-gen.ts')

const pixels = JSON.parse(fs.readFileSync(new URL('./wallpaper-pixels.json', import.meta.url), 'utf8'))
// Синтетические проверки: светлая и очень пёстрая картинки.
const synth = {
  'синт-светлая': Array.from({ length: 900 }, (_, i) => (i % 9 === 0 ? [240, 120, 90] : [236 - (i % 7), 232, 222])),
  'синт-пёстрая': Array.from({ length: 900 }, (_, i) => (i % 2 ? [250, 250, 250] : [10, 20, 200]))
}
Object.assign(pixels, synth)
let failed = 0
const result = {}
for (const [name, px] of Object.entries(pixels)) {
  const stats = statsOf(px)
  const theme = generateTheme(quantize(px, 5), { average: stats.average, luminance: stats.luminance, spread: stats.spread })
  const good = theme.issues === 0
  console.log(`${good ? 'OK  ' : 'FAIL'} ${name}: режим ${theme.mode}, проблем читаемости ${theme.issues}, dim ${theme.settings.bgDim}, панели ${theme.settings.panelOpacity}, акцент ${theme.tokens.primary}`)
  if (!good) failed++
  result[name] = theme
}
if (process.argv.includes('--write')) {
  const body =
    '// Сгенерировано scripts/check-theme-gen.mjs --write по встроенным обоям. Не править вручную.\n' +
    "export interface PrecomputedTheme {\n  mode: AppearanceMode\n  tokens: Record<string, string>\n  settings: { bgDim: number; bgDimColor: string; panelOpacity: number }\n}\n\n" +
    'export const WALLPAPER_THEMES: Record<string, PrecomputedTheme> = ' +
    JSON.stringify(
      Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith('синт')).map(([k, v]) => [`builtin:${k}`, { mode: v.mode, tokens: v.tokens, settings: v.settings }])),
      null,
      2
    ).replace(/"([a-zA-Z]+)":/g, '$1:').replace(/"/g, "'") +
    '\n'
  fs.writeFileSync(new URL('../src/renderer/src/lib/appearance/wallpaper-themes.ts', import.meta.url), body)
  console.log('wallpaper-themes.ts записан')
}
process.exit(failed ? 1 : 0)
