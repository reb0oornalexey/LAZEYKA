/**
 * «Диагностика»: чистые функции без Electron и без обращений к системе.
 * Здесь: таблица сервисов, разбор ответов, разбор вывода netsh и
 * system_profiler (список соседних Wi-Fi-сетей), подсчёт сетей по каналам,
 * советы по Wi-Fi, определение «белых списков», вердикт проверки утечек,
 * разбор DNS-ответов и маскирование IP. Сеть и системные вызовы — в соседних
 * файлах diag-net.ts, service-status.ts, leak-check.ts, wifi-scan.ts,
 * whitelist-detect.ts, ai-dns-check.ts.
 */
import { WIFI_MEDIUM_DBM, WIFI_WEAK_DBM } from './prematch-stats'

// ======================================================================================
// A. Панель сервисов
// ======================================================================================

export type ServiceId = 'youtube' | 'discord' | 'telegram' | 'twitch' | 'steam' | 'chatgpt' | 'claude' | 'gemini'

export type ServiceState = 'ok' | 'slow' | 'down' | 'region' | 'unchecked'

export interface ServiceSpec {
  id: ServiceId
  name: string
  /** Характерный адрес: на нём видно, открывается ли сервис с этого компьютера. */
  url: string
  /** Домен для «Проверки сайта» при клике на плитку. */
  siteDomain: string
  /** Домены, на которых законно оказаться после редиректов. Любой другой — заглушка провайдера. */
  okHosts: string[]
  /** Нейросети: как отличить «недоступно в вашем регионе» от обычного ответа. */
  region?: {
    /** 403 от самого сервиса (без проверки Cloudflare) считаем отказом по региону. */
    region403: boolean
    /** Признаки отказа по региону в теле ответа. */
    markers: RegExp
  }
  /** Нейросети: сайт, который открывают для проверки через DNS (вкладка DNS). */
  dnsHost?: string
}

/** Фразы, по которым узнаём отказ по региону (английские тексты сервисов). */
const REGION_MARKERS =
  /unsupported[_ ]country|country[_ ,]+region[_ ,]+territory|not available in your (country|region)|unavailable in your (country|region)|isn'?t available in your (country|region)|location is not supported|app unavailable|not supported in your (country|region)/i

/**
 * Что проверяется у каждого сервиса. Нейросети проверяются по адресу API: у них
 * ответ без ключа устроен одинаково и не зависит от проверки браузера
 * Cloudflare, а в закрытых регионах API отвечает отказом.
 */
export const SERVICES: ServiceSpec[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    // Главная страница: именно имя www.youtube.com режет блокировка по DPI.
    url: 'https://www.youtube.com/',
    siteDomain: 'youtube.com',
    // consent.* и accounts.* — законные редиректы Google (согласие на cookie).
    okHosts: ['youtube.com', 'google.com', 'youtu.be']
  },
  {
    id: 'discord',
    name: 'Discord',
    // Публичный адрес шлюза: отвечает JSON-ом без входа в аккаунт.
    url: 'https://discord.com/api/v9/gateway',
    siteDomain: 'discord.com',
    okHosts: ['discord.com', 'discordapp.com', 'discord.gg']
  },
  {
    id: 'telegram',
    name: 'Telegram',
    // Веб-версия: если открывается она, значит, домены Telegram не режутся.
    url: 'https://web.telegram.org/',
    siteDomain: 'web.telegram.org',
    okHosts: ['telegram.org', 't.me', 'telegram.me']
  },
  {
    id: 'twitch',
    name: 'Twitch',
    url: 'https://www.twitch.tv/',
    siteDomain: 'twitch.tv',
    okHosts: ['twitch.tv', 'twitch.com']
  },
  {
    id: 'steam',
    name: 'Steam',
    // Магазин: на него приходит основной трафик клиента Steam.
    url: 'https://store.steampowered.com/',
    siteDomain: 'store.steampowered.com',
    okHosts: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com']
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    // Без ключа: 401 — доступно, 403 unsupported_country_region_territory — закрыто по региону.
    url: 'https://api.openai.com/v1/models',
    siteDomain: 'chatgpt.com',
    okHosts: ['openai.com', 'chatgpt.com'],
    region: { region403: true, markers: REGION_MARKERS },
    dnsHost: 'chatgpt.com'
  },
  {
    id: 'claude',
    name: 'Claude',
    // Без ключа: 401 — доступно, 403 «Request not allowed» — закрыто по региону.
    url: 'https://api.anthropic.com/v1/models',
    siteDomain: 'claude.ai',
    okHosts: ['anthropic.com', 'claude.ai', 'claude.com'],
    region: { region403: true, markers: REGION_MARKERS },
    dnsHost: 'claude.ai'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    // Без ключа: 403 — доступно; 400 «User location is not supported» — закрыто по региону.
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    siteDomain: 'gemini.google.com',
    okHosts: ['googleapis.com', 'google.com', 'gemini.google.com'],
    region: { region403: false, markers: REGION_MARKERS },
    dnsHost: 'gemini.google.com'
  }
]

export const SLOW_RESPONSE_MS = 2500
export const SERVICE_TIMEOUT_MS = 6000

/** Как заглушки провайдера опознаёт «Проверка сайта» (site-check.ts). */
const STUB_MARKERS = [
  'доступ ограничен',
  'доступ к запрашиваемому ресурсу',
  'решению роскомнадзора',
  'решением суда',
  'blocked by roskomnadzor',
  'blocked by rkn',
  'rkn.gov.ru',
  'eais.rkn',
  'единый реестр'
]

export interface ProbeObservation {
  status: number
  /** Хост последнего адреса после редиректов. */
  finalHost: string
  /** Начало тела ответа (до нескольких КБ). */
  body: string
  /** Cloudflare показал проверку браузера (заголовок cf-mitigated: challenge). */
  cfChallenge: boolean
  /** Время до заголовков ответа, мс. */
  ms: number
}

export interface ServiceVerdict {
  state: ServiceState
  detail: string
}

/** Хост входит в домен или его поддомен. */
export function hostInDomains(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return domains.some((d) => h === d || h.endsWith('.' + d))
}

const REGION_TEXT = 'недоступно в вашем регионе (поможет DNS или VPN)'

/**
 * Итог проверки одной плитки по полученному HTTP-ответу. Успех — любой ответ
 * с корректным TLS и кодом < 500, кроме заглушки провайдера (451, редирект на
 * чужой домен, страница блокировки) и отказа по региону.
 */
