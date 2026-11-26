/**
 * Веб-приложение «Пульт LAZEYKA», которое сервер раздела «Локальная сеть» отдаёт телефону:
 * одна оболочка с вкладками «Пульт», «Подключение» (бывшая страница /setup) и «Ещё», плюс описание веб-приложения
 * (manifest) для установки на экран «Домой». Стили — lan-remote-css.ts, поведение — lan-remote-js.ts.
 * Не зависит от Electron.
 *
 * Страницы работают без интернета (отдаются с компьютера): ни внешних шрифтов, ни скриптов, ни картинок.
 * Строгая CSP выставляется сервером (lan-server.ts): inline-стили и скрипты разрешены только с одноразовым кодом,
 * на место которого сервер подставляет NONCE_TOKEN. Поэтому в разметке нет атрибутов style="…".
 */

import { SHELL_CSS } from './lan-remote-css'
import { SHELL_JS } from './lan-remote-js'

export const NONCE_TOKEN = '__NONCE__'

export interface ProxyGuide {
  id: string
  title: string
  steps: string[]
  note?: string
  /** Какие приложения на этом устройстве системный прокси обычно игнорируют. */
  ignores?: string
}

export const PROXY_HONEST_NOTE =
  'Через настройку прокси работают браузер и часть приложений. Многие приложения прокси Wi-Fi игнорируют: Telegram, мессенджеры с голосовыми звонками, игры, часть приложений видеосервисов. Для Telegram есть отдельная кнопка добавления прокси.'

export const QUIC_HINT =
  'Через прокси телефон не может использовать QUIC (быстрый протокол на UDP, его любят YouTube и Google). Видео идёт по обычному TCP: это нормально, но на плохом канале загрузка может быть чуть медленнее, чем на компьютере.'

/** VPN-приложение на телефоне часто заворачивает в туннель и адреса домашней сети — тогда пульт и эта страница не открываются. */
export const PHONE_VPN_HINT =
  'Если на телефоне включён VPN, пульт может не открыться — в настройках VPN-приложения включите доступ к локальной сети или выключите VPN на время.'

export const TELEGRAM_HINT =
  'Telegram не смотрит на прокси Wi-Fi, его нужно добавить в самом приложении. Нажмите кнопку на телефоне: Telegram предложит подключить прокси, останется подтвердить.'

