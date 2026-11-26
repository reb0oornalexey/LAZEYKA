/**
 * Модель стратегии Zapret (Windows, winws.exe) и генерация .bat в формате Flowseal.
 *
 * Чистая логика без Electron и без файловой системы — проверяется node-скриптом.
 *
 * Как устроены стратегии Flowseal (zapret-discord-youtube): у всех один скелет,
 * блоки winws идут через `--new` в одном и том же порядке:
 *   1. UDP 443 по общему списку (QUIC, YouTube): fake + fake-quic;
 *   2. голос Discord UDP 19294-19344,50000-50100: fake-discord / fake-stun;
 *   3. порты Cloudflare TCP 2053,2083,2087,2096,8443 для discord.media;
 *   4. TCP 443 по списку google с `--ip-id=zero`;
 *   5. TCP 80,443 по общему списку;
 *   6. UDP 443 по ipset;
 *   7. TCP 80,443,8443 по ipset;
 *   8. Game Filter TCP (`%GameFilterTCP%`, any-protocol, cutoff);
 *   9. Game Filter UDP (`%GameFilterUDP%`).
 * Отличается в основном «приём» для TCP (блоки 3, 4, 5, 7, 8) — его здесь и
 * выбирают: семейство (`FamilyId`) + числа (`TcpParams`).
 *
 * Флаги — только те, что встречаются в .bat Flowseal (их список проверяет
 * node-тест). Переменные `%BIN%`, `%LISTS%`, `%GameFilterTCP%`, `%GameFilterUDP%`
 * — как во встроенных .bat: их задают сам .bat и `service.bat load_game_filter`,
 * а LAZEYKA дополнительно передаёт Game Filter через окружение (getGameFilterVars).
 */

// ---- Типы ------------------------------------------------------------------------

export type FamilyId =
  | 'fakedsplit'
  | 'multisplit-seqovl'
  | 'fake-hostfakesplit'
  | 'fake-multisplit-badseq'
  | 'syndata'
  | 'fake-badseq'
  | 'fake-ts'
  | 'fake-multisplit-seqovl'
  | 'fake-multidisorder'
  | 'hostfakesplit'

export type Fooling = 'ts' | 'badseq' | 'md5sig'

/** Параметры приёма для TCP. Поле используется, только если оно есть в `uses` семейства. */
export interface TcpParams {
  /** --dpi-desync-repeats: сколько раз повторить поддельный пакет. 0 — не указывать. */
  repeats: number
  /** --dpi-desync-fooling: как сделать подделку «невидимой» для сервера. */
  fooling: Fooling[]
  /** --dpi-desync-badseq-increment (только вместе с fooling=badseq). 0 — не указывать. */
  badseqIncrement: number
  /** --dpi-desync-split-seqovl: на сколько байт «наложить» первую часть. */
  seqovl: number
  /** --dpi-desync-split-pos: где резать ClientHello (1, 2, 1,midsld, 2,sniext+1). '' — не указывать. */
  splitPos: string
  /** --dpi-desync-split-seqovl-pattern: файл из bin/, чем заполнить наложение. */
  seqovlPattern: string
  /** --dpi-desync-fake-tls: файлы подделки из bin/ (или 0x00000000, ! — исходный ClientHello). */
  fakeTls: string[]
  /** --dpi-desync-fake-tls-mod: '' — нет, 'none' — без изменений, 'rnd' — rnd,dupsid,sni=… */
  tlsMod: '' | 'none' | 'rnd'
  /** sni= для tlsMod='rnd'. */
  tlsSni: string
  /** --dpi-desync-fake-http: файл подделки для HTTP (порт 80). '' — нет. */
  fakeHttp: string
  /** host= для --dpi-desync-hostfakesplit-mod. */
  host: string
  /** altorder=1 для --dpi-desync-hostfakesplit-mod. */
  altorder: boolean
}

export interface StrategyModel {
  v: 1
  family: FamilyId
  tcp: TcpParams
  /** UDP 443 (QUIC): блоки по списку и по ipset. */
  quic: { enabled: boolean; repeats: number; fake: string }
  /** Голос Discord (UDP 19294-19344, 50000-50100). */
  discordVoice: boolean
  /** Порты Cloudflare 2053, 2083, 2087, 2096, 8443 (discord.media). */
  cloudflare: boolean
  /** Блоки Game Filter (порты задаются в «Настройках»). */
  game: boolean
}

export type TcpField = keyof TcpParams

export interface FamilySpec {
  id: FamilyId
  /** Значение --dpi-desync. */
  desync: string
  /** Короткое название для карточки. */
  title: string
  /** Что делает — простыми словами. */
  what: string
  /** Когда помогает. */
  helps: string
  /** Стратегия Flowseal, на которой основано семейство (general-блок TCP 80,443 повторён один в один). */
  reference: string
  /** Какие параметры TcpParams есть у приёма (остальные не пишутся в .bat). */
  uses: TcpField[]
  /** Значения из reference — с ними блок TCP 80,443 совпадает с Flowseal. */
  preset: TcpParams
}

// ---- Файлы и константы Flowseal --------------------------------------------------

export const FAKE_GOOGLE = 'tls_clienthello_www_google_com.bin'
export const FAKE_STUN = 'stun.bin'
export const FAKE_STUN2 = 'stun2.bin'
export const FAKE_4PDA = 'tls_clienthello_4pda_to.bin'
export const FAKE_MAXRU = 'tls_clienthello_max_ru.bin'
export const QUIC_GOOGLE = 'quic_initial_www_google_com.bin'
export const DISCORD_UDP_FAKE = 'ACTIVE_DISCORD_UDP.bin'
export const GAME_UDP_FAKE = 'ACTIVE_GAME_UDP.bin'
/** Особые значения --dpi-desync-fake-tls (не файлы). */
export const FAKE_ZERO = '0x00000000'
export const FAKE_ORIG = '!'

