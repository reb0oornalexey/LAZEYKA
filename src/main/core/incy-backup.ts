/**
 * Export and restore everything the INCY tab owns: the subscription, the
 * server list, routing rules and settings.
 *
 * The Backup tab used to offer only an export — a browser `Blob` download of
 * a JSON blob with no way to ever load it back. A backup you cannot restore is
 * not a backup, so this module adds the other half and moves the export into
 * the main process, where a real save dialog can put the file wherever the
 * user wants instead of dropping it in Downloads.
 *
 * Restore is deliberately two-step: read the file, show what is inside, and
 * only then apply the parts the user ticked. Silently replacing a working
 * subscription with the contents of an unknown file is exactly the kind of
 * surprise a restore feature must not produce.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dialog, BrowserWindow } from 'electron'
import {
  loadIncyNodes,
  saveIncyNodes,
  loadIncySubscription,
  saveIncySubscription,
  loadIncySettings,
  saveIncySettings,
  type IncyNode,
  type IncySubscription,
  type IncySettings
} from './incy-engine'

const FORMAT = 'lazeyka-incy'
const VERSION = 1

interface IncyBackupFile {
  format: typeof FORMAT
  version: number
  exportedAt: number
  subscription: IncySubscription | null
  nodes: IncyNode[]
  settings: Partial<IncySettings>
}

export interface IncyBackupPreview {
  ok: boolean
  message?: string
  filePath?: string
  exportedAt?: number
  subscriptionTitle?: string | null
  nodeCount?: number
  routingRuleCount?: number
  hasSettings?: boolean
}

export interface IncyBackupParts {
  subscription: boolean
  nodes: boolean
  settings: boolean
  routingRules: boolean
}

/**
 * Fields that must never travel between machines.
 *
 * `socksUser`/`socksPass` guard the local proxy port on *this* computer; a
 * shared backup that carried them would hand every recipient the same
 * credentials. They are regenerated from the defaults on restore. Measured
 * latencies are dropped for the same reason a stale ping is not shown after a
 * restart — they describe the old machine's network, not the new one's.
 */
function sanitiseSettings(settings: IncySettings): Partial<IncySettings> {
  const copy: Partial<IncySettings> = { ...settings }
  delete copy.socksUser
  delete copy.socksPass
  // The selected node is an id into the server list; if the list is not
  // restored alongside it, it points at nothing.
  return copy
}

function stripLatency(nodes: IncyNode[]): IncyNode[] {
  return nodes.map((n) => ({ ...n, latencyMs: null, latencyAt: undefined }))
}

function buildBundle(): IncyBackupFile {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    subscription: loadIncySubscription(),
    nodes: stripLatency(loadIncyNodes()),
    settings: sanitiseSettings(loadIncySettings())
  }
}

export async function exportIncyBackup(): Promise<{ ok: boolean; filePath?: string; message?: string }> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Экспорт конфигурации INCY',
    defaultPath: `lazeyka-incy-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'INCY Backup (*.json)', extensions: ['json'] }]
  })
  if (canceled || !filePath) return { ok: false, message: 'Отменено' }

  try {
    writeFileSync(filePath, JSON.stringify(buildBundle(), null, 2), 'utf-8')
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * The same bundle as a single base64 string, for "Скопировать ссылку".
 *
 * Kept small on purpose: it carries the subscription URL and the settings, not
 * the server list — a subscription re-downloads its own servers, and a
 * clipboard payload with 40 nodes in it is unusable in a chat message.
 */
export function buildIncyBackupLink(): string {
  const sub = loadIncySubscription()
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    subscription: sub ? { url: sub.url, title: sub.title } : null,
    settings: sanitiseSettings(loadIncySettings())
  }
  return `lazeyka://restore/${Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')}`
}

function parseBundle(raw: string): IncyBackupFile | null {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    if (data.format !== FORMAT) return null
    return {
      format: FORMAT,
      version: Number(data.version) || 1,
      exportedAt: Number(data.exportedAt) || 0,
      subscription: data.subscription ?? null,
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {}
    }
  } catch {
    return null
  }
}

/**
 * Pick a file and describe its contents without changing anything.
 * `filePath` is returned so `applyIncyBackup` can re-read the very same file.
 */
export async function pickIncyBackup(): Promise<IncyBackupPreview> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Восстановление конфигурации INCY',
    properties: ['openFile'],
    filters: [{ name: 'INCY Backup (*.json)', extensions: ['json'] }]
  })
  if (canceled || !filePaths?.[0]) return { ok: false, message: 'Отменено' }

  const filePath = filePaths[0]
  let bundle: IncyBackupFile | null
  try {
    bundle = parseBundle(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
  if (!bundle) {
    return {
      ok: false,
      message: 'Это не резервная копия INCY — в файле нет метки формата lazeyka-incy.'
    }
  }
  if (bundle.version > VERSION) {
    return {
      ok: false,
      message: `Файл создан более новой версией приложения (формат ${bundle.version}). Обновите LAZEYKA.`
    }
  }

  const rules = Array.isArray(bundle.settings.customRoutingRules)
    ? bundle.settings.customRoutingRules.length
    : 0

  return {
    ok: true,
    filePath,
    exportedAt: bundle.exportedAt,
    subscriptionTitle: bundle.subscription?.title ?? null,
    nodeCount: bundle.nodes.length,
    routingRuleCount: rules,
    hasSettings: Object.keys(bundle.settings).length > 0
  }
}

/** Apply the selected parts of a previously previewed backup. */
export function applyIncyBackup(
  filePath: string,
  parts: IncyBackupParts
): { ok: boolean; message?: string; applied: string[] } {
  let bundle: IncyBackupFile | null
  try {
    bundle = parseBundle(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), applied: [] }
  }
  if (!bundle) return { ok: false, message: 'Файл повреждён или не является копией INCY', applied: [] }

  const applied: string[] = []

  if (parts.nodes && bundle.nodes.length > 0) {
    saveIncyNodes(stripLatency(bundle.nodes))
    applied.push(`серверы (${bundle.nodes.length})`)
  }

  if (parts.subscription && bundle.subscription) {
    saveIncySubscription(bundle.subscription)
    applied.push('подписка')
  }

  if (parts.settings || parts.routingRules) {
    const current = loadIncySettings()
    const incoming = bundle.settings

    // Start from what is on this machine, so a field the backup predates keeps
    // its current (or default) value instead of becoming undefined.
    const next: IncySettings = { ...current }

    if (parts.settings) {
      for (const [key, value] of Object.entries(incoming)) {
        if (key === 'customRoutingRules') continue
        if (key === 'socksUser' || key === 'socksPass') continue
        // A selected node that is not in the restored list would leave the app
        // pointing at a server that does not exist.
        if (key === 'selectedNodeId' && !parts.nodes) continue
        ;(next as any)[key] = value
      }
      applied.push('настройки')
    }

    if (parts.routingRules && Array.isArray(incoming.customRoutingRules)) {
      next.customRoutingRules = incoming.customRoutingRules
      applied.push(`правила маршрутизации (${incoming.customRoutingRules.length})`)
    }

    saveIncySettings(next)
  }

  if (applied.length === 0) {
    return { ok: false, message: 'Нечего восстанавливать: в файле нет выбранных разделов', applied }
  }
  return { ok: true, applied }
}
