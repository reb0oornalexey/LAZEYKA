// Аудит оформления: node scripts/audit-appearance.mjs
// 1) каждый выставленный в интерфейсе цвет реально читается где-то в CSS/компонентах приложения;
// 2) каждый такой цвет и каждая настройка имеют потребителя в предпросмотре.
import './ts-loader.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/src')
const { EXPOSED_KEYS, SIMPLE_GROUPS, ADVANCED_GROUPS } = await import('../src/renderer/src/lib/appearance/tokens.ts')

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
const rel = (p) => path.relative(root, p).replaceAll('\\', '/')
const files = walk(root).filter((f) => /\.(tsx|ts|css)$/.test(f))
const read = (f) => fs.readFileSync(f, 'utf8')
const css = read(path.join(root, 'assets/main.css'))

// Файлы самого редактора оформления в «приложение» не входят.
const isEditor = (f) => /^(components\/appearance\/|lib\/appearance\/|pages\/appearance\.tsx)/.test(rel(f)) && !rel(f).endsWith('background-layer.tsx')
const appFiles = files.filter((f) => !isEditor(f) && !f.endsWith('.css'))
const appText = appFiles.map((f) => [rel(f), read(f)])

// Компоненты, из которых собран предпросмотр (настоящие, те же что в приложении).
const PREVIEW_PARTS = ['components/ui/button.tsx', 'components/ui/input.tsx', 'components/ui/switch.tsx', 'components/ui/badge.tsx', 'components/ui/card.tsx', 'components/app-chrome.tsx', 'components/appearance/preview.tsx']
const previewText = PREVIEW_PARTS.map((p) => [p, read(path.join(root, p))])

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const varRx = (k) => new RegExp(`var\\(--${esc(k)}[,)\\s]`)
const utilRx = (k) => new RegExp(`(?<![\\w-])(?:[a-z0-9\\[\\]=:_&>*-]+:)*(?:text|bg|border|ring|outline|fill|stroke|from|to|via|shadow|divide|accent|caret|decoration)-${esc(k)}(?:/[0-9.\\[\\]]+)?(?![\\w-])`)
const hasTheme = (k) => new RegExp(`--color-${esc(k)}:`).test(css)

/** Читается ли переменная: напрямую, через Tailwind-класс или как источник другой CSS-переменной. */
function consumers(k, texts, withCss) {
  const out = []
  for (const [n, t] of texts) if (varRx(k).test(t) || (hasTheme(k) && utilRx(k).test(t))) out.push(n)
  if (withCss) {
    // В main.css переменную читают правила и другие переменные (кроме её собственного объявления).
    const lines = css.split('\n').filter((l) => varRx(k).test(l) || (hasTheme(k) && false))
    if (lines.length) out.push('assets/main.css')
    if (hasTheme(k) && /@theme/.test(css)) {
      // utility-имя из @theme нужно только когда есть класс — он учтён выше
    }
  }
  return out
}

let bad = 0
const unused = []
console.log('== 1. Каждый выставленный цвет читается приложением ==')
for (const k of EXPOSED_KEYS) {
  const c = consumers(k, appText, true)
  if (c.length === 0) {
    unused.push(k)
    bad++
    console.log(`FAIL  --${k}: ничего не читает`)
  }
}
if (!unused.length) console.log(`OK    все ${EXPOSED_KEYS.length} цветов используются`)

console.log('\n== 2. Каждый цвет виден в предпросмотре ==')
const previewMiss = []
for (const k of EXPOSED_KEYS) {
  // Через настоящие компоненты предпросмотра или через глобальные правила main.css (скроллбар, база).
  const c = consumers(k, previewText, true)
  // Шаблон var(--toast-${kind}-bg) в preview.tsx раскрываем вручную; data-pick потребителем не считается.
  const direct = k.startsWith('toast-') && previewText.some(([, t]) => t.includes('var(--toast-${kind}-'))
  if (c.length === 0 && !direct) {
    previewMiss.push(k)
    bad++
    console.log(`FAIL  --${k}: в предпросмотре нет потребителя`)
  }
}
if (!previewMiss.length) console.log('OK    у каждого цвета есть потребитель в предпросмотре')

