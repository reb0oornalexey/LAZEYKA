/**
 * Флаг страны для узла VPN по его названию.
 *
 * Порядок: флаг уже есть в названии → название страны или города (по-русски
 * и по-английски) → код страны заглавными (`DE`, `[NL]`, `SE-1`). Раньше
 * в коде был короткий список из десятка стран, и у Польши, Финляндии и всех
 * остальных вместо флага стоял глобус.
 */

/** ISO-код → основы названий (нижний регистр, без окончаний). */
const COUNTRIES: Record<string, string[]> = {
  RU: ['росси', 'москв', 'петербург', 'russia', 'moscow'],
  DE: ['германи', 'франкфурт', 'берлин', 'мюнхен', 'germany', 'frankfurt', 'berlin', 'munich'],
  NL: ['нидерланд', 'голланд', 'амстердам', 'netherlands', 'holland', 'amsterdam'],
  SE: ['швеци', 'стокгольм', 'sweden', 'stockholm'],
  FI: ['финлянд', 'хельсинк', 'finland', 'helsinki'],
  PL: ['польш', 'варшав', 'poland', 'warsaw'],
  LV: ['латви', 'latvia', 'riga'],
  LT: ['литв', 'вильнюс', 'lithuania', 'vilnius'],
  EE: ['эстони', 'таллин', 'estonia', 'tallinn'],
  FR: ['франци', 'париж', 'france', 'paris'],
  GB: ['великобритан', 'англи', 'лондон', 'united kingdom', 'england', 'britain', 'london'],
  IE: ['ирланди', 'дублин', 'ireland', 'dublin'],
  US: ['сша', 'америк', 'нью-йорк', 'лос-андж', 'united states', 'america', 'new york', 'los angeles', 'miami', 'chicago'],
  CA: ['канад', 'торонто', 'canada', 'toronto'],
  JP: ['япони', 'токио', 'japan', 'tokyo'],
  KR: ['корея', 'кореи', 'сеул', 'korea', 'seoul'],
  SG: ['сингапур', 'singapore'],
  HK: ['гонконг', 'hong kong', 'hongkong'],
  TW: ['тайван', 'taiwan'],
  CN: ['китай', 'china'],
  IN: ['индия', 'индии', 'india', 'mumbai'],
  KZ: ['казахстан', 'алмат', 'астан', 'kazakhstan', 'almaty', 'astana'],
  UZ: ['узбекистан', 'ташкент', 'uzbekistan', 'tashkent'],
  KG: ['кыргыз', 'киргиз', 'бишкек', 'kyrgyz', 'bishkek'],
  AM: ['армени', 'ереван', 'armenia', 'yerevan'],
  GE: ['грузия', 'грузии', 'тбилис', 'georgia', 'tbilisi'],
  AZ: ['азербайджан', 'баку', 'azerbaijan', 'baku'],
  BY: ['беларус', 'белорус', 'минск', 'belarus', 'minsk'],
  UA: ['украин', 'киев', 'ukraine', 'kyiv', 'kiev'],
  MD: ['молдов', 'кишин', 'moldova', 'chisinau'],
  TR: ['турци', 'стамбул', 'анкар', 'turkey', 'türkiye', 'istanbul', 'ankara'],
  AE: ['оаэ', 'эмират', 'дубай', 'emirates', 'dubai', 'uae'],
  IL: ['израил', 'israel', 'tel aviv'],
  IT: ['итали', 'милан', 'italy', 'milan'],
  ES: ['испани', 'мадрид', 'барселон', 'spain', 'madrid', 'barcelona'],
  PT: ['португал', 'лиссабон', 'portugal', 'lisbon'],
  CH: ['швейцари', 'цюрих', 'женев', 'switzerland', 'zurich', 'geneva'],
  AT: ['австри', 'вена', 'austria', 'vienna'],
  BE: ['бельги', 'брюссел', 'belgium', 'brussels'],
  LU: ['люксембург', 'luxembourg'],
  CZ: ['чехия', 'чехии', 'прага', 'czech', 'prague'],
  SK: ['словаки', 'slovakia', 'bratislava'],
  HU: ['венгри', 'будапешт', 'hungary', 'budapest'],
  RO: ['румыни', 'бухарест', 'romania', 'bucharest'],
  BG: ['болгари', 'софия', 'bulgaria', 'sofia'],
  RS: ['серби', 'белград', 'serbia', 'belgrade'],
  HR: ['хорвати', 'croatia', 'zagreb'],
  SI: ['словени', 'slovenia', 'ljubljana'],
  GR: ['греци', 'афин', 'greece', 'athens'],
  CY: ['кипр', 'cyprus'],
  DK: ['дания', 'дании', 'копенгаген', 'denmark', 'copenhagen'],
  NO: ['норвеги', 'осло', 'norway', 'oslo'],
  IS: ['исланди', 'iceland', 'reykjavik'],
  AU: ['австрали', 'сидне', 'australia', 'sydney'],
  NZ: ['новая зеланд', 'new zealand'],
  BR: ['бразили', 'brazil', 'sao paulo'],
  AR: ['аргентин', 'argentina'],
  MX: ['мексик', 'mexico'],
  ZA: ['юар', 'южная африк', 'south africa'],
  EG: ['египет', 'egypt'],
  VN: ['вьетнам', 'vietnam'],
  TH: ['таиланд', 'тайланд', 'thailand', 'bangkok'],
  ID: ['индонези', 'indonesia', 'jakarta'],
  MY: ['малайзи', 'malaysia'],
  PH: ['филиппин', 'philippines'],
  MN: ['монголи', 'mongolia'],
  RE: ['реюньон', 'reunion']
}

/** Код страны → эмодзи-флаг (две буквы региональных индикаторов). */
export function flagFromCode(code: string): string {
  const cc = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

export function getFlagEmoji(name: string): string {
  const raw = String(name ?? '')
  const n = raw.toLowerCase()
  if (n.includes('⚡') || n.includes('warp') || n.includes('cloudflare')) return '⚡'
  // Флаг уже есть в названии — так делает большинство провайдеров.
  const own = raw.match(/\p{Regional_Indicator}{2}/u)
  if (own) return own[0]
  for (const [code, words] of Object.entries(COUNTRIES)) {
    if (words.some((w) => n.includes(w))) return flagFromCode(code)
  }
  // Код страны отдельным словом и заглавными: «DE-1», «[NL]», «Server SE».
  const tokens = raw.match(/(?<![A-Za-z])[A-Z]{2}(?![A-Za-z])/g) ?? []
  for (const t of tokens) {
    const code = t === 'UK' ? 'GB' : t
    if (COUNTRIES[code]) return flagFromCode(code)
  }
  if (n.includes('🇪🇺') || n.includes('авто') || n.includes('smart') || n.includes('europe') || n.includes('европ')) {
    return '🇪🇺'
  }
  return '🌐'
}