const CLOUDFLARE_PORTS = '2053,2083,2087,2096,8443'
const VOICE_PORTS = '19294-19344,50000-50100'

const BASE: TcpParams = {
  repeats: 0,
  fooling: [],
  badseqIncrement: 0,
  seqovl: 0,
  splitPos: '',
  seqovlPattern: '',
  fakeTls: [],
  tlsMod: '',
  tlsSni: '',
  fakeHttp: '',
  host: '',
  altorder: false
}

function preset(p: Partial<TcpParams>): TcpParams {
  return { ...BASE, ...p, fooling: [...(p.fooling ?? [])], fakeTls: [...(p.fakeTls ?? [])] }
}

/**
 * Семейства приёмов для TCP 443/80. Порядок — как в карточках конструктора.
 * Описания — по документации zapret (nfqws/winws) и по тому, как Flowseal их использует.
 */
export const FAMILIES: readonly FamilySpec[] = [
  {
    id: 'fakedsplit',
    desync: 'fake,fakedsplit',
    title: 'Подделка + разрезание с подделками',
    what: 'Перед настоящим запросом шлёт поддельный, а настоящий режет на части и перемешивает с подделками. Подделки сервер отбрасывает по метке времени (ts).',
    helps: 'Универсальный приём, с него стоит начинать. Помогает и при блокировке по имени сайта, и при обрыве загрузки.',
    reference: 'general (ALT)',
    uses: ['repeats', 'fooling', 'badseqIncrement', 'splitPos', 'tlsMod', 'tlsSni', 'fakeTls', 'fakeHttp'],
    preset: preset({ repeats: 6, fooling: ['ts'], fakeTls: [FAKE_STUN, FAKE_GOOGLE], fakeHttp: FAKE_MAXRU })
  },
  {
    id: 'multisplit-seqovl',
    desync: 'multisplit',
    title: 'Разрезание с наложением',
    what: 'Режет начало соединения на части, и первая часть «накладывается» на чужие байты из файла. Фильтр собирает не то, что получает сервер. Подделок нет.',
    helps: 'Когда сайт не открывается совсем (блокировка по имени сайта), а приёмы с подделками не помогают или ломают другие сайты.',
    reference: 'general (ALT2)',
    uses: ['seqovl', 'splitPos', 'seqovlPattern'],
    preset: preset({ seqovl: 652, splitPos: '2', seqovlPattern: FAKE_GOOGLE })
  },
  {
    id: 'fake-hostfakesplit',
    desync: 'fake,hostfakesplit',
    title: 'Подделка + подмена имени сайта',
    what: 'Шлёт подделку с чужим именем сайта и режет настоящий запрос так, что фильтр видит другое имя (host).',
    helps: 'Когда провайдер блокирует по имени сайта в начале соединения.',
    reference: 'general (ALT3)',
    uses: ['tlsMod', 'tlsSni', 'host', 'altorder', 'repeats', 'fooling', 'fakeHttp'],
    preset: preset({ tlsMod: 'rnd', tlsSni: 'ya.ru', host: 'ya.ru', altorder: true, fooling: ['ts'], fakeHttp: FAKE_MAXRU })
  },
  {
    id: 'fake-multisplit-badseq',
    desync: 'fake,multisplit',
    title: 'Подделка с неверным номером + разрезание',
    what: 'Подделки получают неверный порядковый номер пакета (badseq) — сервер их не примет, а фильтр примет. Настоящий запрос режется на части.',
    helps: 'Когда метка времени (ts) не работает: например, отключена в системе или её режет оборудование провайдера.',
    reference: 'general (ALT4)',
    uses: ['repeats', 'fooling', 'badseqIncrement', 'fakeTls', 'fakeHttp'],
    preset: preset({ repeats: 6, fooling: ['badseq'], badseqIncrement: 1000, fakeTls: [FAKE_STUN, FAKE_GOOGLE], fakeHttp: FAKE_MAXRU })
  },
  {
    id: 'syndata',
    desync: 'syndata,multidisorder',
    title: 'Данные в первом пакете + обратный порядок',
    what: 'Добавляет данные в самый первый пакет соединения и шлёт части запроса в обратном порядке. Действует на все сайты на этих портах, без списков.',
    helps: 'Редкий случай, когда остальное не помогает. Flowseal помечает такую стратегию как нерекомендуемую: может ломать часть сайтов.',
    reference: 'general (ALT5)',
    uses: [],
    preset: preset({})
  },
  {
    id: 'fake-badseq',
    desync: 'fake',
    title: 'Только подделка с неверным номером',
    what: 'Шлёт перед запросом подделку (исходный ClientHello без изменений) с неверным порядковым номером. Сам запрос не трогает.',
    helps: 'Лёгкий приём: когда фильтр смотрит только на первый пакет.',
    reference: 'general (ALT8)',
    uses: ['tlsMod', 'repeats', 'fooling', 'badseqIncrement', 'fakeHttp'],
    preset: preset({ tlsMod: 'none', repeats: 6, fooling: ['badseq'], badseqIncrement: 2, fakeHttp: FAKE_MAXRU })
  },
  {
    id: 'fake-ts',
    desync: 'fake',
    title: 'Только подделка (метка времени)',
    what: 'Шлёт перед запросом подделку из файла с меткой времени (ts), которую сервер отбросит. Сам запрос не трогает.',
    helps: 'Лёгкий приём для простых фильтров; хорошо работает, когда фильтр смотрит только на первый пакет.',
    reference: 'general (ALT10)',
    uses: ['repeats', 'fooling', 'badseqIncrement', 'fakeTls', 'fakeHttp'],
    preset: preset({ repeats: 6, fooling: ['ts'], fakeTls: [FAKE_STUN, FAKE_4PDA], fakeHttp: FAKE_MAXRU })
  },
  {
    id: 'fake-multisplit-seqovl',
    desync: 'fake,multisplit',
    title: 'Подделка + разрезание с наложением',
    what: 'Сочетает подделки (ts) и разрезание с наложением чужих байт. Самый «сильный» из приёмов с подделками.',
    helps: 'Когда загрузка обрывается или сайт открывается через раз; когда одиночные приёмы не справились.',
    reference: 'general (ALT11)',
    uses: ['seqovl', 'splitPos', 'fooling', 'badseqIncrement', 'repeats', 'seqovlPattern', 'fakeTls', 'fakeHttp'],
    preset: preset({
      seqovl: 664,
      splitPos: '1',
      fooling: ['ts'],
      repeats: 8,
      seqovlPattern: FAKE_MAXRU,
      fakeTls: [FAKE_STUN2, FAKE_MAXRU],
      fakeHttp: FAKE_MAXRU
    })
  },
  {
    id: 'fake-multidisorder',
    desync: 'fake,multidisorder',
    title: 'Подделка со случайным именем + обратный порядок',
    what: 'Подделка строится из вашего же запроса со случайными данными и другим именем сайта, настоящий запрос режется посередине имени сайта и уходит частями в обратном порядке.',
    helps: 'Когда фильтр собирает запрос из частей и узнаёт имя сайта. Хорошо помогает при блокировке по имени.',
    reference: 'general (FAKE TLS AUTO)',
    uses: ['splitPos', 'repeats', 'fooling', 'badseqIncrement', 'fakeTls', 'tlsMod', 'tlsSni', 'fakeHttp'],
    preset: preset({
      splitPos: '1,midsld',
      repeats: 11,
      fooling: ['badseq'],
      fakeTls: [FAKE_ZERO, FAKE_ORIG],
      tlsMod: 'rnd',
      tlsSni: 'www.google.com',
      fakeHttp: FAKE_MAXRU
    })
  },
  {
    id: 'hostfakesplit',
    desync: 'hostfakesplit',
    title: 'Только подмена имени сайта',
    what: 'Режет запрос по имени сайта и вставляет поддельное имя (host) между частями. Без отдельных пакетов-подделок.',
    helps: 'Когда подделки ломают соединение, а фильтр ищет имя сайта.',
    reference: 'general (ALT9)',
    uses: ['repeats', 'fooling', 'host'],
    preset: preset({ repeats: 4, fooling: ['ts', 'md5sig'], host: 'ozon.ru' })
  }
]

