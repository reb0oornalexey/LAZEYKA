/**
 * Память маршрутов: «программа запоминает, что помогло».
 *
 * Список сайтов, для которых пользователь выбрал «всегда так»: помогает Zapret,
 * нужен VPN или лучше напрямую. Решения применяются при каждом запуске.
 *
 *  - 'zapret' → домен в свой список Zapret (addSitesToZapret);
 *  - 'vpn'    → своё правило «через VPN» (customRoutingRules);
 *  - 'direct' → своё правило «напрямую».
 *
 * Ничего не работает само по себе: файл читается по запросу и один раз при
 * запуске программы, пока в нём есть записи. При удалении записи созданное ею
 * правило убирается; домен из списка Zapret автоматически НЕ удаляется.
 */
import path from 'node:path'
import net from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { dataDir } from '../utils/dirs'
import { writeFileAtomic } from '../utils/atomic-write'
import {
  appendLog,
  loadIncySettings,
  patchIncySettings,
  type IncyRoutingRule
} from './incy-engine'
import { addSitesToZapret, isZapretBundlePresent } from './site-check'

export type RouteFix = 'zapret' | 'vpn' | 'direct'

export interface RouteMemoryEntry {
  domain: string
  fix: RouteFix
  /** Когда запомнили, мс с эпохи. */
  at: number
  /** Откуда пришла запись: 'site-check', 'connections', 'manual'. */
  source: string
  /** id созданного правила (для vpn/direct). */
  ruleId?: string
  /** Правило создала именно эта запись — при удалении оно убирается. */
  ownRule?: boolean
}

export interface RouteMemoryItem extends RouteMemoryEntry {
  /** Для vpn/direct: правило сейчас есть в «Своих правилах» и включено. */
  ruleActive: boolean
}

const MAX_ENTRIES = 500

// ---- чистые функции ---------------------------------------------------------------

/** Домен или IP из ввода пользователя; null — если это не похоже на адрес. */
export function normalizeRouteDomain(input: string): string | null {
  let v = String(input ?? '').trim().toLowerCase()
  if (!v) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(v)) {
    try {
      v = new URL(v).hostname
    } catch {
      return null
    }
  }
  v = v.replace(/\/.*$/, '').replace(/\.$/, '')
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1)
  if (net.isIP(v) !== 0) return v
  v = v.replace(/:\d+$/, '').replace(/^\*\./, '')
  if (net.isIP(v) !== 0) return v
  if (/^(geosite|geoip|ext):/.test(v)) return null
  if (v.length > 253) return null
  // Домен в Unicode допустим (кириллица) — движок переведёт его сам.
  return /^(?!-)[^\s/\\:@]+(\.[^\s/\\:@]+)+$/.test(v) ? v : null
}

export function memoryRuleId(domain: string): string {
  return `rm-${domain}`
}

function sameValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Поставить правило для адреса. Правило с тем же значением обновляется на месте
 * (сохраняя id и порядок), иначе добавляется новое в конец.
 */
export function upsertRule(
  rules: IncyRoutingRule[],
  spec: { value: string; action: IncyRoutingRule['action']; id: string; comment?: string }
): { rules: IncyRoutingRule[]; id: string; created: boolean; changed: boolean } {
  const idx = rules.findIndex((r) => r && typeof r.value === 'string' && sameValue(r.value, spec.value))
  if (idx >= 0) {
    const cur = rules[idx]
    if (cur.action === spec.action && cur.enabled) {
      return { rules, id: cur.id, created: false, changed: false }
    }
    const next = rules.slice()
    next[idx] = { ...cur, action: spec.action, enabled: true }
    return { rules: next, id: cur.id, created: false, changed: true }
  }
  const rule: IncyRoutingRule = {
    id: spec.id,
    value: spec.value,
    action: spec.action,
    enabled: true,
    ...(spec.comment ? { comment: spec.comment } : {})
  }
  return { rules: [...rules, rule], id: rule.id, created: true, changed: true }
}

export function removeRuleById(rules: IncyRoutingRule[], id: string): IncyRoutingRule[] {
  return rules.filter((r) => r.id !== id)
}

