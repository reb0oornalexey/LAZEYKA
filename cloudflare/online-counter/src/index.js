/**
 * LAZEYKA — счётчик «сейчас онлайн».
 *
 * Каждая запущенная копия LAZEYKA раз в 5 минут присылает POST /ping со
 * случайным анонимным ID (32 hex, создаётся при первом запуске). «Онлайн» —
 * сколько разных ID отметились за последние 7 минут.
 *
 * Никаких ключей в программе нет: это обычный публичный адрес. Хранится только
 * время последней отметки каждого ID — в памяти одного Durable Object, без
 * записи на диск. IP не сохраняется: он нужен только на минуту, чтобы
 * ограничить накрутку с одного адреса.
 *
 * Защита от накрутки:
 *  - ID только 32 hex-символа;
 *  - с одного IP за окно засчитывается не больше MAX_IDS_PER_IP разных ID
 *    (запас под провайдерский NAT, где за одним IP много людей);
 *  - не больше MAX_HITS_PER_IP запросов с одного IP за окно — остальные 429.
 * Даже если накрутить — это просто цифра на главной: доступа к аккаунту,
 * коду или данным через этот адрес нет.
 */
import { DurableObject } from 'cloudflare:workers'

const WINDOW_MS = 7 * 60 * 1000
const MAX_IDS_PER_IP = 25
const MAX_HITS_PER_IP = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  })
}

export class OnlineCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    /** id → время последней отметки */
    this.seen = new Map()
    /** ip → { at, hits, ids:Set } — только в памяти, на одно окно */
    this.byIp = new Map()
    this.lastPrune = 0
  }

  prune(now) {
    if (now - this.lastPrune < 30_000) return
    this.lastPrune = now
    for (const [id, t] of this.seen) if (now - t > WINDOW_MS) this.seen.delete(id)
    for (const [ip, r] of this.byIp) if (now - r.at > WINDOW_MS) this.byIp.delete(ip)
  }

  online() {
    return this.seen.size
  }

  async fetch(request) {
    const url = new URL(request.url)
    const now = Date.now()
    this.prune(now)

    if (url.pathname === '/online' && request.method === 'GET') {
      return json({ online: this.online() })
    }

    if (url.pathname === '/ping' && request.method === 'POST') {
      let body = null
      try {
        body = await request.json()
      } catch {
        return json({ error: 'bad request' }, 400)
      }
      const id = String(body?.id ?? '').toLowerCase()
      if (!/^[0-9a-f]{32}$/.test(id)) return json({ error: 'bad id' }, 400)

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
      let r = this.byIp.get(ip)
      if (!r || now - r.at > WINDOW_MS) {
        r = { at: now, hits: 0, ids: new Set() }
        this.byIp.set(ip, r)
      }
      r.hits++
      if (r.hits > MAX_HITS_PER_IP) return json({ online: this.online() }, 429)
      if (r.ids.has(id) || r.ids.size < MAX_IDS_PER_IP) {
        r.ids.add(id)
        this.seen.set(id, now)
      }
      return json({ online: this.online() })
    }

    return json({ error: 'not found' }, 404)
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(request.url)
    if (url.pathname === '/') {
      return new Response('LAZEYKA online counter. GET /online', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }
      })
    }
    if (url.pathname !== '/ping' && url.pathname !== '/online') return json({ error: 'not found' }, 404)
    // Один глобальный счётчик на всех.
    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'))
    return stub.fetch(request)
  }
}
