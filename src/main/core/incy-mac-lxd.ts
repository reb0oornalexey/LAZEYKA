/**
 * Низкоуровневые куски для работы с демоном `sing-box lxd` на macOS.
 * Здесь НЕТ зависимостей от Electron, чтобы код можно было прогнать отдельным
 * скриптом: самоподписанный клиентский сертификат, mTLS-запрос с пином
 * сертификата сервера, экранирование для osascript и скрипты DNS-хуков.
 *
 * Протокол взят из документации lxd (docs-lx/lxd-daemon.md, §9.1):
 *  - приглашение — `адрес#отпечаток#код`;
 *  - отпечаток — SHA-256 DER-сертификата сервера (lowercase hex): клиент
 *    сверяет им сервер вместо проверки цепочки;
 *  - `POST /admin/enroll` без заголовков авторизации, тело
 *    `{code, name, cert_pem}`; дальше всё по mTLS с этим сертификатом.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'

// ---- X.509 ------------------------------------------------------------------

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body])
}

function derOid(oid: string): Buffer {
  const nums = oid.split('.').map(Number)
  const out: number[] = [nums[0] * 40 + nums[1]]
  for (const n of nums.slice(2)) {
    const chunk: number[] = [n & 0x7f]
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80)
    out.push(...chunk)
  }
  return der(0x06, Buffer.from(out))
}

function derInteger(raw: Buffer): Buffer {
  let b = raw
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1)
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b])
  return der(0x02, b)
}

function derUtcTime(d: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0')
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  return der(0x17, Buffer.from(s, 'ascii'))
}

function pem(label: string, derBytes: Buffer): string {
  const b64 = derBytes.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}

export interface ClientIdentity {
  /** Сертификат, PEM. */
  cert: string
  /** Закрытый ключ PKCS#8, PEM. */
  key: string
}

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2'

/**
 * Самоподписанный сертификат клиента: ECDSA P-256 на 10 лет, EKU clientAuth —
 * ровно то, что делает пример из документации через `openssl req -x509`.
 * Демон пинит отпечаток и цепочку не проверяет, поэтому самоподписанного
 * достаточно. node:crypto не умеет собирать X.509, поэтому DER собираем сами
 * (около 40 строк) — зависимость вроде node-forge ради этого не нужна.
 */
export function makeClientIdentity(commonName = 'LAZEYKA'): ClientIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const name = der(0x30, der(0x31, der(0x30, derOid('2.5.4.3'), der(0x0c, Buffer.from(commonName, 'utf8')))))
  const sigAlg = der(0x30, derOid(OID_ECDSA_SHA256))
  const serial = randomBytes(16)
  serial[0] &= 0x7f
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000)
  const notAfter = new Date(Date.now() + 3650 * 24 * 3600 * 1000)
  const extensions = der(
    0xa3,
    der(
      0x30,
      // extendedKeyUsage: clientAuth
      der(0x30, derOid('2.5.29.37'), der(0x04, der(0x30, derOid('1.3.6.1.5.5.7.3.2')))),
      // keyUsage: digitalSignature
      der(0x30, derOid('2.5.29.15'), der(0x01, Buffer.from([0xff])), der(0x04, der(0x03, Buffer.from([0x07, 0x80]))))
    )
  )
  const tbs = der(
    0x30,
    der(0xa0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    sigAlg,
    name,
    der(0x30, derUtcTime(notBefore), derUtcTime(notAfter)),
    name,
    spki,
    extensions
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const cert = der(0x30, tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), signature])))
  return {
    cert: pem('CERTIFICATE', cert),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  }
}

/** Одним файлом: сертификат, затем ключ (как хранит Tunor). */
export function serializeIdentity(id: ClientIdentity): string {
  return id.cert.trimEnd() + '\n' + id.key.trimEnd() + '\n'
}

export function parseIdentity(text: string): ClientIdentity | null {
  const cert = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(text)?.[0]
  const key = /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:EC |RSA )?PRIVATE KEY-----/.exec(text)?.[0]
  if (!cert || !key) return null
  return { cert: cert + '\n', key: key + '\n' }
}