/**
 * Какие правила нужно добавить при запуске: только недостающие. Существующее
 * правило с тем же значением не трогаем — пользователь мог изменить его вручную.
 */
export function missingMemoryRules(
  rules: IncyRoutingRule[],
  entries: RouteMemoryEntry[]
): { rules: IncyRoutingRule[]; added: string[] } {
  let cur = rules
  const added: string[] = []
  for (const e of entries) {
    if (e.fix === 'zapret') continue
    if (cur.some((r) => r && typeof r.value === 'string' && sameValue(r.value, e.domain))) continue
    const res = upsertRule(cur, {
      value: e.domain,
      action: e.fix === 'vpn' ? 'proxy' : 'direct',
      id: memoryRuleId(e.domain),
      comment: 'Из памяти маршрутов'
    })
    cur = res.rules
    added.push(e.domain)
  }
  return { rules: cur, added }
}

export function sanitizeEntries(raw: unknown): RouteMemoryEntry[] {
  const list = (raw as { entries?: unknown })?.entries
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: RouteMemoryEntry[] = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const domain = normalizeRouteDomain(String(o.domain ?? ''))
    const fix = o.fix
    if (!domain || (fix !== 'zapret' && fix !== 'vpn' && fix !== 'direct')) continue
    if (seen.has(domain)) continue
    seen.add(domain)
    out.push({
      domain,
      fix,
      at: Number(o.at) || 0,
      source: typeof o.source === 'string' ? o.source.slice(0, 40) : 'manual',
      ...(typeof o.ruleId === 'string' ? { ruleId: o.ruleId } : {}),
      ...(o.ownRule === true ? { ownRule: true } : {})
    })
  }
  return out.slice(0, MAX_ENTRIES)
}

// ---- хранилище ---------------------------------------------------------------------

function memoryFile(): string {
  return path.join(dataDir(), 'route-memory.json')
}

function loadEntries(): RouteMemoryEntry[] {
  try {
    if (!existsSync(memoryFile())) return []
    return sanitizeEntries(JSON.parse(readFileSync(memoryFile(), 'utf-8')))
  } catch {
    return []
  }
}

function saveEntries(entries: RouteMemoryEntry[]): void {
  writeFileAtomic(memoryFile(), JSON.stringify({ version: 1, entries }, null, 2))
}

// ---- правила пользователя ------------------------------------------------------------

/**
 * Поставить своё правило для адреса через обычный механизм настроек INCY.
 * Если правило меняет маршрутизацию поднятого туннеля, движок сам
 * переподключит его (с задержкой и слиянием нескольких правок в одно).
 */
export function setDomainRule(
  value: string,
  action: IncyRoutingRule['action'],
  id: string,
  comment: string
): { id: string; created: boolean; reapplied: boolean } {
  const s = loadIncySettings()
  const res = upsertRule(s.customRoutingRules ?? [], { value, action, id, comment })
  let reapplied = false
  if (res.changed) reapplied = patchIncySettings({ customRoutingRules: res.rules }).reapplied
  return { id: res.id, created: res.created, reapplied }
}

function removeDomainRule(id: string): void {
  const s = loadIncySettings()
  const rules = s.customRoutingRules ?? []
  if (!rules.some((r) => r.id === id)) return
  patchIncySettings({ customRoutingRules: removeRuleById(rules, id) })
}

// ---- API -----------------------------------------------------------------------------

export function listRouteMemory(): RouteMemoryItem[] {
  const rules = loadIncySettings().customRoutingRules ?? []
  return loadEntries()
    .sort((a, b) => b.at - a.at)
    .map((e) => ({
      ...e,
      ruleActive:
        e.fix === 'zapret'
          ? true
          : rules.some(
              (r) =>
                r.enabled &&
                sameValue(r.value, e.domain) &&
                r.action === (e.fix === 'vpn' ? 'proxy' : 'direct')
            )
    }))
}

