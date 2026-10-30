import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { dataDir } from '../utils/dirs'
import type { DohProvider } from './dns-doh'

/**
 * macOS: настоящий шифрованный DNS (DoH) без подписанного приложения ставится
 * только профилем конфигурации (`com.apple.dnsSettings.managed`). LAZEYKA
 * генерирует профиль под выбранного провайдера и открывает его — macOS
 * показывает «Профиль загружен», пользователь подтверждает установку в
 * «Системных настройках», и DNS появляется в «Сеть → VPN и фильтры».
 * Сам профиль ставит и удаляет только пользователь — молча это сделать нельзя.
 */

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Стабильный UUID из строки: повторная установка того же провайдера заменяет профиль, а не плодит копии. */
function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase()
}

export function buildDohProfile(p: DohProvider): string {
  if (!p.url) throw new Error('У этого DNS нет адреса DoH — профиль не нужен')
  const slug = p.id.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'custom'
  const addrs = [p.ip, p.secondaryIp, ...(p.ipv6 ?? [])].filter((a): a is string => !!a)
  const title = `${p.name} (DoH) — LAZEYKA`
  const addrXml = addrs.length
    ? `
        <key>ServerAddresses</key>
        <array>
${addrs.map((a) => `          <string>${xml(a)}</string>`).join('\n')}
        </array>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key>
        <string>HTTPS</string>
        <key>ServerURL</key>
        <string>${xml(p.url)}</string>${addrXml}
      </dict>
      <key>PayloadDisplayName</key>
      <string>${xml(title)}</string>
      <key>PayloadIdentifier</key>
      <string>io.github.reb0oornalexey.lazeyka.dns.${slug}.settings</string>
      <key>PayloadType</key>
      <string>com.apple.dnsSettings.managed</string>
      <key>PayloadUUID</key>
      <string>${stableUuid(`dns-settings:${slug}`)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>ProhibitDisablement</key>
      <false/>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>${xml(`Шифрованный DNS ${p.name} через HTTPS. Создан LAZEYKA; удалить — «Системные настройки» → «Основные» → «Управление устройством».`)}</string>
  <key>PayloadDisplayName</key>
  <string>${xml(title)}</string>
  <key>PayloadIdentifier</key>
  <string>io.github.reb0oornalexey.lazeyka.dns.${slug}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <!-- Настройки DNS бывают только системными: без System macOS ставит профиль
       в область пользователя и отвечает «Ошибка установки». -->
  <key>PayloadScope</key>
  <string>System</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${stableUuid(`dns-profile:${slug}`)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`
}

/** Сохранить профиль и открыть его — macOS сама предложит установку. */
export async function openMacDohProfile(p: DohProvider): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'darwin') return { success: false, message: 'Профили DNS есть только на macOS' }
  try {
    const dir = path.join(dataDir(), 'dns-profiles')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `LAZEYKA-DNS-${p.id.replace(/[^a-z0-9-]/gi, '') || 'custom'}.mobileconfig`)
    writeFileSync(file, buildDohProfile(p), 'utf-8')
    const err = await shell.openPath(file)
    if (err) return { success: false, message: `Не удалось открыть профиль: ${err}` }
    return {
      success: true,
      message:
        'Профиль загружен. Откройте «Системные настройки» → «Основные» → «Управление устройством» (или «Профили»), ' +
        'дважды щёлкните профиль LAZEYKA и нажмите «Установить». Затем в «Сеть» → «VPN и фильтры» выберите у него «Включено».'
    }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) }
  }
}
