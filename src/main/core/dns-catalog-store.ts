/**
 * Хранилище каталога встроенных DNS: скачанный и проверенный каталог
 * (кэш), правки пользователя поверх встроенных записей и мелкие пометки
 * («уведомление уже показано»). Всё в папке данных, запись атомарная.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import { allAddrs, removedIds, validateCatalog, type Catalog, type CatalogPreset } from './dns-catalog-logic'

export interface CatalogCache {
  fetchedAt: number
  source: string
  catalog: Catalog
  /** Адреса, которые раньше были в каталоге, а теперь нет: их флаги DoH убираем при смене DNS. */
  retired: string[]
  /**
   * Записи, которые автор убрал и которых больше нет в presets (добавленные не в коде):
   * последняя известная копия. Нужна, чтобы узнать такой DNS, если он сейчас включён у
   * пользователя, и показать плашку «убран автором», а не «свой DNS системы».
   */
  kept: CatalogPreset[]
}

/** Правка пользователя поверх встроенной записи. Приоритетнее каталога, пока не сброшена. */
export interface BuiltinOverride {
  ipv4: string[]
  ipv6: string[]
  doh: string
  dohOnly: boolean
  editedAt: number
}

export interface CatalogMeta {
  /** Подпись адресов, о смене которых уже показано системное уведомление: `${id}:${подпись}`. */
  notifiedChange?: string
  /** id сервера, о котором «не отвечает» уже показано уведомление. */
  notifiedDead?: string
  /** id включённого сервера, о котором «убран автором» уже показано уведомление. */
  notifiedRemoved?: string
}

const dir = (): string => dataDir()
const cacheFile = (): string => path.join(dir(), 'dns-presets-cache.json')
const overridesFile = (): string => path.join(dir(), 'dns-builtin-overrides.json')
const metaFile = (): string => path.join(dir(), 'dns-catalog-meta.json')

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileAtomic(file, JSON.stringify(value, null, 2))
}

// ---- каталог ------------------------------------------------------------------------

let cacheMem: CatalogCache | null | undefined

/** Кэш с диска. Файл на диске проверяем заново тем же валидатором: его могли испортить. */
export function loadCatalogCache(): CatalogCache | null {
  if (cacheMem !== undefined) return cacheMem
  cacheMem = null
  try {
    if (!existsSync(cacheFile())) return null
    const j = JSON.parse(readFileSync(cacheFile(), 'utf-8')) as Partial<CatalogCache>
    const check = validateCatalog(JSON.stringify(j.catalog ?? null))
    if (!check.ok) return null
    cacheMem = {
      fetchedAt: Number(j.fetchedAt) || 0,
      source: typeof j.source === 'string' ? j.source.slice(0, 200) : '',
      catalog: check.catalog,
      retired: Array.isArray(j.retired) ? j.retired.filter((a): a is string => typeof a === 'string').slice(0, 60) : [],
      kept: keptFrom(j.kept, check.catalog)
    }
  } catch {
    cacheMem = null
  }
  return cacheMem
}

/** Копии убранных записей с диска: тот же валидатор, только id из removed и не из presets. */
function keptFrom(raw: unknown, cat: Catalog): CatalogPreset[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const check = validateCatalog(JSON.stringify({ version: 1, updated: '2000-01-01', presets: raw.slice(0, 30) }))
  if (!check.ok) return []
  const gone = removedIds(cat)
  const inPresets = new Set(cat.presets.map((p) => p.id))
  return check.catalog.presets.filter((p) => gone.has(p.id) && !inPresets.has(p.id))
}

export function saveCatalogCache(next: { catalog: Catalog; source: string }): CatalogCache {
  const prev = loadCatalogCache()
  // Убранная запись, которой больше нет в presets: держим последнюю копию (из прежнего каталога).
  const gone = removedIds(next.catalog)
  const inPresets = new Set(next.catalog.presets.map((p) => p.id))
  const keptMap = new Map<string, CatalogPreset>()
  for (const p of [...(prev?.kept ?? []), ...(prev?.catalog.presets ?? [])]) {
    if (gone.has(p.id) && !inPresets.has(p.id)) keptMap.set(p.id, p)
  }
  // Адреса, пропавшие из каталога, запоминаем как «прежние» (максимум 60).
  const now = new Set(next.catalog.presets.flatMap((p) => allAddrs(p)))
  const retired = new Set(prev?.retired ?? [])
  for (const p of prev?.catalog.presets ?? []) for (const a of allAddrs(p)) if (!now.has(a)) retired.add(a)
  for (const a of now) retired.delete(a)
  const cache: CatalogCache = {
    fetchedAt: Date.now(),
    source: next.source,
    catalog: next.catalog,
    retired: [...retired].slice(-60),
    kept: [...keptMap.values()].slice(0, 30)
  }
  writeJson(cacheFile(), cache)
  cacheMem = cache
  return cache
}

