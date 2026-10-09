/**
 * История версий компонентов (Zapret, TgWsProxy) — заметки авторов к релизам
 * с GitHub для окна обновления, как у самой LAZEYKA.
 */
import { fetchGithubReleases } from '../utils/github-release'
import { getAppConfig } from '../config'
import { tgwsCliPaths } from '../utils/dirs'

export type UpdatableComponent = 'zapret' | 'tgws'

const REPOS: Record<UpdatableComponent, string> = {
  zapret: 'Flowseal/zapret-discord-youtube',
  tgws: 'Flowseal/tg-ws-proxy'
}

export interface ComponentReleaseNote {
  tag: string
  version: string
  title: string
  body: string
  publishedAt?: string
  url?: string
  installed: boolean
}

function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function installedOf(component: UpdatableComponent): Promise<string | undefined> {
  const cfg = await getAppConfig()
  if (component === 'tgws') return tgwsCliPaths()?.version || cfg.tgws?.installedVersion || undefined
  return cfg.zapret?.installedVersion || undefined
}

const cache = new Map<string, { at: number; data: ComponentReleaseNote[] }>()
const TTL = 30 * 60 * 1000

export async function getComponentReleaseHistory(
  component: UpdatableComponent,
  page = 1,
  perPage = 6
): Promise<ComponentReleaseNote[]> {
  const repo = REPOS[component]
  if (!repo) throw new Error(`Неизвестный компонент: ${component}`)
  const key = `${component}:${page}:${perPage}`
  const installed = await installedOf(component)
  const hit = cache.get(key)
  let list = hit && Date.now() - hit.at < TTL ? hit.data : null
  if (!list) {
    try {
      const raw = await fetchGithubReleases(repo, page, perPage)
      list = raw
        .filter((r) => !r.draft && !r.prerelease && r.tag_name)
        .map((r) => {
          const tag = String(r.tag_name).trim()
          const version = tag.replace(/^v/i, '')
          return {
            tag,
            version,
            title: r.name?.trim() || tag,
            body: (r.body ?? '').replace(/\r\n/g, '\n').trim(),
            publishedAt: r.published_at,
            url: r.html_url,
            installed: false
          }
        })
      cache.set(key, { at: Date.now(), data: list })
    } catch (e) {
      if (hit) list = hit.data
      else throw new Error(`Не удалось загрузить список изменений: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return list.map((n) => ({ ...n, installed: !!installed && cmp(n.version, installed) === 0 }))
}
