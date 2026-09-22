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
      const tagMatch =
        xml.match(/<entry>[\s\S]*?<id>[^<]*\/(v?[^<]+)<\/id>/i) ||
        xml.match(/<link[^>]*href="[^"]*\/releases\/tag\/([^"]+)"/i)
      const titleMatch = xml.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/i)
      const updatedMatch = xml.match(/<entry>[\s\S]*?<updated>([^<]+)<\/updated>/i)
      const contentMatch = xml.match(/<entry>[\s\S]*?<content[^>]*>([\s\S]*?)<\/content>/i)

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