export function familySpec(id: FamilyId): FamilySpec {
  const f = FAMILIES.find((x) => x.id === id)
  if (!f) throw new Error(`Неизвестный приём: ${String(id)}`)
  return f
}

export function isFamilyId(v: unknown): v is FamilyId {
  return typeof v === 'string' && FAMILIES.some((f) => f.id === v)
}

/** Модель по умолчанию для семейства: параметры из стратегии Flowseal, все блоки включены. */
export function defaultModel(family: FamilyId = 'fakedsplit'): StrategyModel {
  return {
    v: 1,
    family,
    tcp: preset(familySpec(family).preset),
    quic: { enabled: true, repeats: 6, fake: QUIC_GOOGLE },
    discordVoice: true,
    cloudflare: true,
    game: true
  }
}

/** Пределы параметров (их же показывает конструктор). */
export const LIMITS = {
  repeats: { min: 1, max: 20 },
  seqovl: { min: 1, max: 1000 },
  badseqIncrement: { min: 1, max: 100000 },
  quicRepeats: { min: 1, max: 20 }
} as const

// ---- Проверка значений -------------------------------------------------------------

const BIN_FILE = /^[A-Za-z0-9_.-]{1,80}\.bin$/
const HOST = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
/** Маркеры позиций из документации zapret: число, method, host, endhost, sld, midsld, endsld, sniext (+/- смещение). */
const POS_TOKEN = /^(?:\d{1,4}|method|host|endhost|sld|midsld|endsld|sniext)(?:[+-]\d{1,4})?$/

export function isBinFile(v: unknown): v is string {
  return typeof v === 'string' && BIN_FILE.test(v) && !v.includes('..')
}

export function isHostName(v: unknown): v is string {
  return typeof v === 'string' && HOST.test(v)
}