// ---- mTLS-запрос с пином ------------------------------------------------------

export interface InviteParts {
  address: string
  fingerprint: string
  code: string
}

/** `адрес#отпечаток#код`. Код в логи не пишем. */
export function parseInvite(text: string): InviteParts | null {
  const parts = text.trim().split('#')
  if (parts.length !== 3) return null
  const [address, fingerprint, code] = parts.map((p) => p.trim())
  if (!address || !fingerprint || !code) return null
  return { address, fingerprint: normalizeFingerprint(fingerprint), code }
}

export function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toLowerCase()
}

export function splitAddress(address: string): { host: string; port: number } {
  const i = address.lastIndexOf(':')
  if (i < 0) throw new Error(`адрес службы без порта: ${address}`)
  const host = address.slice(0, i).replace(/^\[|\]$/g, '')
  const port = Number(address.slice(i + 1))
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`непонятный адрес службы: ${address}`)
  }
  return { host, port }
}

export interface PinnedTarget {
  address: string
  fingerprint: string
  identity?: ClientIdentity
}

export interface PinnedResponse {
  status: number
  body: string
}

/**
 * Одно соединение — один запрос. TLS поднимаем сами и до отправки любого байта
 * сверяем SHA-256 сертификата сервера с пином: Node не зовёт
 * checkServerIdentity, когда цепочка не прошла проверку (а у самоподписанного
 * сертификата она не проходит), поэтому штатный хук тут не годится. HTTP/1.1
 * (ALPN не предлагает h2) — REST демона отвечает так же, как curl из доков.
 */
export function pinnedRequest(
  target: PinnedTarget,
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  body?: string,
  timeoutMs = 15000
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const { host, port } = splitAddress(target.address)
    const pin = normalizeFingerprint(target.fingerprint)
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      ALPNProtocols: ['http/1.1'],
      ...(target.identity ? { cert: target.identity.cert, key: target.identity.key } : {})
    })
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    }
    const timer = setTimeout(() => fail(new Error('служба не ответила вовремя')), timeoutMs)
    socket.on('error', fail)
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate(true)?.raw
      const actual = raw ? createHash('sha256').update(raw).digest('hex') : ''
      if (actual !== pin) {
        fail(new Error('отпечаток сертификата службы не совпал с сохранённым'))
        return
      }
      const payload = body === undefined ? undefined : Buffer.from(body, 'utf8')
      const req = http.request({
        method,
        path: `/admin/${route}`,
        // Без agent: при заданном createConnection Node берёт готовый сокет как есть
        // (с `agent: false` он создал бы свой агент и пошёл на localhost:80).
        createConnection: () => socket,
        headers: {
          Host: target.address,
          Connection: 'close',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
        }
      })
      req.on('error', fail)
      req.on('response', (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', fail)
      })
      req.end(payload)
    })
  })
}

/** `{"error": "..."}` → текст ошибки; иначе — сырой ответ. */
export function daemonError(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
  } catch {
    /* не JSON */
  }
  const text = body.trim()
  return text ? text.slice(0, 300) : fallback
}

// ---- Экранирование для osascript ---------------------------------------------

/** Аргумент для /bin/sh: в одинарных кавычках, внутренняя `'` → `'\''`. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Строковый литерал AppleScript: экранируются только `\` и `"`. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Скрипт для `osascript -e`: выполнить команду оболочки с правами администратора. */
export function buildAdminScript(shellCommand: string): string {
  return `do shell script ${appleScriptString(shellCommand)} with administrator privileges`
}

/** osascript отдаёт -128 / «User canceled», когда пользователь закрыл окно пароля. */
export function isOsascriptCancel(stderr: string): boolean {
  return /\(-128\)|User canceled/i.test(stderr)
}

const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g')