export const PROXY_GUIDES: ProxyGuide[] = [
  {
    id: 'ios',
    title: 'iPhone/iPad',
    steps: [
      'Откройте Настройки, затем Wi-Fi.',
      'Нажмите значок «i» рядом с вашей сетью.',
      'Внизу выберите «Настроить прокси», затем «Вручную».',
      'В поле «Сервер» впишите адрес компьютера, в поле «Порт» — порт прокси.',
      'Если включён пароль, включите «Аутентификация» и впишите логин и пароль.',
      'Нажмите «Сохранить».'
    ],
    note: 'iPhone понимает только HTTP-прокси, и настройка действует только в этой сети Wi-Fi. Чтобы отключить, верните «Выкл.».',
    ignores:
      'Прокси Wi-Fi обычно не используют: Telegram, WhatsApp и другие мессенджеры (звонки и свои соединения), игры, приложения с собственным сетевым кодом. Браузеры и многие обычные приложения прокси учитывают.'
  },
  {
    id: 'android',
    title: 'Android',
    steps: [
      'Откройте Настройки, затем Сеть и интернет, затем Wi-Fi.',
      'Нажмите на вашу сеть (на некоторых телефонах — шестерёнку рядом или долгое нажатие), затем «Изменить сеть».',
      'Раскройте «Дополнительно» и в списке «Прокси» выберите «Вручную».',
      'В «Имя узла прокси» впишите адрес компьютера, в «Порт» — порт прокси.',
      'Нажмите «Сохранить».'
    ],
    note: 'В системных настройках Android нет полей для логина и пароля: при включённом пароле браузер спросит его сам, а часть приложений не подключится. Названия пунктов зависят от оболочки телефона.',
    ignores:
      'Прокси Wi-Fi часто игнорируют: Telegram, WhatsApp, игры, приложения YouTube и соцсетей с собственным сетевым кодом. Chrome и браузеры на его основе прокси учитывают.'
  },
  {
    id: 'ps5',
    title: 'PlayStation 5',
    steps: [
      'Откройте Настройки, затем Сеть, затем Настройки.',
      'Выберите «Установить соединение с интернетом» и вашу сеть (Wi-Fi или кабель), затем «Настроить вручную».',
      'В пункте «Прокси-сервер» выберите «Использовать».',
      'Впишите адрес компьютера и порт прокси, подтвердите.',
      'Проверьте соединение кнопкой «Проверить подключение к Интернету».'
    ],
    note: 'PlayStation не умеет логин и пароль для прокси — для неё пароль на прокси лучше не ставить (или раздать Wi-Fi с компьютера). Игровой трафик прокси обычно не использует.',
    ignores: 'Игры и сетевой игровой трафик прокси не используют: он идёт напрямую. Прокси работает для системных запросов и браузера консоли.'
  },
  {
    id: 'xbox',
    title: 'Xbox',
    steps: [
      'У Xbox One и Xbox Series нет настройки прокси-сервера.',
      'Используйте «Раздать Wi-Fi» с этого компьютера и подключите приставку к созданной сети.',
      'Или настройте прокси на роутере либо в сети, к которой подключена приставка.'
    ],
    ignores: 'Настроек прокси нет вообще: приставка не использует прокси компьютера.'
  },
  {
    id: 'switch',
    title: 'Nintendo Switch',
    steps: [
      'У Nintendo Switch нет настройки прокси-сервера.',
      'Используйте «Раздать Wi-Fi» с этого компьютера и подключите консоль к созданной сети.'
    ],
    ignores: 'Настроек прокси нет вообще: консоль не использует прокси компьютера.'
  },
  {
    id: 'tv',
    title: 'Телевизор',
    steps: [
      'У большинства телевизоров (Samsung, LG, Sony, Xiaomi) в сетевых настройках нет поля для прокси.',
      'Самый простой путь — «Раздать Wi-Fi» с компьютера и подключить телевизор к созданной сети.',
      'На Android TV можно поставить приложение вроде v2rayNG или Hiddify: добавьте в нём прокси с адресом компьютера и портом (тип SOCKS5 или HTTP).',
      'На некоторых моделях прокси есть в расширенных настройках Wi-Fi — тогда впишите адрес и порт так же, как на телефоне.'
    ],
    ignores: 'Приложения телевизора (YouTube, онлайн-кинотеатры) системный прокси чаще всего игнорируют, если он вообще есть.'
  }
]

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export interface TelegramLinks {
  /** tg://socks?… — открывает приложение Telegram. */
  tg: string
  /** https://t.me/socks?… — то же через сайт (работает и там, где tg:// заблокирован браузером). */
  https: string
}

/** Ссылки «добавить SOCKS5-прокси в Telegram». Логин и пароль — только если переданы оба. */
export function buildTelegramLinks(o: { host: string; port: number; user?: string; pass?: string }): TelegramLinks {
  let q = `server=${encodeURIComponent(o.host)}&port=${o.port}`
  if (o.user && o.pass) q += `&user=${encodeURIComponent(o.user)}&pass=${encodeURIComponent(o.pass)}`
  return { tg: `tg://socks?${q}`, https: `https://t.me/socks?${q}` }
}

// ---- Оболочка веб-приложения -------------------------------------------------------------------

/** Данные вкладки «Подключение»: адрес и порт прокси; пароль прокси сюда не попадает. */
export interface SetupInfo {
  host: string
  port: number
  authRequired: boolean
}