export function classifyServiceResponse(spec: ServiceSpec, o: ProbeObservation): ServiceVerdict {
  if (o.status === 451) return { state: 'down', detail: 'провайдер блокирует сайт (код 451)' }
  if (o.finalHost && !hostInDomains(o.finalHost, spec.okHosts)) {
    return { state: 'down', detail: `вместо сервиса открывается чужая страница (${o.finalHost}) — похоже на заглушку провайдера` }
  }
  const lower = o.body.toLowerCase()
  if (o.body.length < 12_000 && STUB_MARKERS.some((m) => lower.includes(m))) {
    return { state: 'down', detail: 'вместо сервиса пришла страница блокировки провайдера' }
  }
  if (spec.region) {
    const markerHit = o.status >= 400 && spec.region.markers.test(o.body)
    const bare403 = spec.region.region403 && o.status === 403 && !o.cfChallenge && !/just a moment|challenge-platform/i.test(o.body)
    if (markerHit || bare403) return { state: 'region', detail: REGION_TEXT }
  }
  if (o.status >= 500) return { state: 'down', detail: `сервер ответил ошибкой ${o.status}` }
  if (o.ms > SLOW_RESPONSE_MS) return { state: 'slow', detail: `отвечает медленно (${(o.ms / 1000).toFixed(1).replace('.', ',')} с)` }
  return { state: 'ok', detail: `ответ получен за ${o.ms} мс` }
}

// ======================================================================================
// A2. Плитка сервиса = несколько точек. Одна функция решения для панели и мастера.
// ======================================================================================

/**
 * Итог плитки. partial — главное отвечает, но часть сервиса (видео, картинки,
 * обновления) не грузится.
 */
export type TileState = ServiceState | 'partial'

/**
 * core — без этой точки сервисом пользоваться нельзя: не ответила — «не открывается».
 * part — часть сервиса: не ответила — «частично» с подписью, что именно не работает.
 * info — только для сведения (на итог не влияет).
 */
export type PointRole = 'core' | 'part' | 'info'

export type PointProbe =
  /** HTTPS-запрос сетевым стеком Chromium (системные DNS, hosts и прокси — как у браузера и клиентов на Chromium). */
  | {
      kind: 'http'
      url: string
      okHosts: string[]
      /**
       * Прочитать не меньше стольких байт тела (если ответ длиннее). Ловит
       * «замедление»: соединение открывается, а данные идут очень медленно или
       * замирают после первых килобайт.
       */
      minBytes?: number
      /** Учитывать «недоступно в регионе» (нейросети). */
      region?: boolean
    }
  /** Первый запрос протокола Telegram напрямую на дата-центры: ответил хоть один — доступно. */
  | { kind: 'mtproto' }
  /** Тот же запрос через локальный Telegram-прокси LAZEYKA. */
  | { kind: 'tg-proxy' }

export interface ServicePoint {
  key: string
  /** Для человека: «сервер чата», «видео». */
  label: string
  /** Адрес для подписи и для «Проверки сайта». */
  host: string
  role: PointRole
  probe: PointProbe
  /** Что не работает, если точка не ответила: «видео не грузится». */
  failText: string
}

export type PointState = 'ok' | 'slow' | 'down' | 'region' | 'unverified'

export interface PointResult {
  key: string
  state: PointState
  detail: string
  ms: number | null
}

const REGION_OK_HOSTS = (id: ServiceId): string[] => SERVICES.find((s) => s.id === id)?.okHosts ?? []

const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'discord.gg', 'discordapp.net', 'discord.media']

/**
 * Что проверяется у каждого сервиса. Выбраны адреса, без которых сервисом
 * реально нельзя пользоваться, а не только главная страница: у владельца в
 * файле hosts может стоять адрес для discord.com, и тогда discord.com отвечает,
 * а приложение Discord не работает — ему нужны gateway.discord.gg (чат),
 * cdn.discordapp.com (картинки) и серверы обновлений.
 */