/** Убрать цветовые коды терминала из вывода ядра. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** Текст ошибки без служебной обёртки osascript и цветовых кодов ядра. */
export function readableOsascriptError(raw: string): string {
  let text = stripAnsi(raw)
  const at = text.indexOf('execution error:')
  if (at >= 0) text = text.slice(at + 'execution error:'.length)
  text = text.replace(/^\s*(FATAL|ERROR)\s*\[[^\]]*\]\s*/gm, '')
  return text.replace(/\s+/g, ' ').trim()
}

// ---- DNS-хуки (lxd hooks, §6a документации) ------------------------------------

/**
 * pre_start: не поднимать ядро при загрузке системы (и при перезапуске службы
 * launchd). Мост Xray и вотчеры живут в LAZEYKA — без неё ядро с TUN, поднятое
 * демоном по `was_running`, стало бы чёрной дырой для всего трафика. Ядро
 * запускает только LAZEYKA (apply/start), загрузка — fail-closed, демон при
 * этом остаётся на связи.
 */
export const HOOK_PRE_START = `#!/bin/sh
[ "$LXD_REASON" = "boot" ] && { echo "LAZEYKA: ядро запускает только приложение"; exit 1; }
exit 0
`


/**
 * Ядро с TUN не трогает системный DNS: на macOS резолвер остаётся у
 * провайдера. Поэтому демон зовёт скрипты хуков, а они переключают DNS ВСЕХ
 * включённых сетевых служб на адрес TUN и возвращают обратно. Версия из доков
 * умеет только Wi-Fi, здесь обходятся все службы.
 *
 * post_stop идемпотентен и ничего не предполагает про post_start: читает
 * только снимок `dns.snapshot` в каталоге хуков.
 */
export const HOOK_POST_START = `#!/bin/sh
# LAZEYKA: после старта ядра направить DNS всех включённых сетевых служб на TUN.
NS=/usr/sbin/networksetup
SNAP="$LXD_HOOK_DIR/dns.snapshot"
case "$LXD_TUN_AUTO_ROUTE" in 1*) ;; *) exit 0 ;; esac
DNS=$(printf '%s' "$LXD_TUN_ADDRESS" | /usr/bin/cut -d, -f1 | /usr/bin/cut -d/ -f1)
[ -n "$DNS" ] || exit 0
SERVICES=$("$NS" -listallnetworkservices 2>/dev/null | /usr/bin/tail -n +2)
if [ ! -f "$SNAP" ]; then
  : > "$SNAP.tmp"
  printf '%s\\n' "$SERVICES" | while IFS= read -r svc; do
    case "$svc" in ''|'*'*) continue ;; esac
    cur=$("$NS" -getdnsservers "$svc" 2>/dev/null | /usr/bin/tr '\\n' ' ')
    case "$cur" in *"aren't any"*) cur=empty ;; esac
    [ "$cur" = "$DNS " ] && cur=empty
    printf '%s\\t%s\\n' "$svc" "$cur" >> "$SNAP.tmp"
  done
  /bin/mv "$SNAP.tmp" "$SNAP"
fi
printf '%s\\n' "$SERVICES" | while IFS= read -r svc; do
  case "$svc" in ''|'*'*) continue ;; esac
  "$NS" -setdnsservers "$svc" "$DNS"
done
/usr/bin/dscacheutil -flushcache
/usr/bin/killall -HUP mDNSResponder 2>/dev/null
exit 0
`

export const HOOK_POST_STOP = `#!/bin/sh
# LAZEYKA: вернуть DNS из снимка. Идемпотентно: нет снимка — нечего возвращать.
NS=/usr/sbin/networksetup
SNAP="$LXD_HOOK_DIR/dns.snapshot"
[ -f "$SNAP" ] || exit 0
TAB=$(printf '\\t')
while IFS="$TAB" read -r svc cur; do
  [ -n "$svc" ] || continue
  if [ -z "$cur" ] || [ "$cur" = "empty" ]; then
    "$NS" -setdnsservers "$svc" empty
  else
    "$NS" -setdnsservers "$svc" $cur
  fi
done < "$SNAP"
/bin/rm -f "$SNAP"
/usr/bin/dscacheutil -flushcache
/usr/bin/killall -HUP mDNSResponder 2>/dev/null
exit 0
`