/** Отметить, что проверка была (даже если файл не изменился) — чтобы не ходить в сеть чаще раза в 6 часов. */
export function touchCatalogCache(): void {
  const c = loadCatalogCache()
  if (!c) return
  const next = { ...c, fetchedAt: Date.now() }
  writeJson(cacheFile(), next)
  cacheMem = next
}

// ---- правки пользователя -----------------------------------------------------------

let overridesMem: Record<string, BuiltinOverride> | null = null

export function loadOverrides(): Record<string, BuiltinOverride> {
  if (overridesMem) return overridesMem
  overridesMem = {}
  try {
    if (existsSync(overridesFile())) {
      const j = JSON.parse(readFileSync(overridesFile(), 'utf-8')) as Record<string, Partial<BuiltinOverride>>
      for (const [id, v] of Object.entries(j ?? {})) {
        if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(id) || !v || !Array.isArray(v.ipv4) || v.ipv4.length === 0) continue
        overridesMem[id] = {
          ipv4: v.ipv4.map(String).slice(0, 2),
          ipv6: Array.isArray(v.ipv6) ? v.ipv6.map(String).slice(0, 2) : [],
          doh: typeof v.doh === 'string' ? v.doh : '',
          dohOnly: Boolean(v.dohOnly),
          editedAt: Number(v.editedAt) || 0
        }
      }
    }
  } catch {
    overridesMem = {}
  }
  return overridesMem
}

export function saveOverride(id: string, ov: BuiltinOverride): void {
  const all = { ...loadOverrides(), [id]: ov }
  writeJson(overridesFile(), all)
  overridesMem = all
}

export function removeOverride(id: string): void {
  const all = { ...loadOverrides() }
  delete all[id]
  writeJson(overridesFile(), all)
  overridesMem = all
}

// ---- скрытые пользователем («скрыть у себя») ---------------------------------------

const hiddenFile = (): string => path.join(dir(), 'dns-hidden.json')
let hiddenMem: string[] | null = null

/** Встроенные записи, которые пользователь скрыл только у себя. Без сети, только локально. */
export function loadHidden(): string[] {
  if (hiddenMem) return hiddenMem
  hiddenMem = []
  try {
    if (existsSync(hiddenFile())) {
      const j = JSON.parse(readFileSync(hiddenFile(), 'utf-8')) as unknown
      if (Array.isArray(j)) hiddenMem = [...new Set(j.filter((x): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{1,31}$/.test(x)))].slice(0, 60)
    }
  } catch {
    hiddenMem = []
  }
  return hiddenMem
}

export function setHidden(id: string, hidden: boolean): string[] {
  const cur = loadHidden().filter((x) => x !== id)
  const next = hidden ? [...cur, id].slice(-60) : cur
  writeJson(hiddenFile(), next)
  hiddenMem = next
  return next
}

// ---- пометки -----------------------------------------------------------------------

export function loadMeta(): CatalogMeta {
  try {
    if (!existsSync(metaFile())) return {}
    const j = JSON.parse(readFileSync(metaFile(), 'utf-8')) as CatalogMeta
    return {
      notifiedChange: typeof j.notifiedChange === 'string' ? j.notifiedChange : undefined,
      notifiedDead: typeof j.notifiedDead === 'string' ? j.notifiedDead : undefined,
      notifiedRemoved: typeof j.notifiedRemoved === 'string' ? j.notifiedRemoved : undefined
    }
  } catch {
    return {}
  }
}

export function saveMeta(patch: Partial<CatalogMeta>): void {
  try {
    writeJson(metaFile(), { ...loadMeta(), ...patch })
  } catch {
    /* пометка — не критично */
  }
}
