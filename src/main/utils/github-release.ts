export interface GhAsset {
  name: string
  browser_download_url: string
  size?: number
}

export interface GhRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
  assets?: GhAsset[]
}

const REQUEST_HEADERS = {
  'User-Agent': 'LAZEYKA-Updater',
  Accept: 'application/vnd.github+json'
}

/**
 * Robustly fetch the latest release info for a GitHub repo.
 * Automatically falls back to Atom XML feed and HTML redirect if GitHub API
 * rate-limits (HTTP 403) or fails, ensuring update checks NEVER break.
 */
export async function fetchLatestGithubRelease(repo: string): Promise<GhRelease> {
  // 1. Try GitHub REST API
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: REQUEST_HEADERS
    })
    if (res.ok) {
      const data = (await res.json()) as GhRelease
      if (data && (data.tag_name || data.name)) {
        return data
      }
    }
  } catch {
    // API failed or rate-limited; fallback
  }

  // 2. Fallback: Parse GitHub Atom XML Feed (un-rate-limited, public)
  try {
    const atomRes = await fetch(`https://github.com/${repo}/releases.atom`, {
      headers: { 'User-Agent': 'LAZEYKA-Updater', Accept: 'application/atom+xml' }
    })
    if (atomRes.ok) {
      const xml = await atomRes.text()
      // Первая запись ленты может быть пре-релизом (1.3.0-beta): в ленте нет
      // флага prerelease, и такой релиз ставился как обычное обновление.
      // Берём первую запись без «-» в теге.
      let entry = ''
      let tagMatch: RegExpMatchArray | null = null
      for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
        const t = m[1].match(/<id>[^<]*\/(v?[^<]+)<\/id>/i) || m[1].match(/href="[^"]*\/releases\/tag\/([^"]+)"/i)
        if (!t || t[1].includes('-')) continue
        entry = m[1]
        tagMatch = t
        break
      }
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/i)
      const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/i)
      const contentMatch = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i)

      if (tagMatch) {
        const tag = tagMatch[1].trim()
        const rawBody = contentMatch
          ? contentMatch[1]
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, '&')
              .replace(/<[^>]+>/g, '')
              .trim()
          : ''

        return {
          tag_name: tag,
          name: titleMatch ? titleMatch[1].trim() : tag,
          html_url: `https://github.com/${repo}/releases/tag/${tag}`,
          published_at: updatedMatch ? updatedMatch[1].trim() : new Date().toISOString(),
          body: rawBody
        }
      }
    }
  } catch {
    // Atom failed; fallback to redirect
  }

  // 3. Fallback: /releases/latest HTTP 302 Redirect
  try {
    const redRes = await fetch(`https://github.com/${repo}/releases/latest`, {
      redirect: 'manual',
      headers: { 'User-Agent': 'LAZEYKA-Updater' }
    })
    const loc = redRes.headers.get('location')
    if (loc) {
      const match = loc.match(/\/releases\/tag\/(.+)$/)
      if (match) {
        const tag = match[1].trim()
        return {
          tag_name: tag,
          name: tag,
          html_url: `https://github.com/${repo}/releases/tag/${tag}`,
          published_at: new Date().toISOString()
        }
      }
    }
  } catch {
    // ignore
  }

  throw new Error(`Не удалось получить информацию о релизах для ${repo}`)
}

// ---- История релизов (окно обновления) --------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * HTML из ленты релизов → markdown. В ленте GitHub отдаёт уже отрендеренный
 * текст заметок; окну обновления удобнее тот же markdown, что и из API.
 */
function atomHtmlToMarkdown(html: string): string {
  return decodeEntities(html)
    .replace(/\r/g, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n${'#'.repeat(Number(n))} ${t.trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `- ${t.replace(/\s+/g, ' ').trim()}\n`)
    .replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Список релизов по страницам, от новых к старым. Сначала REST API; если
 * GitHub ограничил запросы (403 у многих, кто сидит за VPN с общим IP) —
 * лента releases.atom, она лимитов не имеет (последние ~10 релизов).
 */
export async function fetchGithubReleases(repo: string, page = 1, perPage = 4): Promise<GhRelease[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${perPage}&page=${page}`, {
      headers: REQUEST_HEADERS
    })
    if (res.ok) {
      const data = (await res.json()) as GhRelease[]
      if (Array.isArray(data)) return data
    }
  } catch {
    /* ниже — запасной путь */
  }

  const atomRes = await fetch(`https://github.com/${repo}/releases.atom`, {
    headers: { 'User-Agent': 'LAZEYKA-Updater', Accept: 'application/atom+xml' }
  })
  if (!atomRes.ok) throw new Error(`GitHub вернул ${atomRes.status}`)
  const xml = await atomRes.text()
  const all: GhRelease[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const e = m[1]
    const tag = /<id>[^<]*\/([^/<]+)<\/id>/i.exec(e)?.[1]?.trim()
    if (!tag) continue
    const title = /<title>([^<]*)<\/title>/i.exec(e)?.[1]?.trim()
    const updated = /<updated>([^<]+)<\/updated>/i.exec(e)?.[1]?.trim()
    const content = /<content[^>]*>([\s\S]*?)<\/content>/i.exec(e)?.[1] ?? ''
    all.push({
      tag_name: tag,
      name: title ? decodeEntities(title) : tag,
      html_url: `https://github.com/${repo}/releases/tag/${tag}`,
      published_at: updated,
      body: atomHtmlToMarkdown(content)
    })
  }
  return all.slice((page - 1) * perPage, page * perPage)
}