export const SERVICE_POINTS: Record<ServiceId, ServicePoint[]> = {
  youtube: [
    {
      key: 'site',
      label: 'сайт',
      host: 'www.youtube.com',
      role: 'core',
      // Главная страница: именно имя www.youtube.com режет блокировка по DPI.
      probe: { kind: 'http', url: 'https://www.youtube.com/', okHosts: ['youtube.com', 'google.com', 'youtu.be'] },
      failText: 'сайт не открывается'
    },
    {
      key: 'video',
      label: 'видео',
      host: 'redirector.googlevideo.com',
      role: 'part',
      // Видео идёт с *.googlevideo.com. report_mapping — служебная страница этого
      // же домена, длинный текстовый ответ (сотни КБ): читаем 48 КБ, чтобы
      // заметить замедление, а не только открытие соединения.
      probe: { kind: 'http', url: 'https://redirector.googlevideo.com/report_mapping', okHosts: ['googlevideo.com', 'google.com'], minBytes: 48 * 1024 },
      failText: 'видео не грузится'
    },
    {
      key: 'img',
      label: 'превью',
      host: 'i.ytimg.com',
      role: 'part',
      probe: { kind: 'http', url: 'https://i.ytimg.com/generate_204', okHosts: ['ytimg.com', 'google.com'] },
      failText: 'не грузятся превью'
    }
  ],
  discord: [
    {
      key: 'gateway',
      label: 'сервер чата',
      host: 'gateway.discord.gg',
      role: 'core',
      // Приложение держит здесь WebSocket. На обычный запрос отвечает 404 — значит, доступен.
      probe: { kind: 'http', url: 'https://gateway.discord.gg/?v=10&encoding=json', okHosts: DISCORD_HOSTS },
      failText: 'приложение не подключается к серверу чата'
    },
    {
      key: 'api',
      label: 'сервер входа',
      host: 'discord.com',
      role: 'core',
      probe: { kind: 'http', url: 'https://discord.com/api/v9/gateway', okHosts: DISCORD_HOSTS },
      failText: 'не работают вход и отправка сообщений'
    },
    {
      key: 'cdn',
      label: 'картинки и файлы',
      host: 'cdn.discordapp.com',
      role: 'part',
      probe: { kind: 'http', url: 'https://cdn.discordapp.com/embed/avatars/0.png', okHosts: DISCORD_HOSTS },
      failText: 'не грузятся картинки и файлы'
    },
    {
      key: 'updates',
      label: 'проверка обновлений',
      host: 'updates.discord.com',
      role: 'part',
      probe: {
        kind: 'http',
        url: 'https://updates.discord.com/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64',
        okHosts: DISCORD_HOSTS
      },
      failText: 'не проверяются обновления (приложение может зависнуть на «Update failed»)'
    },
    {
      key: 'dl',
      label: 'загрузка обновлений',
      host: 'stable.dl2.discordapp.net',
      role: 'part',
      // Отсюда приложение скачивает обновления (адрес из ответа updates.discord.com); без пути отвечает 404.
      probe: { kind: 'http', url: 'https://stable.dl2.discordapp.net/', okHosts: DISCORD_HOSTS },
      failText: 'не скачиваются обновления (приложение может зависнуть на «Update failed»)'
    }
  ],
  telegram: [
    {
      key: 'dc',
      label: 'серверы Telegram',
      host: '149.154.167.51',
      role: 'core',
      probe: { kind: 'mtproto' },
      failText: 'приложение не подключается к серверам Telegram'
    },
    {
      key: 'web',
      label: 'веб-версия',
      host: 'web.telegram.org',
      role: 'part',
      probe: { kind: 'http', url: 'https://web.telegram.org/', okHosts: ['telegram.org', 't.me', 'telegram.me'] },
      failText: 'не открывается веб-версия'
    }
  ],
  twitch: [
    {
      key: 'site',
      label: 'сайт',
      host: 'www.twitch.tv',
      role: 'core',
      probe: { kind: 'http', url: 'https://www.twitch.tv/', okHosts: ['twitch.tv', 'twitch.com'] },
      failText: 'сайт не открывается'
    },
    {
      key: 'gql',
      label: 'данные сайта и чата',
      host: 'gql.twitch.tv',
      role: 'core',
      // Без ключа отвечает 400 «Client-ID header is missing» — значит, доступен.
      probe: { kind: 'http', url: 'https://gql.twitch.tv/gql', okHosts: ['twitch.tv'] },
      failText: 'не грузятся данные сайта'
    },
    {
      key: 'video',
      label: 'видео',
      host: 'usher.ttvnw.net',
      role: 'part',
      // Выдаёт плейлисты трансляций; без параметров отвечает 403/404 — значит, доступен.
      probe: { kind: 'http', url: 'https://usher.ttvnw.net/', okHosts: ['ttvnw.net', 'twitch.tv'] },
      failText: 'видео не грузится'
    },
    {
      key: 'cdn',
      label: 'превью и смайлики',
      host: 'static-cdn.jtvnw.net',
      role: 'part',
      probe: { kind: 'http', url: 'https://static-cdn.jtvnw.net/', okHosts: ['jtvnw.net', 'twitch.tv'] },
      failText: 'не грузятся превью и смайлики'
    }
  ],
  steam: [
    {
      key: 'store',
      label: 'магазин',
      host: 'store.steampowered.com',
      role: 'core',
      probe: { kind: 'http', url: 'https://store.steampowered.com/', okHosts: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com'] },
      failText: 'не открывается магазин'
    },
    {
      key: 'api',
      label: 'служебный сервер',
      host: 'api.steampowered.com',
      role: 'part',
      probe: { kind: 'http', url: 'https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/', okHosts: ['steampowered.com'] },
      failText: 'клиент Steam не получает данные'
    },
    {
      key: 'community',
      label: 'сообщество',
      host: 'steamcommunity.com',
      role: 'part',
      probe: { kind: 'http', url: 'https://steamcommunity.com/', okHosts: ['steamcommunity.com', 'steampowered.com', 'steamstatic.com'] },
      failText: 'не открываются профили и сообщество'
    }
  ],
  chatgpt: aiPoints('chatgpt', 'api.openai.com'),
  claude: aiPoints('claude', 'api.anthropic.com'),
  gemini: aiPoints('gemini', 'generativelanguage.googleapis.com')
}

function aiPoints(id: 'chatgpt' | 'claude' | 'gemini', apiHost: string): ServicePoint[] {
  const spec = SERVICES.find((s) => s.id === id)!
  return [
    {
      key: 'web',
      label: 'веб-версия',
      host: spec.siteDomain,
      role: 'core',
      probe: { kind: 'http', url: `https://${spec.siteDomain}/`, okHosts: [...spec.okHosts, spec.siteDomain], region: true },
      failText: 'веб-версия не ответила'
    },
    {
      key: 'api',
      label: 'API',
      host: apiHost,
      role: 'part',
      probe: { kind: 'http', url: spec.url, okHosts: REGION_OK_HOSTS(id), region: true },
      failText: 'API не ответил'
    }
  ]
}

/**
 * Точки Telegram с учётом своего прокси: когда прокси LAZEYKA запущен,
 * приложение Telegram ходит через него (если в Telegram добавлен этот прокси),
 * поэтому главное — ответ Telegram через прокси; прямые серверы — для сведения.
 */
export function telegramPoints(proxyRunning: boolean): ServicePoint[] {
  const [dc, web] = SERVICE_POINTS.telegram
  if (!proxyRunning) return [dc, web]
  return [
    {
      key: 'proxy',
      label: 'Telegram через прокси',
      host: '127.0.0.1',
      role: 'core',
      probe: { kind: 'tg-proxy' },
      failText: 'через прокси LAZEYKA Telegram не отвечает'
    },
    { ...dc, role: 'info', label: 'серверы Telegram напрямую' },
    web
  ]
}

export interface TileVerdict {
  state: TileState
  /** Полный текст для подсказки и мастера. */
  detail: string
  /** Короткая подпись под плиткой (что именно не работает или «через прокси»); null — нет. */
  note: string | null
  /** Адрес для «Проверки сайта» при клике: первая неответившая точка. */
  failedHost: string | null
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]
const joinAnd = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`)

/** Короткая подпись части: «видео не грузится (приложение…)» → «видео не грузится». */
const shortFail = (t: string): string => t.replace(/\s*\(.*\)\s*$/, '')

/**
 * Итог плитки по результатам её точек. Правила одни для панели и мастера:
 *  - любая core-точка «недоступно в регионе» → region;
 *  - если ответила только часть основных или вспомогательных точек → partial;
 *  - core в порядке, но какая-то part не ответила → partial («сайт открывается, но видео не грузится»);
 *  - всё ответило, но core медленная → slow; иначе ok.
 * Точки без результата считаются неответившими (общий таймаут).
 */
export function decideTile(points: ServicePoint[], results: PointResult[], opts: { via?: 'proxy' | null } = {}): TileVerdict {
  const byKey = new Map(results.map((r) => [r.key, r]))
  const get = (p: ServicePoint): PointResult => byKey.get(p.key) ?? { key: p.key, state: 'down', detail: 'нет ответа', ms: null }
  const core = points.filter((p) => p.role === 'core')
  const parts = points.filter((p) => p.role === 'part')
  const via = opts.via === 'proxy' ? 'через прокси LAZEYKA' : null

  const regionCore = core.find((p) => get(p).state === 'region')
  if (regionCore) return { state: 'region', detail: REGION_TEXT, note: null, failedHost: null }

  const coreOk = core.filter((p) => get(p).state === 'ok' || get(p).state === 'slow')
  const coreDown = core.filter((p) => get(p).state === 'down')
  const partOk = parts.filter((p) => get(p).state === 'ok' || get(p).state === 'slow')
  const available = coreOk.length ? coreOk : partOk
  const partDown = parts.filter((p) => get(p).state === 'down' || get(p).state === 'region')
  const unverified = [...core, ...parts].filter((p) => get(p).state === 'unverified')

  if (coreDown.length > 0 && (available.length > 0 || !core.some((p) => get(p).state === 'unverified'))) {
    const first = coreDown[0]
    const reasons = coreDown.map((p) => `${p.host}: ${get(p).detail}`).join('; ')
    const lead = available.length > 0 ? `${joinAnd(available.map((p) => p.label))} ${available.length > 1 ? 'отвечают' : 'отвечает'}, но ` : ''
    const fails = uniq(coreDown.map((p) => p.failText))
    return {
      state: available.length > 0 ? 'partial' : 'down',
      detail: `${lead}${joinAnd(fails)} (${reasons})`,
      note: available.length > 0 ? shortFail(fails[0]) : via,
      failedHost: first.host
    }
  }

  if (unverified.length) {
    return {
      state: 'partial',
      detail: [...unverified, ...coreDown, ...partDown].map((p) => `${capitalize(p.label)}: ${get(p).detail}`).join('; '),
      note: 'нужна проверка в браузере',
      failedHost: unverified[0].host
    }
  }

  if (partDown.length > 0) {
    const fails = uniq(partDown.map((p) => get(p).state === 'region' ? `${p.label} недоступен в регионе` : p.failText))
    const reasons = partDown.map((p) => `${p.host}: ${get(p).detail}`).join('; ')
    const okLead = via
      ? `Telegram работает ${via}`
      : core.length === 1 && core[0].label === 'сайт'
        ? 'сайт открывается'
        : `${joinAnd(core.map((p) => p.label))} ${core.length > 1 ? 'работают' : 'работает'}`
    return {
      state: 'partial',
      detail: `${okLead}, но ${joinAnd(fails)} (${reasons})`,
      note: shortFail(fails[0]),
      failedHost: partDown[0].host
    }
  }

  const slowCore = core.filter((p) => get(p).state === 'slow')
  const infoDown = points.filter((p) => p.role === 'info' && get(p).state === 'down')
  const infoText = infoDown.length ? ` ${infoDown.map((p) => `${capitalize(p.label)} не отвечают (${get(p).detail}).`).join(' ')}` : ''
  if (slowCore.length > 0) {
    return {
      state: 'slow',
      detail: `${via ? `${capitalize(via)}: ` : ''}${slowCore.map((p) => `${p.label} — ${get(p).detail}`).join('; ')}.${infoText}`,
      note: via,
      failedHost: slowCore[0].host
    }
  }
  const msList = core.map((p) => get(p).ms).filter((x): x is number => typeof x === 'number')
  const worst = msList.length ? Math.max(...msList) : null
  const checked = points.filter((p) => p.role !== 'info').map((p) => p.label)
  return {
    state: 'ok',
    detail: `${via ? `${capitalize(via)}. ` : ''}Отвечают: ${joinAnd(checked)}${worst != null ? ` (дольше всего — ${worst} мс)` : ''}.${infoText}`,
    note: via,
    failedHost: null
  }
}

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Результат HTTP-точки по ответу: те же правила, что и раньше для одной плитки, плюс «замедление». */
export function classifyPointResponse(
  p: ServicePoint,
  o: ProbeObservation & { bytes?: number; bodyDone?: boolean }
): PointResult {
  if (p.probe.kind !== 'http') return { key: p.key, state: 'down', detail: 'неверный тип проверки', ms: o.ms }
  const spec: ServiceSpec = {
    id: 'youtube',
    name: p.label,
    url: p.probe.url,
    siteDomain: p.host,
    okHosts: p.probe.okHosts,
    region: p.probe.region ? { region403: false, markers: REGION_MARKERS } : undefined
  }
  const v = classifyServiceResponse(spec, o)
  if (v.state !== 'down' && v.state !== 'region' && (o.cfChallenge || (p.key === 'web' && p.probe.region && (o.status === 401 || o.status === 403)))) {
    return { key: p.key, state: 'unverified', detail: 'сервер ответил, но доступ нужно подтвердить в браузере', ms: o.ms }
  }
  if (v.state !== 'down' && p.probe.minBytes && o.bytes !== undefined && o.bytes < p.probe.minBytes && o.bodyDone === false) {
    return { key: p.key, state: 'down', detail: `данные идут очень медленно или обрываются (получено ${Math.round(o.bytes / 1024)} КБ)`, ms: o.ms }
  }
  return { key: p.key, state: v.state === 'unchecked' ? 'down' : v.state, detail: v.detail, ms: o.ms }
}

/** Понятный текст для ошибки соединения (Chromium net::ERR_* и коды Node). */
export function describeNetError(err: unknown, timeoutSec = 6): string {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | null)?.code ?? ''
  const s = `${msg} ${code}`
  if (/ERR_CERT|CERT_|certificate|UNABLE_TO_VERIFY|SELF.SIGNED|ERR_SSL_(VERSION|CLIENT_AUTH)/i.test(s)) {
    return 'сертификат сайта не прошёл проверку (возможна подмена)'
  }
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|ENODATA|EAI_AGAIN|ERR_NAME_RESOLUTION/i.test(s)) return 'DNS не отдаёт адрес сайта'
  if (/ERR_SSL|ssl|tls|handshake/i.test(s) && !/timed?[ _]?out|abort/i.test(s)) {
    return 'сбой защищённого соединения (часто так выглядит блокировка по DPI)'
  }
  if (/ERR_CONNECTION_RESET|ECONNRESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_ABORTED|ECONNABORTED|EPIPE|socket hang up|closed/i.test(s)) {
    return 'соединение сбрасывается (похоже на блокировку)'
  }
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(s)) return 'сервер отказал в соединении'
  if (/ERR_PROXY|proxy/i.test(s)) return 'прокси не отвечает'
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EADDRNOTAVAIL/i.test(s)) return 'нет подключения к сети'
  if (/timed?[ _]?out|timeout|ETIMEDOUT|abort/i.test(s)) return `нет ответа за ${timeoutSec} с`
  return 'не удалось соединиться'
}

// ======================================================================================
// Пул задач с ограничением параллелизма
// ======================================================================================

/** Выполняет задачи не более `limit` одновременно, результаты — в порядке задач. */
export async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= tasks.length) return
      out[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker))
  return out
}

// ======================================================================================
// IP: маскирование и разбор ответов сервисов определения адреса
// ======================================================================================

/** «203.0.113.45» → «203.0.*.*», IPv6 — первые две группы и «:****». */
export function maskIp(ip: string): string {
  const v = ip.trim()
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)) {
    const p = v.split('.')
    return `${p[0]}.${p[1]}.*.*`
  }
  if (v.includes(':')) {
    const groups = v.split(':').filter((g) => g !== '')
    return groups.length >= 2 ? `${groups[0]}:${groups[1]}:****` : '****'
  }
  return '••••'
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/
const IPV6_RE = /^[0-9a-f:]+$/i

export function isIpText(v: string): boolean {
  const t = v.trim()
  if (IPV4_RE.test(t)) return t.split('.').every((n) => Number(n) <= 255)
  return t.includes(':') && IPV6_RE.test(t) && t.length <= 45
}

/** Ответ вида «203.0.113.5\n» (icanhazip, ifconfig.me) или JSON {"ip":"…"} (ipify). */
export function parseIpResponse(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (t.startsWith('{')) {
    try {
      const ip = (JSON.parse(t) as { ip?: unknown }).ip
      return typeof ip === 'string' && isIpText(ip) ? ip.trim() : null
    } catch {
      return null
    }
  }
  const line = t.split(/\r?\n/)[0]
  return isIpText(line) ? line.trim() : null
}

/** https://1.1.1.1/cdn-cgi/trace: строки «ip=…», «loc=RU». */
export function parseTrace(text: string): { ip: string | null; loc: string | null } {
  const ip = /^ip=(.+)$/m.exec(text)?.[1]?.trim() ?? null
  const loc = /^loc=([A-Za-z]{2})\s*$/m.exec(text)?.[1]?.toUpperCase() ?? null
  return { ip: ip && isIpText(ip) ? ip : null, loc }
}

/** Адрес из частного диапазона (роутер) или туннеля LAZEYKA. */
export function isPrivateOrTunnelIp(a: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(a) || /^(fe80|fc|fd)/i.test(a)
}

// ======================================================================================
// Проверка утечек: вердикт
// ======================================================================================

export type LeakKind = 'ok' | 'warn' | 'bad' | 'info'

export interface LeakInput {
  vpn: {
    running: boolean
    mode: 'tun' | 'system_proxy' | 'only_proxy' | null
    routing: 'bypass-ru' | 'global' | 'direct' | null
    exitLag: boolean
    /** Перехват DNS включён в настройках INCY (null — неизвестно). */
    hijackDns: boolean | null
  }
  /** Адрес, который видят сайты при обычном запросе с компьютера. */
  seenV4: string | null
  /** Адрес с физического адаптера мимо VPN; undefined — измерить нельзя. */
  directV4: string | null | undefined
  /** IPv6, который видят сайты (api6.ipify.org). */
  v6Seen: string | null
  /** IPv6 с физического адаптера; undefined — измерить нельзя. */
  v6Direct: string | null | undefined
  /** DNS-серверы сетевого адаптера (без адресов самого туннеля). */
  dnsServers: string[]
}

export interface LeakVerdict {
  kind: LeakKind
  headline: string
  items: { kind: LeakKind; text: string }[]
  todo: string[]
}

export function buildLeakVerdict(i: LeakInput): LeakVerdict {
  const items: LeakVerdict['items'] = []
  const todo: string[] = []

  if (!i.seenV4) {
    return {
      kind: 'warn',
      headline: 'Не удалось узнать, какой адрес видят сайты',
      items: [{ kind: 'warn', text: 'Ни один из сервисов определения адреса не ответил. Проверьте подключение к интернету и повторите.' }],
      todo: []
    }
  }

  if (!i.vpn.running) {
    const v6 = i.v6Seen ? ' Есть и внешний IPv6-адрес.' : ''
    return {
      kind: 'info',
      headline: 'VPN выключен — сайты видят ваш настоящий адрес',
      items: [{ kind: 'info', text: `Проверка утечек имеет смысл при включённом VPN. Сейчас всё идёт напрямую.${v6}` }],
      todo: []
    }
  }

  const sameV4 = i.directV4 != null && i.directV4 === i.seenV4
  const v6Same = i.v6Seen != null && i.v6Direct != null && i.v6Seen === i.v6Direct
  const leak4 = sameV4 && i.vpn.mode === 'tun' && !i.vpn.exitLag && i.vpn.routing !== 'direct'
  const leak6 = v6Same && !i.vpn.exitLag && i.vpn.routing !== 'direct'

  // Что задумано самим режимом — это не утечка.
  if (i.vpn.exitLag) {
    items.push({ kind: 'info', text: 'Режим ExitLag: через VPN идут только выбранные игры, остальное — напрямую. Сайты видят ваш настоящий адрес, так и задумано.' })
  } else if (i.vpn.routing === 'direct') {
    items.push({ kind: 'info', text: 'Выбрана маршрутизация «напрямую»: весь трафик идёт мимо VPN, так задано в настройках.' })
  } else if (i.vpn.mode === 'only_proxy' && sameV4) {
    items.push({ kind: 'info', text: 'Режим «Только прокси»: через VPN идут только программы, настроенные на прокси. Браузер и остальное — напрямую.' })
  } else if (i.vpn.mode === 'system_proxy' && sameV4) {
    items.push({ kind: 'warn', text: 'Режим «Системный прокси»: программы, которые не читают системный прокси (часть игр и клиентов), идут напрямую. Этот запрос тоже ушёл напрямую.' })
  }

  if (leak4) {
    items.push({ kind: 'bad', text: 'Сайты видят тот же адрес, что и без VPN: трафик идёт мимо туннеля.' })
    todo.push('Отключите и снова включите VPN, затем повторите проверку.')
    todo.push('Если включён Kill Switch, проверьте, что он не снят: при обрыве VPN трафик не должен уходить напрямую.')
    todo.push('Проверьте, что другой VPN или программа не меняет маршруты компьютера.')
  } else if (!i.vpn.exitLag && i.vpn.routing !== 'direct' && i.directV4 != null && !sameV4) {
    items.push({ kind: 'ok', text: 'IPv4: сайты видят адрес сервера VPN, настоящий адрес скрыт.' })
  } else if (i.directV4 === undefined && !i.vpn.exitLag) {
    items.push({ kind: 'info', text: 'Адрес мимо VPN на этом компьютере измерить нельзя, сравнение не выполнено.' })
  }

  if (leak6) {
    items.push({ kind: 'bad', text: 'Сайты видят ваш настоящий адрес по IPv6: протокол IPv6 идёт мимо VPN.' })
    todo.push('Отключите IPv6 для сетевого адаптера: свойства адаптера, снимите отметку «IP версии 6 (TCP/IPv6)», затем повторите проверку.')
  } else if (i.v6Seen && i.v6Direct === undefined && !i.vpn.exitLag) {
    items.push({ kind: 'info', text: 'У компьютера есть внешний IPv6-адрес. Идёт ли он мимо VPN, на этом компьютере проверить нельзя.' })
  } else if (i.v6Seen && !v6Same) {
    items.push({ kind: 'ok', text: 'IPv6: адрес отличается от настоящего, утечки нет.' })
  } else if (!i.v6Seen) {
    items.push({ kind: 'ok', text: 'IPv6: внешнего адреса у сайтов нет, утечки по нему нет.' })
  }

  // DNS: запросы к роутеру/провайдеру в режиме TUN без перехвата идут мимо VPN.
  if (i.vpn.mode === 'tun' && !i.vpn.exitLag) {
    const lan = i.dnsServers.filter(isPrivateOrTunnelIp)
    if (i.vpn.hijackDns === true) {
      items.push({ kind: 'ok', text: 'DNS-запросы перехватываются и идут через VPN.' })
    } else if (i.vpn.hijackDns === false && lan.length > 0) {
      items.push({ kind: 'warn', text: `DNS-запросы идут на ${lan.slice(0, 2).join(', ')} (роутер или провайдер), а не через VPN: провайдер видит, какие сайты вы открываете.` })
      todo.push('Включите перехват DNS в настройках INCY или выберите свой DNS на вкладке «DNS».')
    }
  }

  const hasBad = items.some((x) => x.kind === 'bad')
  const hasWarn = items.some((x) => x.kind === 'warn')
  let headline: string
  let kind: LeakKind
  if (leak6 && !leak4) {
    headline = 'Сайты видят ваш настоящий IP по IPv6'
    kind = 'bad'
  } else if (leak4) {
    headline = 'Сайты видят ваш настоящий IP'
    kind = 'bad'
  } else if (hasWarn) {
    headline = i.vpn.exitLag || i.vpn.routing === 'direct' ? 'VPN включён, но часть трафика идёт напрямую' : 'VPN включён, есть замечания'
    kind = 'warn'
  } else if (i.vpn.exitLag || i.vpn.routing === 'direct' || sameV4) {
    headline = 'VPN включён, сайты видят ваш настоящий адрес — так задано режимом'
    kind = 'info'
  } else {
    headline = 'VPN включён, сайты видят IP сервера — утечек не найдено'
    kind = hasBad ? 'bad' : 'ok'
  }
  return { kind, headline, items, todo }
}

// ======================================================================================
// Белые списки
// ======================================================================================

export type WhitelistKind = 'whitelist' | 'normal' | 'no-internet' | 'unclear'

export interface WhitelistVerdict {
  kind: WhitelistKind
  headline: string
  advice: string
}

/**
 * ru — ответы заведомо разрешённых российских адресов, foreign — нейтральных
 * зарубежных. Только российские отвечают, зарубежные все молчат — белые списки.
 */
export function classifyWhitelist(ru: boolean[], foreign: boolean[]): WhitelistVerdict {
  const ruOk = ru.filter(Boolean).length
  const forOk = foreign.filter(Boolean).length
  if (ruOk === 0 && forOk === 0) {
    return { kind: 'no-internet', headline: 'Нет интернета', advice: 'Не отвечает ни один адрес. Проверьте кабель, Wi-Fi или мобильную сеть и повторите.' }
  }
  if (forOk === 0) {
    if (ru.length > 0 && ruOk * 2 >= ru.length) {
      return {
        kind: 'whitelist',
        headline: 'Похоже, в этой сети работают только разрешённые сайты',
        advice:
          'Zapret здесь не поможет. Нужен VPN-сервер, который маскируется под разрешённый сайт — спросите у своего провайдера VPN конфигурацию для белых списков.'
      }
    }
    return {
      kind: 'unclear',
      headline: 'Сеть работает нестабильно',
      advice: 'Отвечает лишь часть российских адресов, зарубежные не отвечают. Повторите проверку через минуту или смените сеть.'
    }
  }
  return {
    kind: 'normal',
    headline: 'Обычные блокировки, белых списков нет',
    advice: 'Зарубежные сайты открываются, значит, сеть не ограничена списком разрешённых. Закрытые сайты можно открыть через Zapret или VPN.'
  }
}

// ======================================================================================
// Wi-Fi: соседние сети
// ======================================================================================

export type WifiBand = '2.4' | '5' | '6'

export interface ScanNetwork {
  ssid: string
  bssid: string | null
  signalPct: number | null
  rssiDbm: number | null
  channel: number | null
  band: WifiBand | null
  phy: string | null
  connected?: boolean
}

interface KV {
  key: string
  value: string
}

function bandFromChannel(ch: number | null): WifiBand | null {
  if (ch == null) return null
  return ch <= 14 ? '2.4' : '5'
}

function bandFromText(v: string): WifiBand | null {
  const m = /^(2[.,]4|2|5|6)\s*\D{2,4}$/.exec(v.trim())
  if (!m) return null
  return m[1].startsWith('2') ? '2.4' : (m[1] as '5' | '6')
}

export interface NetshNetworksParse {
  networks: ScanNetwork[]
  /** Windows просит доступ к геолокации для списка сетей. */
  needsLocation: boolean
  /** Служба автонастройки WLAN не запущена. */
  serviceDown: boolean
}

/**
 * `netsh wlan show networks mode=bssid`. Названия полей локализованы, поэтому
 * разбор по структуре: «SSID N : имя» и «BSSID N : mac» не переводятся; сигнал
 * — значение «NN%», тип радио — «802.11…», канал — первое целое число после
 * типа радио, диапазон — значение «5 GHz» / «5 ГГц».
 */
export function parseNetshNetworks(text: string): NetshNetworksParse {
  const needsLocation = /ms-settings:privacy-location/i.test(text)
  const serviceDown = /wlansvc/i.test(text)
  const networks: ScanNetwork[] = []
  let ssid = ''
  let bssid: ScanNetwork | null = null
  let entries: KV[] = []
  const flush = (): void => {
    if (!bssid) return
    const b = entries
    const sigIdx = b.findIndex((e) => /^\d{1,3}\s*%$/.test(e.value))
    if (sigIdx >= 0) {
      const pct = Math.max(0, Math.min(100, parseInt(b[sigIdx].value, 10)))
      bssid.signalPct = pct
      bssid.rssiDbm = Math.round(pct / 2 - 100)
    }
    const phyIdx = b.findIndex((e) => /^802\.11[a-z0-9/]*$/i.test(e.value))
    if (phyIdx >= 0) bssid.phy = b[phyIdx].value
    let band: WifiBand | null = null
    for (const e of b) {
      const bt = bandFromText(e.value)
      if (bt && band == null) band = bt
    }
    const from = phyIdx >= 0 ? phyIdx + 1 : sigIdx >= 0 ? sigIdx + 1 : 0
    for (let k = from; k < b.length; k++) {
      if (/^\d{1,3}$/.test(b[k].value)) {
        bssid.channel = Number(b[k].value)
        break
      }
    }
    bssid.band = band ?? bandFromChannel(bssid.channel)
    if (bssid.channel != null) networks.push(bssid)
    bssid = null
    entries = []
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]
    const value = m[2]
    if (/^SSID\s+\d+$/i.test(key)) {
      flush()
      ssid = value
      continue
    }
    if (/^BSSID\s+\d+$/i.test(key)) {
      flush()
      bssid = { ssid, bssid: value.toLowerCase(), signalPct: null, rssiDbm: null, channel: null, band: null, phy: null }
      continue
    }
    if (bssid) entries.push({ key, value })
  }
  flush()
  return { networks, needsLocation, serviceDown }
}

export interface CurrentLinkExtras {
  ssid: string | null
  bssid: string | null
  rxMbps: number | null
  txMbps: number | null
}

/**
 * Из `netsh wlan show interfaces`: SSID, BSSID и скорость соединения подключённого
 * адаптера. Скорости — два десятичных числа после канала (приём, передача).
 */
export function parseNetshInterfaceExtras(text: string): CurrentLinkExtras {
  const blocks: KV[][] = []
  let cur: KV[] | null = null
  let firstKey: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:]+?)\s*:\s+(.*?)\s*$/.exec(line)
    if (!m) continue
    if (firstKey == null) firstKey = m[1]
    if (m[1] === firstKey || !cur) {
      cur = []
      blocks.push(cur)
    }
    cur.push({ key: m[1], value: m[2] })
  }
  const num = (v: string): number => Number(v.replace(',', '.'))
  for (const b of blocks) {
    const sigIdx = b.findIndex((e) => /^\d{1,3}\s*%$/.test(e.value))
    if (sigIdx < 0) continue
    const ssid = b.find((e) => /^SSID$/i.test(e.key))?.value ?? null
    const bssid = b.find((e) => /^BSSID$/i.test(e.key))?.value?.toLowerCase() ?? null
    const phyIdx = b.findIndex((e) => /^802\.11[a-z0-9/]*$/i.test(e.value))
    let chIdx = -1
    if (phyIdx >= 0) {
      for (let k = phyIdx + 1; k < b.length; k++) {
        if (/^\d{1,3}$/.test(b[k].value)) {
          chIdx = k
          break
        }
      }
    }
    const rates: number[] = []
    if (chIdx >= 0) {
      for (let k = chIdx + 1; k < b.length && rates.length < 2; k++) {
        if (/^\d+(?:[.,]\d+)?$/.test(b[k].value)) rates.push(num(b[k].value))
      }
    }
    return { ssid: ssid || null, bssid, rxMbps: rates[0] ?? null, txMbps: rates[1] ?? null }
  }
  return { ssid: null, bssid: null, rxMbps: null, txMbps: null }
}

/** macOS: «149 (5GHz, 80MHz)» → канал и диапазон («2GHz» у Apple — это 2,4 ГГц). */
export function parseMacChannel(v: unknown): { channel: number | null; band: WifiBand | null } {
  const s = typeof v === 'string' ? v : ''
  const ch = /^\s*(\d+)/.exec(s)
  const channel = ch ? Number(ch[1]) : null
  const b = /(2\.4|2|5|6)\s*GHz/i.exec(s)
  const band: WifiBand | null = b ? (b[1].startsWith('2') ? '2.4' : (b[1] as '5' | '6')) : bandFromChannel(channel)
  return { channel, band }
}

export interface MacScanParse {
  networks: ScanNetwork[]
  /** Скорость текущего соединения, Мбит/с. */
  rateMbps: number | null
  ssid: string | null
}

/** `system_profiler SPAirPortDataType -json` (macOS 14+): остальные сети из spairport_airport_other_local_wireless_networks. */
export function parseMacScan(json: unknown): MacScanParse {
  const networks: ScanNetwork[] = []
  let rateMbps: number | null = null
  let ssid: string | null = null
  const root = (json as { SPAirPortDataType?: unknown[] } | null)?.SPAirPortDataType
  if (!Array.isArray(root)) return { networks, rateMbps, ssid }
  for (const entry of root) {
    const list = (entry as { spairport_airport_interfaces?: unknown[] })?.spairport_airport_interfaces
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const it = raw as Record<string, unknown>
      const cur = it.spairport_current_network_information as Record<string, unknown> | undefined
      if (cur) {
        if (rateMbps == null && typeof cur.spairport_network_rate === 'number') rateMbps = cur.spairport_network_rate
        if (ssid == null && typeof cur._name === 'string') ssid = cur._name
      }
      for (const key of ['spairport_airport_other_local_wireless_networks', 'spairport_airport_local_wireless_networks']) {
        const arr = it[key]
        if (!Array.isArray(arr)) continue
        for (const n of arr) {
          const o = n as Record<string, unknown>
          const { channel, band } = parseMacChannel(o.spairport_network_channel)
          if (channel == null) continue
          const sn = typeof o.spairport_signal_noise === 'string' ? o.spairport_signal_noise : ''
          const dbm = /(-\d+)\s*dBm/i.exec(sn)
          const rssi = dbm ? Number(dbm[1]) : null
          networks.push({
            ssid: typeof o._name === 'string' ? o._name : '',
            bssid: null,
            signalPct: rssi == null ? null : Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))),
            rssiDbm: rssi,
            channel,
            band,
            phy: typeof o.spairport_network_phymode === 'string' ? o.spairport_network_phymode : null
          })
        }
      }
    }
  }
  return { networks, rateMbps, ssid }
}

/**
 * Отмечает свою сеть в списке: по BSSID (Windows) или по имени и каналу. Если
 * своей сети в списке нет (macOS не включает её в «остальные»), добавляет её.
 */
export function markOwnNetwork(
  networks: ScanNetwork[],
  own: { ssid: string | null; bssid: string | null; channel: number | null; band: WifiBand | null }
): ScanNetwork[] {
  const list = networks.map((n) => ({ ...n, connected: false }))
  if (own.channel == null) return list
  let idx = own.bssid ? list.findIndex((n) => n.bssid === own.bssid) : -1
  if (idx < 0 && own.ssid) idx = list.findIndex((n) => n.ssid === own.ssid && n.channel === own.channel)
  if (idx >= 0) list[idx].connected = true
  else {
    list.push({
      ssid: own.ssid ?? '',
      bssid: own.bssid,
      signalPct: null,
      rssiDbm: null,
      channel: own.channel,
      band: own.band ?? bandFromChannel(own.channel),
      phy: null,
      connected: true
    })
  }
  return list
}

export interface ChannelStat {
  band: WifiBand
  channel: number
  /** Сколько сетей на этом канале (включая вашу). */
  count: number
  /** 2,4 ГГц: сетей на этом и соседних каналах (±4), они мешают друг другу. 5/6 ГГц: то же, что count. */
  overlap: number
  /** На этом канале ваша сеть. */
  own: boolean
}

/**
 * Подсчёт сетей по каналам. Для 2,4 ГГц в таблице присутствуют все каналы 1–13
 * (пустые тоже), для 5/6 ГГц — только те, где кто-то есть.
 */
export function countChannels(networks: ScanNetwork[]): ChannelStat[] {
  const byKey = new Map<string, ChannelStat>()
  const add = (band: WifiBand, channel: number, own: boolean, inc: number): void => {
    const k = `${band}:${channel}`
    const s = byKey.get(k) ?? { band, channel, count: 0, overlap: 0, own: false }
    s.count += inc
    if (own) s.own = true
    byKey.set(k, s)
  }
  for (let c = 1; c <= 13; c++) add('2.4', c, false, 0)
  for (const n of networks) {
    if (n.channel == null) continue
    const band = n.band ?? bandFromChannel(n.channel)
    if (band) add(band, n.channel, !!n.connected, 1)
  }
  const all = [...byKey.values()]
  for (const s of all) {
    s.overlap =
      s.band === '2.4'
        ? all.filter((o) => o.band === '2.4' && Math.abs(o.channel - s.channel) <= 4).reduce((a, o) => a + o.count, 0)
        : s.count
  }
  const order: Record<WifiBand, number> = { '2.4': 0, '5': 1, '6': 2 }
  return all.sort((a, b) => order[a.band] - order[b.band] || a.channel - b.channel)
}

/** Русское склонение: 1 сеть, 2 сети, 5 сетей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

const NON_OVERLAP_24 = [1, 6, 11]
const COMMON_5GHZ = [36, 40, 44, 48, 149, 153, 157, 161]

export interface WifiAdviceInput {
  link: 'wifi' | 'wired' | 'wifi-unknown' | 'unknown'
  current: { rssiDbm: number | null; band: WifiBand | null; channel: number | null } | null
  channels: ChannelStat[]
  rxMbps: number | null
}

export interface WifiAdvice {
  lines: { kind: LeakKind; text: string }[]
  /** true — Wi-Fi вероятная причина лагов, false — нет, null — неизвестно. */
  wifiLikelyCause: boolean | null
}

const joinRu = (xs: number[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`)