export function isSplitPos(v: unknown): v is string {
  if (typeof v !== 'string' || !v) return false
  const parts = v.split(',')
  return parts.length <= 4 && parts.every((p) => POS_TOKEN.test(p))
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Привести присланные данные к допустимой модели: неизвестное отбрасывается,
 * числа зажимаются в пределы, файлы и имена — только безопасного вида.
 * Бросает ошибку, только если не задано семейство.
 */
export function normalizeModel(raw: unknown): StrategyModel {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!isFamilyId(r.family)) throw new Error('В стратегии не указан приём для TCP')
  const family = r.family
  const spec = familySpec(family)
  const p = (r.tcp && typeof r.tcp === 'object' ? r.tcp : {}) as Record<string, unknown>
  const d = spec.preset
  const fooling = Array.isArray(p.fooling)
    ? (p.fooling.filter((x) => x === 'ts' || x === 'badseq' || x === 'md5sig') as Fooling[])
    : [...d.fooling]
  const fakeTls = Array.isArray(p.fakeTls)
    ? p.fakeTls.filter((x) => x === FAKE_ZERO || x === FAKE_ORIG || isBinFile(x)).slice(0, 4) as string[]
    : [...d.fakeTls]
  const tcp: TcpParams = {
    repeats: p.repeats === 0 ? 0 : clampInt(p.repeats, LIMITS.repeats.min, LIMITS.repeats.max, d.repeats),
    fooling: [...new Set(fooling)],
    badseqIncrement:
      p.badseqIncrement === 0 ? 0 : clampInt(p.badseqIncrement, LIMITS.badseqIncrement.min, LIMITS.badseqIncrement.max, d.badseqIncrement),
    seqovl: clampInt(p.seqovl, LIMITS.seqovl.min, LIMITS.seqovl.max, d.seqovl || 0),
    splitPos: p.splitPos === '' ? '' : isSplitPos(p.splitPos) ? p.splitPos : d.splitPos,
    seqovlPattern: isBinFile(p.seqovlPattern) ? p.seqovlPattern : d.seqovlPattern,
    fakeTls: [...new Set(fakeTls)],
    tlsMod: p.tlsMod === 'none' || p.tlsMod === 'rnd' || p.tlsMod === '' ? p.tlsMod : d.tlsMod,
    tlsSni: p.tlsSni === '' ? '' : isHostName(p.tlsSni) ? p.tlsSni.toLowerCase() : d.tlsSni,
    fakeHttp: p.fakeHttp === '' ? '' : isBinFile(p.fakeHttp) ? p.fakeHttp : d.fakeHttp,
    host: isHostName(p.host) ? p.host.toLowerCase() : d.host,
    altorder: typeof p.altorder === 'boolean' ? p.altorder : d.altorder
  }
  // Поля, которых у приёма нет, приводим к пресету — чтобы сравнение моделей было честным.
  for (const k of Object.keys(BASE) as TcpField[]) {
    if (!spec.uses.includes(k)) (tcp as unknown as Record<string, unknown>)[k] = Array.isArray(d[k]) ? [...(d[k] as string[])] : d[k]
  }
  // Пустые обязательные значения — из пресета (иначе winws получит неполный приём).
  if (spec.uses.includes('host') && !tcp.host) tcp.host = d.host || 'www.google.com'
  if (spec.uses.includes('seqovlPattern') && !tcp.seqovlPattern) tcp.seqovlPattern = d.seqovlPattern || FAKE_GOOGLE
  if (spec.uses.includes('seqovl') && !tcp.seqovl) tcp.seqovl = d.seqovl
  if (spec.uses.includes('fooling') && tcp.fooling.length === 0) tcp.fooling = [...d.fooling]
  const q = (r.quic && typeof r.quic === 'object' ? r.quic : {}) as Record<string, unknown>
  return {
    v: 1,
    family,
    tcp,
    quic: {
      enabled: typeof q.enabled === 'boolean' ? q.enabled : true,
      repeats: clampInt(q.repeats, LIMITS.quicRepeats.min, LIMITS.quicRepeats.max, 6),
      fake: isBinFile(q.fake) ? q.fake : QUIC_GOOGLE
    },
    discordVoice: typeof r.discordVoice === 'boolean' ? r.discordVoice : true,
    cloudflare: typeof r.cloudflare === 'boolean' ? r.cloudflare : true,
    game: typeof r.game === 'boolean' ? r.game : true
  }
}

/** Все файлы из bin/, на которые ссылается модель (для проверки, что они есть в сборке). */
export function referencedBinFiles(m: StrategyModel): string[] {
  const out = new Set<string>()
  for (const t of tokensOfModel(m)) {
    if (t.value && t.quoted && t.value.startsWith('%BIN%')) out.add(t.value.slice(5))
  }
  return [...out]
}

// ---- Токены winws ------------------------------------------------------------------

export interface Token {
  flag: string
  value?: string
  /** Значение в кавычках (пути). */
  quoted?: boolean
}

const t = (flag: string, value?: string, quoted = false): Token => (value === undefined ? { flag } : { flag, value, quoted })
const binTok = (flag: string, file: string): Token =>
  file === FAKE_ZERO || file === FAKE_ORIG ? t(flag, file) : t(flag, `%BIN%${file}`, true)

const LIST_GENERAL: Token[] = [
  t('--hostlist', '%LISTS%list-general.txt', true),
  t('--hostlist', '%LISTS%list-general-user.txt', true),
  t('--hostlist-exclude', '%LISTS%list-exclude.txt', true),
  t('--hostlist-exclude', '%LISTS%list-exclude-user.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude-user.txt', true)
]
const LIST_IPSET: Token[] = [
  t('--ipset', '%LISTS%ipset-all.txt', true),
  t('--hostlist-exclude', '%LISTS%list-exclude.txt', true),
  t('--hostlist-exclude', '%LISTS%list-exclude-user.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude-user.txt', true)
]
const LIST_GAME: Token[] = [
  t('--ipset', '%LISTS%ipset-all.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude.txt', true),
  t('--ipset-exclude', '%LISTS%ipset-exclude-user.txt', true)
]

/** Вариант параметров для блоков google и Cloudflare: Flowseal везде берёт там подделку www.google.com. */
export function googleVariant(p: TcpParams): TcpParams {
  const hasFile = p.fakeTls.some((f) => f !== FAKE_ZERO && f !== FAKE_ORIG)
  const fakeTls = hasFile ? [...p.fakeTls.filter((f) => f === FAKE_ZERO || f === FAKE_ORIG), FAKE_GOOGLE] : [...p.fakeTls]
  return {
    ...p,
    fakeTls,
    fooling: [...p.fooling],
    seqovlPattern: p.seqovlPattern ? FAKE_GOOGLE : '',
    tlsSni: p.tlsSni ? 'www.google.com' : '',
    host: p.host ? 'www.google.com' : '',
    fakeHttp: ''
  }
}