console.log('\n== 3. Настройки → потребители в предпросмотре ==')
const preview = read(path.join(root, 'components/appearance/preview.tsx'))
const bgl = read(path.join(root, 'components/appearance/background-layer.tsx'))
const resolve = read(path.join(root, 'lib/appearance/resolve.ts'))
const checks = [
  ['fontFamily', `--font-sans выставляется (${/--font-sans/.test(resolve)}) и читается в main.css`, /--font-sans/.test(resolve) && /var\(--font-sans\)|--font-sans/.test(css)],
  ['fontScale', '--ui-font-scale → font-size html (rem-размеры предпросмотра)', /--ui-font-scale/.test(resolve) && /--ui-font-scale/.test(css)],
  ['radius', '--radius → rounded-* в Button/Card/Input', /--radius/.test(resolve) && /--radius/.test(css) && /rounded-/.test(read(path.join(root, 'components/ui/button.tsx')))],
  ['density', '--spacing → отступы Tailwind в предпросмотре', /--spacing/.test(resolve) && /(?:^|\s)(?:p|px|py|gap|space-y)-/.test(preview)],
  ['sidebarWidth', 'preview.tsx читает var(--sidebar-width)', /var\(--sidebar-width/.test(preview)],
  ['animations', 'классы motion-off/motion-auto в main.css действуют на документ целиком', /motion-off/.test(css)],
  ['bgImage/bgFit', 'BackgroundLayer в предпросмотре', /BackgroundLayer/.test(preview) && /bgFit/.test(bgl)],
  ['bgBlur', 'filter: blur на слое фона', /blur\(/.test(bgl)],
  ['bgDim/bgDimColor', 'оверлей затемнения', /bgDimColor/.test(bgl) && /bgDim/.test(bgl)],
  ['bgBrightness', 'brightness() на слое фона', /brightness\(/.test(bgl)],
  ['bgSaturation', 'saturate() на слое фона', /saturate\(/.test(bgl)],
  ['panelOpacity', 'withPanelAlpha → --background/--card/... в Card и aside', /withPanelAlpha/.test(resolve) && /bg-card|bg-sidebar/.test(read(path.join(root, 'components/ui/card.tsx')) + preview)],
  ['bgGlass', '.bg-glass в main.css', /bg-glass/.test(css)],
  ['bgGradient*', 'градиент в BackgroundLayer', /bgGradientFrom/.test(bgl)],
  ['bgAnimate/bgPauseOnBlur', 'в предпросмотре — неподвижный кадр (staticOnly), в окне — управляет видео', /staticOnly/.test(bgl)]
]
for (const [name, what, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}: ${what}`)
  if (!ok) bad++
}

console.log('\n== 4. Охват предпросмотра (data-pv) ==')
{
  const ts = (await import('typescript')).default
  const { PV } = await import('../src/renderer/src/lib/appearance/pv-map.ts')
  const src = read(path.join(root, 'components/appearance/preview.tsx'))
  const sf = ts.createSourceFile('preview.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const LEAF_TAGS = new Set(['Button', 'Badge', 'Input', 'Switch', 'NavItem', 'BrandText'])
  // Компоненты этого же файла, которые сами ставят метку.
  const SELF_MARKED = { Muted: ['muted'], ToastMock: ['toast-normal'], StatusDots: ['dot-success'] }
  const ids = new Set(Object.keys(PV))
  const problems = []
  const tagOf = (n) => (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText(sf)
  const attrsOf = (n) => (ts.isJsxElement(n) ? n.openingElement : n).attributes.properties
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  /** Какие id могут быть у элемента: из pv('..'), тернаров и шаблонов `btn-${v}`. */
  function pvOf(n) {
    const out = { ids: null, live: false, skip: false }
    for (const a of attrsOf(n)) {
      if (ts.isJsxSpreadAttribute(a)) {
        const e = a.expression
        if (ts.isIdentifier(e) && e.text === 'live') out.live = true
        if (ts.isCallExpression(e) && e.expression.getText(sf) === 'pv') {
          const found = []
          const visit = (x) => {
            if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) found.push(x.text)
            else if (ts.isTemplateExpression(x)) {
              const rx = new RegExp('^' + [x.head.text, ...x.templateSpans.map((t) => '.+' + t.literal.text)].map((t, i) => (i ? t.replace(/^\.\+/, '.+') : t)).join('') + '$')
              for (const id of ids) if (rx.test(id)) found.push(id)
            } else ts.forEachChild(x, visit)
          }
          if (e.arguments[0]) visit(e.arguments[0])
          out.ids = found
        }
      } else if (ts.isJsxAttribute(a)) {
        const nm = a.name.getText(sf)
        if (nm === 'data-pv-skip') out.skip = true
        if (nm === 'pv' && tagOf(n) === 'PageHeader') out.ids = ['header-bar', 'header-title']
      }
    }
    const t = tagOf(n)
    if (!out.ids && SELF_MARKED[t]) out.ids = SELF_MARKED[t]
    return out
  }
  const elementsUp = (n) => {
    const list = []
    for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) list.push(p)
    return list
  }
  function owner(n, includeSelf) {
    const chain = [...(includeSelf && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) ? [n] : []), ...elementsUp(n)]
    for (const e of chain) {
      const m = pvOf(e)
      if (m.live) return { live: true }
      if (m.ids) return { ids: m.ids, node: e }
    }
    return null
  }
  const check = (n, what, needLeaf) => {
    const o = owner(n, what !== 'text')
    if (o?.live) return
    if (!o) return problems.push(`строка ${lineOf(n)}: ${what} без data-pv`)
    for (const id of o.ids) if (!ids.has(id)) problems.push(`строка ${lineOf(n)}: неизвестная группа «${id}»`)
    if (needLeaf && !o.ids.every((id) => PV[id]?.kind === 'leaf')) problems.push(`строка ${lineOf(n)}: ${what} лежит прямо в контейнере (${o.ids.join('/')}), нужна метка самого текста/контрола`)
  }
  let n_checked = 0
  const walk = (n) => {
    if (ts.isJsxText(n) && n.text.trim()) { check(n, 'текст «' + n.text.trim().slice(0, 24) + '»', true); n_checked++ }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const t = tagOf(n)
      const m = pvOf(n)
      if (LEAF_TAGS.has(t) && !m.skip) { check(n, `<${t}>`, true); n_checked++ }
      const cls = attrsOf(n).find((a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className')
      const txt = cls?.initializer ? cls.initializer.getText(sf) : ''
      if (!m.skip && /(^|[\s"'`:])(bg-|border(?![-\w]*:)(?=[\s"'`]|-[a-z]))/.test(txt) && !/pointer-events-none/.test(txt)) { check(n, `<${t}> с фоном/рамкой`, false); n_checked++ }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  // Каждый выставленный цвет должен быть достижим кликом в предпросмотре.
  const reachable = new Set(Object.values(PV).flatMap((g) => g.props.map((x) => x.key)))
  const unreachable = EXPOSED_KEYS.filter((k) => !reachable.has(k))
  for (const k of Object.values(PV).flatMap((g) => g.props.map((x) => x.key))) if (!EXPOSED_KEYS.includes(k)) problems.push(`в pv-map ключ «${k}» не выставлен в настройках`)
  for (const k of unreachable) problems.push(`цвет --${k} нельзя выбрать кликом в предпросмотре`)
  for (const p of problems) console.log('FAIL  ' + p)
  if (!problems.length) console.log(`OK    проверено узлов: ${n_checked}; все цвета (${EXPOSED_KEYS.length}) достижимы кликом`)
  bad += problems.length
}

console.log('\n== 5. Сводка ==')
console.log(`цветов в простом режиме: ${SIMPLE_GROUPS.reduce((n, g) => n + g.colors.length, 0)}, в расширенном: ${ADVANCED_GROUPS.reduce((n, g) => n + g.blocks.reduce((m, b) => m + b.tokens.length, 0), 0)}`)
console.log(bad ? `ПРОВАЛ: ${bad}` : 'Аудит пройден')
process.exit(bad ? 1 : 0)