export interface ShellContext {
  /** null — раздача на устройства выключена. */
  setup: SetupInfo | null
  /** Пульт включён в программе. */
  remote: boolean
  /** С какой вкладки открыть («/» — пульт, «/setup» — подключение). */
  tab: 'remote' | 'setup'
  /** В ссылке был неверный код. */
  keyBad: boolean
}

export const THEME_DARK = '#0a0c0f'
export const THEME_LIGHT = '#f1f3f5'

/** Описание веб-приложения для «На экран Домой» / «Установить приложение». */
export function buildManifest(startUrl: string): Record<string, unknown> {
  return {
    name: 'LAZEYKA — пульт',
    short_name: 'LAZEYKA',
    description: 'Пульт программы LAZEYKA в домашней сети',
    lang: 'ru',
    dir: 'ltr',
    id: '/',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: THEME_DARK,
    background_color: THEME_DARK,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
    ]
  }
}

/** Значки интерфейса (контуры 24×24, цвет — currentColor). */
const P = (d: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`

export const ICONS: Record<string, string> = {
  shield: P('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9-4.3-1.6-7.5-5.3-7.5-9.9V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>'),
  shieldOff: P('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9-4.3-1.6-7.5-5.3-7.5-9.9V6z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>'),
  zapret: P('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.9-4.3-1.6-7.5-5.3-7.5-9.9V6z"/><path d="M9 14.5c1.5-3.2 4.5-3.2 6-6"/>'),
  vpn: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>'),
  tg: P('<path d="M21.2 4.6L2.9 11.5c-.9.4-.9 1.1 0 1.3l4.6 1.4 1.8 5.4c.2.6.9.8 1.4.4l2.6-2.2 4.6 3.4c.6.4 1.3.1 1.5-.6l3-14.7c.2-.9-.4-1.5-1.2-1.2z"/><path d="M7.5 14.2l10-6.7-7.6 7.6"/>'),
  exitlag: P('<path d="M6 11h4M8 9v4"/><path d="M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-3.9 3.2l-1.1 5.6a2.9 2.9 0 0 0 5.2 2.2L8.5 14h7l1.6 2a2.9 2.9 0 0 0 5.2-2.2l-1.1-5.6A4 4 0 0 0 17.3 5z"/>'),
  power: P('<path d="M12 3v8"/><path d="M6.3 6.6a8 8 0 1 0 11.4 0"/>'),
  refresh: P('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20.5V16h-4.5"/>'),
  remote: P('<rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/>'),
  link: P('<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.2 15.7a5.5 5.5 0 0 1 7.6 0"/><path d="M2 9.3a14.5 14.5 0 0 1 20 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
  more: P('<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>'),
  chev: P('<path d="M9 5l7 7-7 7"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: P('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
  plusSq: P('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>'),
  dots: P('<circle cx="12" cy="5.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor"/>'),
  copy: P('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
  lock: P('<rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  alert: P('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  wifiOff: P('<path d="M2 9.3a14.5 14.5 0 0 1 4.6-3M10.5 4.6A14.5 14.5 0 0 1 22 9.3"/><path d="M5 12.5a10 10 0 0 1 4-2.4M15.5 10.6a10 10 0 0 1 3.5 1.9"/><path d="M8.2 15.7a5.5 5.5 0 0 1 7.6 0"/><path d="M3 3l18 18"/>'),
  server: P('<rect x="3.5" y="4" width="17" height="7" rx="2.2"/><rect x="3.5" y="13" width="17" height="7" rx="2.2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>'),
  dns: P('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3.5 9h17M3.5 15h17"/>'),
  qr: P('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>'),
  bell: P('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  moon: P('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  phone: P('<rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M11 18.5h2"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>'),
  pulse: P('<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'),
  play: P('<path d="M8 5.5v13l10-6.5z"/>'),
  logout: P('<path d="M14.5 4.5H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3.5"/><path d="M10 16l-4-4 4-4M6 12h10"/>')
}

/** Знак LAZEYKA — та же «трещина» в тёмном скруглённом квадрате, что у программы (resources/lazeyka_logo_crack.svg). */
export const LOGO_SVG =
  '<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="lzb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12161a"/><stop offset="1" stop-color="#06080a"/></linearGradient><linearGradient id="lzc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8bffbc"/><stop offset="1" stop-color="#1fd873"/></linearGradient><filter id="lzg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="512" height="512" rx="112" fill="url(#lzb)"/><rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="#1e2528" stroke-width="3"/><path d="M176 78L224 176L172 214L268 306L214 344L320 434" fill="none" stroke="url(#lzc)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" filter="url(#lzg)"/></svg>'

const TG_BRAND =
  '<svg class="tgi" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#2AABEE"/><path d="M10.9 23.4l20.6-7.9c1-.4 1.8.2 1.5 1.7l-3.5 16.5c-.3 1.2-1 1.5-2 .9l-5.4-4-2.6 2.5c-.3.3-.5.5-1.1.5l.4-5.5 10-9c.4-.4-.1-.6-.7-.2l-12.3 7.8-5.3-1.7c-1.2-.4-1.2-1.1.4-1.6z" fill="#fff"/></svg>'

/** JSON для <script type="application/json">: «<» экранируется, чтобы строка не закрыла тег. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function guideKey(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, '')
}

/** Вкладка «Подключение» (бывшая /setup) — рисуется сервером, работает и без скриптов. */
function setupView(setup: SetupInfo | null): string {
  const invite = `<div class="invite hide" id="invite"><div class="qr">${ICONS.qr}</div><div><b>Чтобы управлять программой</b><p>Отсканируйте QR пульта в LAZEYKA: раздел «Локальная сеть» на компьютере.</p></div></div>`
  if (!setup) {
    return `${invite}<h2 class="sec">Прокси для устройств</h2><div class="card small muted" data-tour="lan-setup-address">Раздача интернета на устройства выключена в программе на компьютере. Её включают в разделе «Локальная сеть».</div>`
  }
  const host = escapeHtml(setup.host)
  const tg = buildTelegramLinks({ host: setup.host, port: setup.port })
  const auth = setup.authRequired
    ? `<div class="note">${'Для прокси включён пароль. Логин и пароль смотрите в программе на компьютере и впишите вручную: в эту страницу и в ссылку для Telegram они не попадают.'}</div>`
    : ''
  const tabs = PROXY_GUIDES.map((g, i) => `<button type="button" data-guide="${guideKey(g.id)}"${i === 0 ? ' class="on"' : ''}>${escapeHtml(g.title)}</button>`).join('')
  const panels = PROXY_GUIDES.map((g, i) => {
    const steps = g.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
    const note = g.note ? `<div class="note">${escapeHtml(g.note)}</div>` : ''
    const ign = g.ignores ? `<div class="note warn"><b>Что не заработает.</b> ${escapeHtml(g.ignores)}</div>` : ''
    return `<div class="guide card${i === 0 ? '' : ' js-hide'}" data-panel="${guideKey(g.id)}"><ol>${steps}</ol>${note}${ign}</div>`
  }).join('')
  return `${invite}
<h2 class="sec">Прокси для этого устройства</h2>
<div class="card" data-tour="lan-setup-address">
<div class="addr"><div><div class="l">Адрес</div><div class="v mono">${host}</div></div><button class="cp" type="button" data-copy="${host}" aria-label="Копировать адрес">${ICONS.copy}<span>Копировать</span></button></div>
<div class="addr"><div><div class="l">Порт</div><div class="v mono">${setup.port}</div></div><button class="cp" type="button" data-copy="${setup.port}">${ICONS.copy}<span>Копировать</span></button></div>
${auth}</div>
<h2 class="sec">Telegram</h2>
<div class="card" data-tour="lan-setup-telegram">
<div class="tgh">${TG_BRAND}<div><b>Прокси для Telegram</b><div class="small muted">Отдельно от настроек Wi-Fi</div></div></div>
<div class="small muted">${escapeHtml(TELEGRAM_HINT)}</div>
<div class="stack"><a class="btn tgb" href="${escapeHtml(tg.tg)}">Добавить прокси в Telegram</a><a class="btn" href="${escapeHtml(tg.https)}">Если не открылось: через t.me</a></div>
${setup.authRequired ? '<div class="note">Telegram спросит логин и пароль после добавления: впишите те, что показаны в программе.</div>' : ''}
</div>
<div class="card setup-check">
<b>Проверьте, что телефон использует прокси</b>
<p class="small muted">После настройки прокси Wi-Fi проверьте маршрут браузера прямо здесь.</p>
<button class="btn" id="setup-phone" type="button">${ICONS.phone}<b>Проверить этот телефон</b></button>
<p class="net-message hide" id="setup-phone-result" role="status"></p>
</div>
<h2 class="sec">Как включить прокси</h2>
<div class="seg" role="tablist" data-tour="lan-setup-guides">${tabs}</div>
${panels}
<details class="more"><summary>Какие приложения не пойдут через прокси ${ICONS.chev}</summary><p>${escapeHtml(PROXY_HONEST_NOTE)}</p><p>${escapeHtml(QUIC_HINT)}</p></details>
<div class="note" data-tour="lan-setup-vpn-hint"><b>VPN на телефоне.</b> ${escapeHtml(PHONE_VPN_HINT)}</div>`
}

/** Вся оболочка. Динамические части (пульт, «Ещё») строит скрипт; данные из сети вставляются только через textContent. */
export function buildShellPage(ctx: ShellContext): string {
  const boot = { remote: ctx.remote, tab: ctx.tab, keyBad: ctx.keyBad, hasSetup: Boolean(ctx.setup) }
  const n = NONCE_TOKEN
  return `<!doctype html>
<html lang="ru" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="${THEME_DARK}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LAZEYKA">
<meta name="application-name" content="LAZEYKA">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" id="lz-mf" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<title>LAZEYKA</title>
<style nonce="${n}">${SHELL_CSS}</style>
<script nonce="${n}">(function(){try{var t=localStorage.getItem('lz.theme')||'auto';var d=t==='auto'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):t;document.documentElement.setAttribute('data-theme',d)}catch(e){}})()</script>
</head><body class="guest">
<header class="top" id="top">${LOGO_SVG}<div class="ttl"><b>LAZEYKA</b><small id="sub">${ctx.tab === 'setup' ? 'Подключение устройства' : 'Пульт'}</small></div>
<span class="conn hide" id="conn" data-q="wait"><i></i><span id="connt">Связь…</span></span>
<button class="icbtn hide" id="refresh" type="button" aria-label="Обновить">${ICONS.refresh}</button></header>
<div id="ptr">${ICONS.refresh}</div>
<div id="toasts" role="status" aria-live="polite"></div>
<main>
<section class="view" id="v-remote" data-tour="lan-remote-tiles"></section>
<section class="view" id="v-setup">${setupView(ctx.setup)}</section>
<section class="view" id="v-more"></section>
<section class="view" id="v-closed"></section>
</main>
<nav class="tabbar" aria-label="Разделы"><div class="in">
<button class="tab" type="button" data-tab="remote"><span class="tp">${ICONS.remote}</span>Пульт</button>
<button class="tab" type="button" data-tab="setup"><span class="tp">${ICONS.link}</span>Подключение</button>
<button class="tab" type="button" data-tab="more"><span class="tp">${ICONS.more}</span>Ещё</button>
</div></nav>
<script type="application/json" id="lz-boot" nonce="${n}">${jsonForScript(boot)}</script>
<script type="application/json" id="lz-icons" nonce="${n}">${jsonForScript(ICONS)}</script>
<script nonce="${n}">${SHELL_JS}</script>
</body></html>`
}