/** Флаги приёма TCP (без фильтров и списков) — в порядке, близком к Flowseal. */
export function desyncTokens(family: FamilyId, p: TcpParams): Token[] {
  const spec = familySpec(family)
  const uses = (f: TcpField): boolean => spec.uses.includes(f)
  const out: Token[] = [t('--dpi-desync', spec.desync)]
  if (uses('tlsMod') && p.tlsMod === 'none') out.push(t('--dpi-desync-fake-tls-mod', 'none'))
  if (uses('tlsMod') && p.tlsMod === 'rnd' && !uses('fakeTls')) out.push(t('--dpi-desync-fake-tls-mod', tlsModValue(p)))
  if (uses('host')) out.push(t('--dpi-desync-hostfakesplit-mod', `host=${p.host}${uses('altorder') && p.altorder ? ',altorder=1' : ''}`))
  if (uses('seqovl') && p.seqovl > 0) out.push(t('--dpi-desync-split-seqovl', String(p.seqovl)))
  if (uses('splitPos') && p.splitPos) out.push(t('--dpi-desync-split-pos', p.splitPos))
  if (uses('repeats') && p.repeats > 0) out.push(t('--dpi-desync-repeats', String(p.repeats)))
  if (uses('fooling') && p.fooling.length) out.push(t('--dpi-desync-fooling', p.fooling.join(',')))
  if (uses('badseqIncrement') && p.fooling.includes('badseq') && p.badseqIncrement > 0) {
    out.push(t('--dpi-desync-badseq-increment', String(p.badseqIncrement)))
  }
  if (family === 'fakedsplit') out.push(t('--dpi-desync-fakedsplit-pattern', '0x00'))
  if (uses('seqovlPattern') && p.seqovlPattern) out.push(binTok('--dpi-desync-split-seqovl-pattern', p.seqovlPattern))
  if (uses('fakeTls')) for (const f of p.fakeTls) out.push(binTok('--dpi-desync-fake-tls', f))
  if (uses('tlsMod') && p.tlsMod === 'rnd' && uses('fakeTls')) out.push(t('--dpi-desync-fake-tls-mod', tlsModValue(p)))
  if (uses('fakeHttp') && p.fakeHttp) out.push(binTok('--dpi-desync-fake-http', p.fakeHttp))
  return out
}

function tlsModValue(p: TcpParams): string {
  return p.tlsSni ? `rnd,dupsid,sni=${p.tlsSni}` : 'rnd,dupsid'
}

/** Режим --dpi-desync содержит отдельный «fake» (подделки уходят отдельными пакетами). */
function hasFakeMode(family: FamilyId): boolean {
  return familySpec(family).desync.split(',').includes('fake')
}

/** Подделки для любых протоколов в Game Filter TCP — как в Flowseal: файлы fake-tls, иначе файл fake-http. */
function gameUnknownTokens(family: FamilyId, p: TcpParams): Token[] {
  if (!hasFakeMode(family)) return []
  const spec = familySpec(family)
  const list = spec.uses.includes('fakeTls') ? p.fakeTls.filter((f) => f !== FAKE_ORIG) : []
  const hasFile = list.some((f) => f !== FAKE_ZERO)
  if (!hasFile && spec.uses.includes('fakeHttp') && p.fakeHttp) list.push(p.fakeHttp)
  return list.map((f) => binTok('--dpi-desync-fake-unknown', f))
}

export type BlockKind =
  | 'quic-list'
  | 'voice'
  | 'cloudflare'
  | 'google'
  | 'general'
  | 'syndata-all'
  | 'quic-ipset'
  | 'tcp-ipset'
  | 'game-tcp'
  | 'game-udp'

export interface Block {
  kind: BlockKind
  tokens: Token[]
}

export interface WinwsCommand {
  wf: Token[]
  blocks: Block[]
}

/** Полная команда winws по модели: --wf-* и блоки в порядке Flowseal. */
export function buildCommand(m: StrategyModel): WinwsCommand {
  const p = m.tcp
  const fam = m.family
  const g = googleVariant(p)
  const blocks: Block[] = []
  const quicTokens = (): Token[] => [
    t('--dpi-desync', 'fake'),
    t('--dpi-desync-repeats', String(m.quic.repeats)),
    binTok('--dpi-desync-fake-quic', m.quic.fake)
  ]
  if (m.quic.enabled) blocks.push({ kind: 'quic-list', tokens: [t('--filter-udp', '443'), ...LIST_GENERAL, ...quicTokens()] })
  if (m.discordVoice) {
    blocks.push({
      kind: 'voice',
      tokens: [
        t('--filter-udp', VOICE_PORTS),
        t('--filter-l7', 'discord,stun'),
        t('--dpi-desync', 'fake'),
        binTok('--dpi-desync-fake-discord', DISCORD_UDP_FAKE),
        binTok('--dpi-desync-fake-stun', DISCORD_UDP_FAKE),
        t('--dpi-desync-repeats', '6')
      ]
    })
  }
  if (fam === 'syndata') {
    // ALT5: один блок на все TCP-порты, без списков.
    blocks.push({
      kind: 'syndata-all',
      tokens: [
        t('--filter-l3', 'ipv4'),
        t('--filter-tcp', m.cloudflare ? `80,443,${CLOUDFLARE_PORTS}` : '80,443,8443'),
        t('--ipset-exclude', '%LISTS%ipset-exclude.txt', true),
        t('--ipset-exclude', '%LISTS%ipset-exclude-user.txt', true),
        t('--dpi-desync', familySpec(fam).desync)
      ]
    })
    if (m.game) {
      blocks.push({
        kind: 'game-tcp',
        tokens: [
          t('--filter-tcp', '%GameFilterTCP%'),
          ...LIST_GAME,
          t('--dpi-desync', familySpec(fam).desync),
          t('--dpi-desync-any-protocol', '1'),
          t('--dpi-desync-cutoff', 'n4')
        ]
      })
    }
    if (m.quic.enabled) blocks.push({ kind: 'quic-ipset', tokens: [t('--filter-udp', '443'), ...LIST_IPSET, ...quicTokens()] })
  } else {
    if (m.cloudflare) {
      blocks.push({
        kind: 'cloudflare',
        tokens: [t('--filter-tcp', CLOUDFLARE_PORTS), t('--hostlist-domains', 'discord.media'), ...desyncTokens(fam, g)]
      })
    }
    blocks.push({
      kind: 'google',
      tokens: [t('--filter-tcp', '443'), t('--hostlist', '%LISTS%list-google.txt', true), t('--ip-id', 'zero'), ...desyncTokens(fam, g)]
    })
    blocks.push({ kind: 'general', tokens: [t('--filter-tcp', '80,443'), ...LIST_GENERAL, ...desyncTokens(fam, p)] })
    if (m.quic.enabled) blocks.push({ kind: 'quic-ipset', tokens: [t('--filter-udp', '443'), ...LIST_IPSET, ...quicTokens()] })
    blocks.push({ kind: 'tcp-ipset', tokens: [t('--filter-tcp', '80,443,8443'), ...LIST_IPSET, ...desyncTokens(fam, p)] })
    if (m.game) {
      const d = desyncTokens(fam, p)
      blocks.push({
        kind: 'game-tcp',
        tokens: [
          t('--filter-tcp', '%GameFilterTCP%'),
          ...LIST_GAME,
          d[0],
          t('--dpi-desync-any-protocol', '1'),
          t('--dpi-desync-cutoff', 'n4'),
          ...d.slice(1),
          ...gameUnknownTokens(fam, p)
        ]
      })
    }
  }
  if (m.game) {
    blocks.push({
      kind: 'game-udp',
      tokens: [
        t('--filter-udp', '%GameFilterUDP%'),
        ...LIST_GAME,
        t('--dpi-desync', 'fake'),
        t('--dpi-desync-repeats', '12'),
        t('--dpi-desync-any-protocol', '1'),
        binTok('--dpi-desync-fake-unknown-udp', GAME_UDP_FAKE),
        t('--dpi-desync-cutoff', 'n3')
      ]
    })
  }
  const tcpPorts = ['80', '443', ...(m.cloudflare ? CLOUDFLARE_PORTS.split(',') : ['8443'])]
  if (m.game) tcpPorts.push('%GameFilterTCP%')
  const udp: string[] = []
  if (m.quic.enabled) udp.push('443')
  if (m.discordVoice) udp.push(VOICE_PORTS)
  if (m.game) udp.push('%GameFilterUDP%')
  const wf: Token[] = [t('--wf-tcp', tcpPorts.join(','))]
  if (udp.length) wf.push(t('--wf-udp', udp.join(',')))
  return { wf, blocks }
}

