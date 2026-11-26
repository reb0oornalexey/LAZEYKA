/**
 * Значок провайдера подписки — чистая логика без Electron (её проверяют тесты).
 *
 * В заголовках подписки поля для картинки нет. Приложение INCY берёт логотип из своего закрытого
 * зашифрованного API для провайдеров — его мы не трогаем. Вместо этого берём значок там, куда
 * провайдер сам ведёт людей: его сайт (`profile-web-page-url`) или Telegram (`support-url`,
 * страница t.me отдаёт аватарку канала/бота в og:image).
 */

/** Куда смотреть за значком, по порядку. Только http(s), без адресов в локальной сети. */
export function iconSources(sub: { webPageUrl?: string; supportUrl?: string }): { url: string; kind: 'site' | 'telegram' }[] {
  const out: { url: string; kind: 'site' | 'telegram' }[] = []
  for (const raw of [sub.webPageUrl, sub.supportUrl]) {
    const u = safeUrl(raw)
    if (!u) continue
    const host = u.hostname.toLowerCase()
    const tg = host === 't.me' || host === 'telegram.me' || host === 'www.t.me'
    if (tg) {
      // t.me/имя (канал, бот, группа). Ссылки-приглашения (+код, joinchat) аватарку не отдают.
      const name = u.pathname.split('/').filter(Boolean)[0] ?? ''
      if (!/^[A-Za-z0-9_]{4,64}$/.test(name)) continue
      out.push({ url: `https://t.me/${name}`, kind: 'telegram' })
    } else {
      out.push({ url: u.origin + '/', kind: 'site' })
    }
  }
  // Один и тот же адрес дважды не спрашиваем.
  return out.filter((x, i) => out.findIndex((y) => y.url === x.url) === i)
}

function safeUrl(raw: string | undefined): URL | null {
  if (!raw) return null
  try {
    const u = new URL(String(raw).trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const h = u.hostname
    // Не ходим в локальную сеть по ссылке из чужой подписки.
    if (h === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.startsWith('[')) return null
    return u
  } catch {
    return null
  }
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : null
}

/**
 * Лучшая картинка со страницы. Telegram — og:image (аватарка). Сайт — apple-touch-icon
 * (обычно 180×180), затем самый крупный <link rel="icon">, затем og:image, затем /favicon.ico.
 */
export function pickIconFromHtml(html: string, pageUrl: string, kind: 'site' | 'telegram'): string[] {
  const head = html.slice(0, 200_000)
  const abs = (href: string | null): string | null => {
    if (!href) return null
    try {
      const u = new URL(href.replace(/&amp;/g, '&'), pageUrl)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
    } catch {
      return null
    }
  }
  const metas = head.match(/<meta\b[^>]*>/gi) ?? []
  const og = abs(
    metas.map((t) => (/(property|name)\s*=\s*["']?(og:image|twitter:image)["']?/i.test(t) ? attr(t, 'content') : null)).find(Boolean) ?? null
  )
  if (kind === 'telegram') return og && !/telegram\.org\/img\/t_logo/i.test(og) ? [og] : []

  const links = (head.match(/<link\b[^>]*>/gi) ?? [])
    .map((t) => ({ rel: (attr(t, 'rel') ?? '').toLowerCase(), href: abs(attr(t, 'href')), sizes: attr(t, 'sizes') ?? '' }))
    .filter((l) => l.href && /\bicon\b|apple-touch-icon/.test(l.rel))
  const size = (s: string): number => Math.max(0, ...s.split(/\s+/).map((x) => Number(x.split('x')[0]) || 0))
  const apple = links.filter((l) => l.rel.includes('apple-touch-icon')).sort((a, b) => size(b.sizes) - size(a.sizes))
  const icons = links.filter((l) => !l.rel.includes('apple-touch-icon')).sort((a, b) => size(b.sizes) - size(a.sizes))
  const list = [...apple, ...icons].map((l) => l.href as string)
  if (og) list.push(og)
  list.push(new URL('/favicon.ico', pageUrl).href)
  return list.filter((x, i) => list.indexOf(x) === i)
}

/** Картинку берём, только если это действительно картинка разумного размера. */
export const ICON_MAX_BYTES = 256 * 1024
export function iconMime(contentType: string | null, bytes: Uint8Array): string | null {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const b = bytes
  if (b.length < 16 || b.length > ICON_MAX_BYTES) return null
  // По сигнатуре — сервер может врать о типе.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon'
  if (ct === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg\b/i.test(new TextDecoder().decode(b.slice(0, 256)))) return 'image/svg+xml'
  return null
}

/** Свою картинку пользователь выбирает сам — проверяем, что это data:URL картинки. */
export function validIconDataUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^data:(image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml));base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  if ((m[3].length * 3) / 4 > ICON_MAX_BYTES * 2) return null
  return v
}