export function adviseWifi(inp: WifiAdviceInput): WifiAdvice {
  const lines: WifiAdvice['lines'] = []
  if (inp.link === 'wired') {
    return { lines: [{ kind: 'ok', text: 'Подключение по кабелю, Wi-Fi не используется.' }], wifiLikelyCause: false }
  }
  if (inp.link !== 'wifi' || !inp.current) {
    const text =
      inp.link === 'wifi-unknown'
        ? 'Компьютер подключён по Wi-Fi, но система не отдала данные о сигнале и канале.'
        : 'Не удалось определить, как компьютер выходит в сеть.'
    return { lines: [{ kind: 'info', text }], wifiLikelyCause: null }
  }
  const c = inp.current
  let bad = false

  // Сигнал.
  if (c.rssiDbm != null) {
    if (c.rssiDbm <= WIFI_WEAK_DBM) {
      bad = true
      lines.push({
        kind: 'bad',
        text:
          c.band === '2.4'
            ? 'Вы на 2,4 ГГц при слабом сигнале — перейдите на 5 ГГц или ближе к роутеру.'
            : 'Сигнал слабый — подойдите ближе к роутеру или уберите преграды (стены, зеркала, металл).'
      })
    } else if (c.rssiDbm <= WIFI_MEDIUM_DBM) {
      lines.push({ kind: 'warn', text: 'Сигнал средний: на расстоянии от роутера скорость и отклик могут падать.' })
    } else {
      lines.push({ kind: 'ok', text: 'Сигнал хороший.' })
    }
  }

  // Загруженность канала.
  const mine = inp.channels.find((s) => s.band === c.band && s.channel === c.channel)
  if (mine && c.channel != null) {
    const others = mine.overlap - 1
    if (c.band === '2.4') {
      const alt = NON_OVERLAP_24.filter((ch) => ch !== c.channel)
        .map((ch) => inp.channels.find((s) => s.band === '2.4' && s.channel === ch))
        .filter((s): s is ChannelStat => !!s && s.overlap < mine.overlap)
        .sort((a, b) => a.overlap - b.overlap || a.channel - b.channel)
      const busy = `Канал ${c.channel} занят ${mine.count} ${plural(mine.count, 'сетью', 'сетями', 'сетями')}`
      if (others >= 4) {
        if (others >= 6) bad = true
        lines.push({
          kind: others >= 8 ? 'bad' : 'warn',
          text: alt.length ? `${busy}, свободнее ${joinRu(alt.map((s) => s.channel))}. Смените канал в настройках роутера.` : `${busy}, и свободных каналов рядом нет.`
        })
      } else {
        lines.push({ kind: 'ok', text: `Канал ${c.channel} не перегружен: рядом ${others} ${plural(others, 'чужая сеть', 'чужие сети', 'чужих сетей')}.` })
      }
    } else {
      const others5 = mine.count - 1
      if (others5 >= 3) {
        bad = true
        const alt = COMMON_5GHZ.map((ch) => inp.channels.find((s) => s.band === c.band && s.channel === ch) ?? ({ channel: ch, count: 0 } as { channel: number; count: number }))
          .filter((s) => s.channel !== c.channel && s.count < mine.count)
          .sort((a, b) => a.count - b.count || a.channel - b.channel)
          .slice(0, 3)
          .map((s) => s.channel)
        lines.push({ kind: 'warn', text: `Канал ${c.channel} занят ${mine.count} ${plural(mine.count, 'сетью', 'сетями', 'сетями')}${alt.length ? `, свободнее ${joinRu(alt)}` : ''}.` })
      } else {
        lines.push({ kind: 'ok', text: `Канал ${c.channel} почти свободен: рядом ${others5} ${plural(others5, 'чужая сеть', 'чужие сети', 'чужих сетей')}.` })
      }
    }
  }

  // Скорость соединения с роутером.
  if (inp.rxMbps != null && inp.rxMbps > 0 && inp.rxMbps < 54) {
    bad = true
    lines.push({ kind: 'warn', text: `Низкая скорость соединения с роутером: ${Math.round(inp.rxMbps)} Мбит/с.` })
  }

  if (bad) {
    lines.push({
      kind: 'warn',
      text: 'Если в играх лагает, скорее всего виноват Wi-Fi, а не провайдер. Проверьте по кабелю или исправьте пункты выше.'
    })
  } else {
    lines.push({ kind: 'ok', text: 'С Wi-Fi всё в порядке: если лагает, причина скорее у провайдера или в самой игре.' })
  }
  return { lines, wifiLikelyCause: bad }
}