function tokensOfModel(m: StrategyModel): Token[] {
  const c = buildCommand(m)
  return [...c.wf, ...c.blocks.flatMap((b) => b.tokens)]
}

/** Токен в виде .bat: кавычки у путей, `!` экранируется `^!` (как в FAKE TLS AUTO). */
export function renderToken(tok: Token): string {
  if (tok.value === undefined) return tok.flag
  if (tok.quoted) return `${tok.flag}="${tok.value}"`
  if (tok.value === FAKE_ORIG) return `${tok.flag}=^!`
  return `${tok.flag}=${tok.value}`
}

/** Одна строка команды (для предпросмотра): блоки разделены переводом строки. */
export function renderCommandPreview(m: StrategyModel): string {
  const c = buildCommand(m)
  const lines = [`winws.exe ${c.wf.map(renderToken).join(' ')}`]
  c.blocks.forEach((b, i) => lines.push(`${b.tokens.map(renderToken).join(' ')}${i < c.blocks.length - 1 ? ' --new' : ''}`))
  return lines.join('\n')
}

// ---- Имена своих стратегий ---------------------------------------------------------

/** Пометка своих стратегий в имени файла: `general (LZ <название>).bat`. */
export const CUSTOM_PREFIX = 'general (LZ '

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._+,-]*$/u

/** Привести название к допустимому виду или вернуть ошибку простыми словами. */
export function checkCustomName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Введите название' }
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, message: 'Введите название' }
  if (name.length > 40) return { ok: false, message: 'Название длиннее 40 символов' }
  if (name.includes('..')) return { ok: false, message: 'Две точки подряд в названии нельзя' }
  if (!NAME_RE.test(name)) {
    return { ok: false, message: 'Можно буквы, цифры, пробел и знаки . _ + , - (без скобок, кавычек и слешей)' }
  }
  return { ok: true, name }
}

export function customFileName(name: string): string {
  return `${CUSTOM_PREFIX}${name}).bat`
}

/** Название своей стратегии из имени файла или null, если файл не свой. */
export function customNameFromFile(file: string): string | null {
  if (!file.startsWith(CUSTOM_PREFIX) || !/\)\.bat$/i.test(file)) return null
  return file.slice(CUSTOM_PREFIX.length, -').bat'.length) || null
}

// ---- .bat -------------------------------------------------------------------------

const MODEL_MARK = ':: LZMODEL:'

function b64encode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64')
}
function b64decode(s: string): string {
  return Buffer.from(s, 'base64').toString('utf-8')
}