export async function addRouteMemory(
  domainInput: string,
  fix: RouteFix,
  source = 'manual'
): Promise<{ entry: RouteMemoryEntry; zapretAdded?: number; zapretRestarted?: boolean }> {
  const domain = normalizeRouteDomain(domainInput)
  if (!domain) throw new Error('Не удалось разобрать адрес сайта')
  if (fix !== 'zapret' && fix !== 'vpn' && fix !== 'direct') throw new Error('Неизвестный тип решения')
  const entries = loadEntries()
  const prev = entries.find((e) => e.domain === domain)
  const entry: RouteMemoryEntry = { domain, fix, at: Date.now(), source: String(source).slice(0, 40) }
  let zapretAdded: number | undefined
  let zapretRestarted: boolean | undefined

  if (fix === 'zapret') {
    if (/^[\d.:]+$/.test(domain) || net.isIP(domain) !== 0) {
      throw new Error('Для Zapret нужен домен, а не IP-адрес')
    }
    const r = await addSitesToZapret([domain])
    zapretAdded = r.added
    zapretRestarted = r.restarted
  } else {
    const res = setDomainRule(
      domain,
      fix === 'vpn' ? 'proxy' : 'direct',
      memoryRuleId(domain),
      'Из памяти маршрутов'
    )
    entry.ruleId = res.id
    // Если правило уже было у пользователя, оно останется при удалении записи.
    entry.ownRule = res.created || (prev?.ownRule === true && prev.ruleId === res.id)
  }

  // Сменили решение (например, «VPN» → «Zapret»): правило прежней записи уходит.
  if (prev?.ownRule && prev.ruleId && prev.ruleId !== entry.ruleId) removeDomainRule(prev.ruleId)

  const next = [entry, ...entries.filter((e) => e.domain !== domain)].slice(0, MAX_ENTRIES)
  saveEntries(next)
  appendLog(`Память маршрутов: «${domain}» — ${fix === 'zapret' ? 'через Zapret' : fix === 'vpn' ? 'через VPN' : 'напрямую'}.`)
  return { entry, zapretAdded, zapretRestarted }
}

export function removeRouteMemory(domainInput: string): boolean {
  const domain = normalizeRouteDomain(domainInput)
  if (!domain) return false
  const entries = loadEntries()
  const entry = entries.find((e) => e.domain === domain)
  if (!entry) return false
  if (entry.fix !== 'zapret' && entry.ownRule && entry.ruleId) removeDomainRule(entry.ruleId)
  saveEntries(entries.filter((e) => e.domain !== domain))
  // Домен в списке Zapret остаётся: его могли добавить и вручную, и другие записи.
  return true
}

/**
 * Вернуть недостающие правила (например, после смены профиля маршрутизации,
 * который заменил список «Своих правил»).
 */
export function reapplyRouteMemoryRules(): number {
  const entries = loadEntries().filter((e) => e.fix !== 'zapret')
  if (entries.length === 0) return 0
  const s = loadIncySettings()
  const res = missingMemoryRules(s.customRoutingRules ?? [], entries)
  if (res.added.length === 0) return 0
  patchIncySettings({ customRoutingRules: res.rules })
  const all = loadEntries()
  for (const e of all) {
    if (res.added.includes(e.domain)) {
      e.ruleId = memoryRuleId(e.domain)
      e.ownRule = true
    }
  }
  saveEntries(all)
  return res.added.length
}

/**
 * При запуске программы: вернуть правила и домены Zapret из памяти.
 * Вызывать до автоподключения INCY, чтобы туннель поднялся уже с правилами.
 * Записей нет — ничего не делает и ничего не читает, кроме одного файла.
 */
export function applyRouteMemoryOnStart(): void {
  try {
    const entries = loadEntries()
    if (entries.length === 0) return
    const n = reapplyRouteMemoryRules()
    if (n > 0) appendLog(`Память маршрутов: возвращено правил — ${n}.`)
    const zapretDomains = entries.filter((e) => e.fix === 'zapret').map((e) => e.domain)
    if (zapretDomains.length > 0 && isZapretBundlePresent()) {
      // Однократно, чуть позже старта: не мешаем запуску Zapret и INCY.
      const t = setTimeout(() => {
        addSitesToZapret(zapretDomains).catch(() => void 0)
      }, 20_000)
      t.unref?.()
    }
  } catch (e) {
    appendLog(`Память маршрутов не применилась: ${e instanceof Error ? e.message : String(e)}`)
  }
}