// ======================================================================================
// DNS по HTTPS (RFC 8484): запрос A и разбор ответа
// ======================================================================================

/** Запрос A-записи в формате DNS (не base64). */
export function buildDnsQuery(name: string, id = 0x1a2b): Buffer {
  const header = Buffer.from([id >> 8, id & 0xff, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])
  const labels = Buffer.concat(name.split('.').filter(Boolean).map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p, 'ascii')])))
  return Buffer.concat([header, labels, Buffer.from([0, 0, 1, 0, 1])])
}

export const toBase64Url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Пропускает имя (с учётом сжатия указателем) и возвращает смещение после него. */
function skipName(buf: Buffer, off: number): number {
  for (let guard = 0; guard < 128 && off < buf.length; guard++) {
    const len = buf[off]
    if (len === 0) return off + 1
    if ((len & 0xc0) === 0xc0) return off + 2
    off += 1 + len
  }
  return buf.length
}

export interface DnsAnswer {
  rcode: number
  ips: string[]
}

/** Разбор DNS-ответа: код возврата и все A-записи секции ответа. */
export function parseDnsAnswer(buf: Buffer): DnsAnswer {
  if (buf.length < 12) return { rcode: -1, ips: [] }
  const rcode = buf[3] & 0x0f
  const qd = buf.readUInt16BE(4)
  const an = buf.readUInt16BE(6)
  let off = 12
  for (let i = 0; i < qd; i++) off = skipName(buf, off) + 4
  const ips: string[] = []
  for (let i = 0; i < an && off + 10 <= buf.length; i++) {
    off = skipName(buf, off)
    if (off + 10 > buf.length) break
    const type = buf.readUInt16BE(off)
    const rdlen = buf.readUInt16BE(off + 8)
    off += 10
    if (type === 1 && rdlen === 4 && off + 4 <= buf.length) ips.push(`${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`)
    off += rdlen
  }
  return { rcode, ips }
}

/** DNS отдаёт заглушку вместо адреса. */
export const isSinkholeIp = (ip: string): boolean => ip === '0.0.0.0' || ip.startsWith('127.')
