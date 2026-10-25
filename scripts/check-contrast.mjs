// Проверки подбора контраста: node scripts/check-contrast.mjs
import * as core from '../src/renderer/src/lib/appearance/contrast-core.ts'

const { hexToRgba, contrast, solveForeground, solveBackground, rgbToOklch, effectiveBackground, flatten } = core
let failed = 0
const ok = (name, cond, info = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${info}`)
  if (!cond) failed++
}
const H = (s) => hexToRgba(s)

// 1. Тёмный фон + тёмный текст → текст становится светлее, оттенок сохраняется.
{
  const bg = H('#0b0d10')
  const fg = H('#2a4a6a')
  const out = solveForeground(fg, bg, 4.5)
  const a = rgbToOklch(fg)
  const b = rgbToOklch(out)
  ok('тёмный фон: текст светлеет', b.l > a.l, `L ${a.l.toFixed(2)} → ${b.l.toFixed(2)}`)
  ok('тёмный фон: контраст ≥ 4.5', contrast(out, bg) >= 4.5, contrast(out, bg).toFixed(2))
  ok('оттенок сохранён', Math.abs(Math.atan2(Math.sin(a.h - b.h), Math.cos(a.h - b.h))) < 0.25)
}
// 2. Светлый фон + светлый текст → темнее.
{
  const bg = H('#eef1f4')
  const fg = H('#b5c3d6')
  const out = solveForeground(fg, bg, 4.5)
  ok('светлый фон: текст темнеет', rgbToOklch(out).l < rgbToOklch(fg).l)
  ok('светлый фон: контраст ≥ 4.5', contrast(out, bg) >= 4.5, contrast(out, bg).toFixed(2))
}
// 3. Уже читаемый цвет не меняется.
{
  const bg = H('#0b0d10')
  const fg = H('#e8edf2')
  ok('читаемый цвет не трогаем', solveForeground(fg, bg) === fg)
}
// 4. Полупрозрачная панель над обоями с затемнением.
{
  const eff = effectiveBackground({
    panel: H('#12151a'),
    appBg: H('#0b0d10'),
    wallpaperAverage: H('#c8c8c8'),
    dimColor: H('#000000'),
    dim: 0.3,
    panelOpacity: 0.5
  })
  // Над светлыми обоями полупрозрачная тёмная панель заметно светлее самой себя.
  ok('панель над обоями светлее исходной', eff.r > 0x12 + 40, `rgb(${eff.r | 0},${eff.g | 0},${eff.b | 0})`)
  const fg = H('#9aa4b0')
  const out = solveForeground(fg, eff, 4.5)
  ok('текст на панели над обоями ≥ 4.5', contrast(out, eff) >= 4.5, contrast(out, eff).toFixed(2))
  // Если ошибочно считать панель непрозрачной, получим другой фон — проверяем, что мы это не делаем.
  const naive = flatten(H('#12151a'), H('#0b0d10'))
  ok('учёт прозрачности меняет результат', Math.abs(naive.r - eff.r) > 20)
}
// 5. Недостижимая цель → почти-белый/почти-чёрный.
{
  const bg = H('#777777')
  const out = solveForeground(H('#7a7a7a'), bg, 12)
  ok('недостижимый контраст → крайний цвет', out.r > 230 || out.r < 30, `r=${out.r}`)
}
// 6. Подбор фона при неизменном тексте.
{
  const canvas = H('#0b0d10')
  const fg = H('#e8edf2')
  const bg = H('#8a96a3')
  const out = solveBackground(bg, fg, canvas, 1, 4.5)
  ok('фон темнеет под светлый текст', rgbToOklch(out).l < rgbToOklch(bg).l && contrast(fg, flatten(out, canvas)) >= 4.5)
}
console.log(failed ? `\n${failed} проверок не прошло` : '\nВсе проверки контраста прошли')
process.exit(failed ? 1 : 0)