/** Безопасный текст для комментария `::` в .bat. */
function commentSafe(s: string): string {
  return s.replace(/[\r\n%^&|<>"!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
}

/**
 * .bat в формате встроенной сборки (как после установки: без `start /min`, winws
 * запускается прямо из cmd), CRLF. Модель записана комментарием — по ней
 * стратегию можно восстановить, если пропадёт файл со списком своих стратегий.
 */
export function generateBat(m: StrategyModel, name: string): string {
  const c = buildCommand(m)
  const fam = familySpec(m.family)
  const head = [
    '@echo off',
    'chcp 65001 > nul',
    ':: 65001 - UTF-8',
    `:: ${commentSafe(`Своя стратегия LAZEYKA «${name}». Приём: ${fam.title.toLowerCase()} (на основе ${fam.reference})`)}`,
    `${MODEL_MARK}${b64encode(JSON.stringify(m))}`,
    '',
    'cd /d "%~dp0"',
    'call service.bat status_zapret',
    'call service.bat check_updates',
    'call service.bat load_game_filter',
    'call service.bat load_user_lists',
    'echo:',
    '',
    'set "BIN=%~dp0bin\\"',
    'set "LISTS=%~dp0lists\\"',
    'cd /d %BIN%',
    ''
  ]
  const lines = [`"%BIN%winws.exe" ${c.wf.map(renderToken).join(' ')} ^`]
  c.blocks.forEach((b, i) => {
    const last = i === c.blocks.length - 1
    lines.push(`${b.tokens.map(renderToken).join(' ')}${last ? '' : ' --new ^'}`)
  })
  return [...head, ...lines, ''].join('\r\n')
}

/** Модель, записанная в .bat конструктором (или null). */
export function modelFromBatComment(text: string): StrategyModel | null {
  for (const line of text.split(/\r?\n/).slice(0, 12)) {
    if (!line.startsWith(MODEL_MARK)) continue
    try {
      return normalizeModel(JSON.parse(b64decode(line.slice(MODEL_MARK.length).trim())))
    } catch {
      return null
    }
  }
  return null
}

// ---- Разбор .bat -------------------------------------------------------------------

/** Разбить строку аргументов на токены с учётом кавычек (`--x="a b"` — один токен). */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  let has = false
  for (const ch of s) {
    if (ch === '"') {
      inQ = !inQ
      cur += ch
      has = true
    } else if (!inQ && /\s/.test(ch)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

export function parseToken(raw: string): Token {
  const eq = raw.indexOf('=')
  if (eq < 0) return { flag: raw }
  const flag = raw.slice(0, eq)
  let value = raw.slice(eq + 1)
  let quoted = false
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
    quoted = true
  }
  if (value === '^!') value = FAKE_ORIG
  return quoted ? { flag, value, quoted } : { flag, value }
}

/** Аргументы winws из .bat: строка с winws.exe и продолжения через `^`. */
export function extractWinwsArgs(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let capture = false
  let raw = ''
  for (const line0 of lines) {
    const line = line0.trim()
    if (!capture) {
      if (!/winws\.exe/i.test(line) || /^(::|rem\b)/i.test(line)) continue
      capture = true
      const rest = line.replace(/^.*?winws\.exe"?/i, '')
      if (!rest.trimEnd().endsWith('^')) return rest.trim()
      raw += rest.replace(/\^\s*$/, '') + ' '
      continue
    }
    if (!line || /^(::|rem\b)/i.test(line)) continue
    if (line.endsWith('^')) {
      raw += line.replace(/\^\s*$/, '') + ' '
    } else {
      raw += line
      break
    }
  }
  return capture ? raw.trim() : null
}

/** Команда winws из текста .bat: --wf-* и блоки (с определением вида блока). */
export function parseBatCommand(text: string): WinwsCommand | null {
  const args = extractWinwsArgs(text)
  if (args === null) return null
  const toks = splitArgs(args).map(parseToken)
  const wf: Token[] = []
  const blocks: Block[] = []
  let cur: Token[] = []
  for (const tok of toks) {
    if (tok.flag === '--new') {
      if (cur.length) blocks.push({ kind: classifyBlock(cur), tokens: cur })
      cur = []
    } else if (tok.flag === '--wf-tcp' || tok.flag === '--wf-udp') {
      wf.push(tok)
    } else {
      cur.push(tok)
    }
  }
  if (cur.length) blocks.push({ kind: classifyBlock(cur), tokens: cur })
  return { wf, blocks }
}

function val(tokens: Token[], flag: string): string | undefined {
  return tokens.find((x) => x.flag === flag)?.value
}
function vals(tokens: Token[], flag: string): string[] {
  return tokens.filter((x) => x.flag === flag).map((x) => x.value ?? '')
}

export function classifyBlock(tokens: Token[]): BlockKind {
  const tcp = val(tokens, '--filter-tcp')
  const udp = val(tokens, '--filter-udp')
  const l7 = val(tokens, '--filter-l7') ?? ''
  const lists = vals(tokens, '--hostlist').join(' ')
  const ipset = vals(tokens, '--ipset').join(' ')
  if (udp && /GameFilter/i.test(udp)) return 'game-udp'
  if (tcp && /GameFilter/i.test(tcp)) return 'game-tcp'
  if (udp && udp.includes('19294')) return 'voice'
  if (l7.includes('quic') || udp === '443') return ipset ? 'quic-ipset' : 'quic-list'
  if (val(tokens, '--filter-l3') || (tcp && tcp.startsWith('80,443,2053'))) return 'syndata-all'
  if (tcp && tcp.startsWith('2053')) return 'cloudflare'
  if (/list-google/i.test(lists)) return 'google'
  if (ipset) return 'tcp-ipset'
  return 'general'
}

function stripBin(v: string | undefined): string {
  if (!v) return ''
  return v.replace(/^%BIN%/i, '').replace(/^.*[\\/]/, '')
}

/** Определить семейство по блоку TCP (общий список, иначе ipset, иначе google). */
export function detectFamily(tokens: Token[]): FamilyId | null {
  const d = val(tokens, '--dpi-desync') ?? ''
  const has = (f: string): boolean => tokens.some((x) => x.flag === f)
  switch (d) {
    case 'fake,fakedsplit':
      return 'fakedsplit'
    case 'multisplit':
      return 'multisplit-seqovl'
    case 'fake,hostfakesplit':
      return 'fake-hostfakesplit'
    case 'fake,multisplit':
      return has('--dpi-desync-split-seqovl') ? 'fake-multisplit-seqovl' : 'fake-multisplit-badseq'
    case 'syndata,multidisorder':
    case 'syndata':
      return 'syndata'
    case 'fake':
      return val(tokens, '--dpi-desync-fake-tls-mod') === 'none' || !has('--dpi-desync-fake-tls') ? 'fake-badseq' : 'fake-ts'
    case 'fake,multidisorder':
      return 'fake-multidisorder'
    case 'hostfakesplit':
      return 'hostfakesplit'
    default:
      return null
  }
}

export interface ParsedStrategy {
  model: StrategyModel
  /** Семейство определено, но в исходной .bat были флаги, которых нет в модели (показываем «близко к»). */
  approximate: boolean
}

/**
 * Разбор .bat в модель (для «Создать на основе»). Сначала комментарий конструктора,
 * иначе — блок TCP 80,443 по общему списку.
 */
export function parseBatToModel(text: string): ParsedStrategy | null {
  const own = modelFromBatComment(text)
  if (own) return { model: own, approximate: false }
  const cmd = parseBatCommand(text)
  if (!cmd) return null
  const pick =
    cmd.blocks.find((b) => b.kind === 'general') ??
    cmd.blocks.find((b) => b.kind === 'syndata-all') ??
    cmd.blocks.find((b) => b.kind === 'tcp-ipset') ??
    cmd.blocks.find((b) => b.kind === 'google')
  if (!pick) return null
  const family = detectFamily(pick.tokens)
  if (!family) return null
  const tk = pick.tokens
  const fooling = (val(tk, '--dpi-desync-fooling') ?? '').split(',').filter(Boolean)
  const mod = val(tk, '--dpi-desync-fake-tls-mod') ?? ''
  const hfs = val(tk, '--dpi-desync-hostfakesplit-mod') ?? ''
  const raw = {
    family,
    tcp: {
      repeats: Number(val(tk, '--dpi-desync-repeats') ?? 0),
      fooling,
      badseqIncrement: Number(val(tk, '--dpi-desync-badseq-increment') ?? 0),
      seqovl: Number(val(tk, '--dpi-desync-split-seqovl') ?? 0),
      splitPos: val(tk, '--dpi-desync-split-pos') ?? '',
      seqovlPattern: stripBin(val(tk, '--dpi-desync-split-seqovl-pattern')),
      fakeTls: vals(tk, '--dpi-desync-fake-tls').map((v) => (v === FAKE_ZERO || v === FAKE_ORIG ? v : stripBin(v))),
      tlsMod: mod === 'none' ? 'none' : mod.startsWith('rnd') ? 'rnd' : '',
      tlsSni: /sni=([^,]+)/.exec(mod)?.[1] ?? '',
      fakeHttp: stripBin(val(tk, '--dpi-desync-fake-http')),
      host: /host=([^,]+)/.exec(hfs)?.[1] ?? '',
      altorder: /altorder=1/.test(hfs)
    },
    quic: quicFrom(cmd),
    discordVoice: cmd.blocks.some((b) => b.kind === 'voice'),
    cloudflare: cmd.blocks.some((b) => b.kind === 'cloudflare') || cmd.blocks.some((b) => b.kind === 'syndata-all' && /2053/.test(val(b.tokens, '--filter-tcp') ?? '')),
    game: cmd.blocks.some((b) => b.kind === 'game-tcp' || b.kind === 'game-udp')
  }
  const model = normalizeModel(raw)
  // Совпадает ли наш блок с исходным по набору флагов.
  const ours = buildCommand(model).blocks.find((b) => b.kind === pick.kind)
  const sig = (x: Token[]): string => x.map((y) => `${y.flag}=${y.value ?? ''}`).sort().join(' ')
  const approximate = !ours || sig(ours.tokens) !== sig(pick.tokens)
  return { model, approximate }
}

function quicFrom(cmd: WinwsCommand): { enabled: boolean; repeats: number; fake: string } {
  const b = cmd.blocks.find((x) => x.kind === 'quic-list') ?? cmd.blocks.find((x) => x.kind === 'quic-ipset')
  if (!b) return { enabled: false, repeats: 6, fake: QUIC_GOOGLE }
  return {
    enabled: true,
    repeats: Number(val(b.tokens, '--dpi-desync-repeats') ?? 6),
    fake: stripBin(vals(b.tokens, '--dpi-desync-fake-quic')[0]) || QUIC_GOOGLE
  }
}

// ---- Экспорт / импорт текстом -----------------------------------------------------

const EXPORT_PREFIX = 'LZS1:'

export function exportStrategyText(name: string, m: StrategyModel): string {
  return EXPORT_PREFIX + b64encode(JSON.stringify({ n: name, m }))
}

/** Разобрать текст экспорта. Принимает и саму .bat (тогда название — из комментария или «Импорт»). */
export function importStrategyText(text: string): { name: string; model: StrategyModel } {
  const s = (text ?? '').trim()
  if (s.length > 200_000) throw new Error('Слишком длинный текст')
  if (s.startsWith(EXPORT_PREFIX)) {
    let obj: { n?: unknown; m?: unknown }
    try {
      obj = JSON.parse(b64decode(s.slice(EXPORT_PREFIX.length).replace(/\s+/g, '')))
    } catch {
      throw new Error('Текст повреждён — скопируйте его целиком ещё раз')
    }
    const model = normalizeModel(obj.m)
    const nm = checkCustomName(obj.n)
    return { name: nm.ok ? nm.name : 'Импорт', model }
  }
  if (/winws\.exe/i.test(s)) {
    const parsed = parseBatToModel(s)
    if (!parsed) throw new Error('В этом .bat не удалось узнать приём для TCP')
    return { name: 'Импорт', model: parsed.model }
  }
  throw new Error('Это не текст стратегии LAZEYKA (он начинается с LZS1:)')
}

// ---- Описание модели простыми словами --------------------------------------------

export function describeModel(m: StrategyModel): string {
  const f = familySpec(m.family)
  const parts = [f.title]
  const p = m.tcp
  if (f.uses.includes('repeats') && p.repeats) parts.push(`повторов ${p.repeats}`)
  if (f.uses.includes('fooling') && p.fooling.length) parts.push(`метка ${p.fooling.join('+')}`)
  if (f.uses.includes('seqovl') && p.seqovl) parts.push(`наложение ${p.seqovl}`)
  if (!m.quic.enabled) parts.push('без QUIC')
  if (!m.game) parts.push('без Game Filter')
  return parts.join(', ')
}
