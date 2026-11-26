/**
 * Брандмауэр Windows для раздела «Локальная сеть».
 *
 * Правило «LAZEYKA LAN»: входящие TCP на порты пульта и прокси, во ВСЕХ профилях сети (частная, общедоступная, домен),
 * но только с адресов локальных сетей (10/8, 172.16/12, 192.168/16). Профиль «все» нужен из-за раздачи Wi-Fi:
 * сеть мобильного хот-спота Windows обычно получает профиль «Общедоступная», и правило только для частной сети
 * устройства хот-спота не пускало бы. Адреса из интернета правило не пропускает.
 *
 * Чистые функции (сборка аргументов netsh, сценарии PowerShell, разбор вывода) не зависят от Electron
 * и проверяются обычным node.
 */
import { execFile } from 'node:child_process'

export const LAN_FIREWALL_RULE = 'LAZEYKA LAN'

/** Частные диапазоны адресов, которым разрешено подключаться (в том числе сеть хот-спота 192.168.137.0/24). */
export const LAN_REMOTE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] as const

function checkPorts(ports: number[]): number[] {
  const list = [...new Set(ports)]
  if (!list.length) throw new Error('Не заданы порты.')
  for (const p of list) if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Неверный порт: ${p}`)
  return list
}

/** Аргументы netsh для удаления правила. Удаляет ВСЕ правила с этим именем — так не остаётся дубликатов. */
export function firewallDeleteArgs(name = LAN_FIREWALL_RULE): string[] {
  return ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`]
}

/** Аргументы netsh для добавления правила: входящие TCP на порты, все профили, только локальные адреса. */
export function firewallAddArgs(ports: number[], name = LAN_FIREWALL_RULE): string[] {
  const list = checkPorts(ports)
  return [
    'advfirewall', 'firewall', 'add', 'rule',
    `name=${name}`,
    'dir=in',
    'action=allow',
    'protocol=TCP',
    `localport=${list.join(',')}`,
    `remoteip=${LAN_REMOTE_RANGES.join(',')}`,
    'profile=any',
    'enable=yes'
  ]
}

// ---- Запрещающие правила для самой программы -----------------------------------------------
//
// Когда программа впервые начинает слушать порт, Windows спрашивает «Разрешить доступ?». Если отметить только
// «Частные сети», Windows добавляет для программы разрешающее правило для частных сетей и ЗАПРЕЩАЮЩЕЕ для
// общедоступных. Запрет в брандмауэре Windows сильнее любого разрешения, поэтому даже наше правило по портам
// не поможет в общедоступной сети (а сеть хот-спота обычно такая). Такие правила находим и по кнопке отключаем.

const FW_SENTINEL = 'LZFW:'

export interface FirewallBlocker {
  /** Внутреннее имя правила (Name) — по нему отключаем. */
  id: string
  /** Имя, как в «Брандмауэре Защитника Windows». */
  name: string
  /** Профили, в которых правило действует: «все», «частная», «общедоступная», «домен». */
  profiles: string
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const psStr = (s: string): string => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(s)}'))`

/** Профили брандмауэра из числа NetFirewallRule.Profile (флаги: 1 — домен, 2 — частная, 4 — общедоступная; 0 — все). */
export function profileNames(flags: number): string {
  if (!flags || (flags & 7) === 7) return 'все сети'
  const out: string[] = []
  if (flags & 2) out.push('частная')
  if (flags & 4) out.push('общедоступная')
  if (flags & 1) out.push('домен')
  return out.join(', ') || 'все сети'
}

/** Сценарий PowerShell: включённые входящие запрещающие правила для этого файла программы. */
export function buildBlockersScript(programPath: string): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$p = ${psStr(programPath)}
$out = @()
foreach ($f in @(Get-NetFirewallApplicationFilter)) {
  if (-not $f.Program) { continue }
  if ([Environment]::ExpandEnvironmentVariables([string]$f.Program) -ine $p) { continue }
  foreach ($r in @($f | Get-NetFirewallRule)) {
    if ([string]$r.Enabled -eq 'True' -and [string]$r.Direction -eq 'Inbound' -and [string]$r.Action -eq 'Block') {
      $out += [pscustomobject]@{ id = [string]$r.Name; name = [string]$r.DisplayName; profile = [int]$r.Profile }
    }
  }
}
Write-Output ('${FW_SENTINEL}' + (ConvertTo-Json -Compress -InputObject @($out)))
`
}

/** Разбор вывода buildBlockersScript. null — вывод не распознан. */
export function parseBlockers(stdout: string): FirewallBlocker[] | null {
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf(FW_SENTINEL)
    if (i < 0) continue
    try {
      const j = JSON.parse(line.slice(i + FW_SENTINEL.length).trim()) as unknown
      const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : []
      const seen = new Set<string>()
      const out: FirewallBlocker[] = []
      for (const x of arr as Record<string, unknown>[]) {
        const id = String(x?.id ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ id, name: String(x.name ?? '') || id, profiles: profileNames(Number(x.profile) || 0) })
      }
      return out
    } catch {
      return null
    }
  }
  return null
}

/** Разбор вывода buildDisableBlockersScript: сколько правил отключено. */
export function parseDisabledCount(stdout: string): number {
  const m = new RegExp(`${FW_SENTINEL}(\\d+)`).exec(stdout)
  return m ? Number(m[1]) : 0
}

/**
 * Сценарий PowerShell: отключить перечисленные правила, но только если это по-прежнему входящий запрет
 * для этой же программы (защита от подмены id). Правила не удаляются — их можно включить обратно в Windows.
 */
export function buildDisableBlockersScript(programPath: string, ids: string[]): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$p = ${psStr(programPath)}
$ids = (${psStr(ids.join('\n'))}) -split "\`n" | Where-Object { $_ }
$n = 0
foreach ($id in @($ids)) {
  $r = Get-NetFirewallRule -Name $id
  if (-not $r) { continue }
  if ([string]$r.Direction -ne 'Inbound' -or [string]$r.Action -ne 'Block') { continue }
  $f = $r | Get-NetFirewallApplicationFilter
  if ([Environment]::ExpandEnvironmentVariables([string]$f.Program) -ine $p) { continue }
  Disable-NetFirewallRule -Name $id
  if ($?) { $n++ }
}
Write-Output ('${FW_SENTINEL}' + $n)
`
}

// ---- Выполнение (только Windows) ----------------------------------------------------------------

export function runNetsh(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('netsh.exe', args, { windowsHide: true, timeout: 15_000 }, (e, stdout, stderr) =>
      e ? reject(new Error(String(stderr || stdout || e.message).trim())) : resolve()
    )
  })
}

function runPs(script: string, timeoutMs: number): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      (e, stdout) => (e && !String(stdout).includes(FW_SENTINEL) ? reject(new Error('Не удалось прочитать правила брандмауэра.')) : resolve(String(stdout)))
    )
  })
}

/** Найти запрещающие входящие правила для файла программы. */
export async function findProgramBlockers(programPath: string): Promise<FirewallBlocker[]> {
  const list = parseBlockers(await runPs(buildBlockersScript(programPath), 60_000))
  if (!list) throw new Error('Не удалось прочитать правила брандмауэра.')
  return list
}

/** Отключить запрещающие правила программы. Возвращает, сколько отключено. */
export async function disableProgramBlockers(programPath: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  return parseDisabledCount(await runPs(buildDisableBlockersScript(programPath, ids), 60_000))
}
