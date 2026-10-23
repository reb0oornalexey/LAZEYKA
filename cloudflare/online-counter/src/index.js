/**
 * LAZEYKA — счётчик «сейчас онлайн».
 *
 * Каждая запущенная копия LAZEYKA раз в 5 минут присылает POST /ping со
 * случайным анонимным ID (32 hex, создаётся при первом запуске). «Онлайн» —
 * сколько разных ID отметились за последние 7 минут.
 *
 * Никаких ключей в программе нет: это обычный публичный адрес. Хранится только
 * анонимный ID и время его последней отметки (SQLite Durable Object), записи
 * старше окна удаляются. IP не сохраняется: он живёт в памяти одно окно,
 * чтобы ограничить накрутку с одного адреса.
 *
 * Защита от накрутки:
 *  - ID только 32 hex-символа;
 *  - с одного IP за окно засчитывается не больше MAX_IDS_PER_IP разных ID
 *    (запас под провайдерский NAT, где за одним IP много людей);
 *  - не больше MAX_HITS_PER_IP запросов с одного IP за окно — остальные 429.
 *
 * Общая статистика (видна всем в программе): кроме «онлайн» хранится постоянная
 * таблица installs (анонимный ID, первая и последняя отметка) — из неё считаются
 * «всего установок» и «активны за 24 часа / 7 / 30 дней». Таблица не чистится.
 * Рекорд онлайна лежит в meta. Отдаётся в /ping и GET /stats.
 * Порядковый номер установки (num): присваивается при первой отметке нового ID.
 * Номер 1 принадлежит только владельцу (секрет OWNER_ID, см. README); остальные
 * получают 2, 3, … по порядку. ID наружу не отдаются — только номер вызывающего.
 * Даже если накрутить — это просто цифра на главной: доступа к аккаунту,
 * коду или данным через этот адрес нет.
 */
import { DurableObject } from 'cloudflare:workers'

const WINDOW_MS = 7 * 60 * 1000
const MAX_IDS_PER_IP = 25
const MAX_HITS_PER_IP = 60
const DAY_MS = 24 * 60 * 60 * 1000

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
    this.env = env
    // Отметки — во встроенной SQLite объекта: память Durable Object
    // очищается, когда он простаивает (десятки секунд без запросов), и
    // счётчик в памяти обнулялся бы.
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS seen_at ON seen (at)')
    // Постоянная таблица установок (не чистится) и служебные значения.
    this.sql.exec('CREATE TABLE IF NOT EXISTS installs (id TEXT PRIMARY KEY, first INTEGER NOT NULL, last INTEGER NOT NULL)')
    this.sql.exec('CREATE INDEX IF NOT EXISTS installs_last ON installs (last)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)')
    // Первый запуск после обновления Worker: переносим уже известные ID.
    const known = Number(this.sql.exec('SELECT COUNT(*) AS n FROM installs').one()?.n ?? 0)
    if (known === 0) this.sql.exec('INSERT OR IGNORE INTO installs (id, first, last) SELECT id, at, at FROM seen')
    // Порядковый номер установки. Колонку добавляем отдельно: таблица уже существует.
    try {
      this.sql.exec('ALTER TABLE installs ADD COLUMN num INTEGER')
    } catch {
      /* колонка уже есть */
    }
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS installs_num ON installs (num)')
    this.backfillNums()
    /** ip → { at, hits, ids:Set } — только в памяти, на одно окно (защита от накрутки). */
    this.byIp = new Map()
    this.lastPrune = 0
  }

  /** Владелец (секрет OWNER_ID, 32 hex в нижнем регистре) или '' если не задан. */
  ownerId() {
    const v = String(this.env?.OWNER_ID ?? '').trim().toLowerCase()
    return /^[0-9a-f]{32}$/.test(v) ? v : ''
  }

  /** Следующий свободный номер для обычного пользователя — никогда меньше 2. */
  nextNum() {
    const max = Number(this.sql.exec('SELECT MAX(num) AS m FROM installs').one()?.m ?? 0)
    return Math.max(2, max + 1)
  }

  oneIsFree() {
    return this.sql.exec('SELECT 1 FROM installs WHERE num = 1').toArray().length === 0
  }

  /** Номера тем, у кого их ещё нет, по порядку первой отметки. Единицу получает только владелец. */
  backfillNums() {
    const rows = this.sql.exec('SELECT id FROM installs WHERE num IS NULL ORDER BY first ASC, id ASC').toArray()
    if (rows.length === 0) return
    const owner = this.ownerId()
    this.ctx.storage.transactionSync(() => {
      for (const { id } of rows) {
        const num = id === owner && this.oneIsFree() ? 1 : this.nextNum()
        this.sql.exec('UPDATE installs SET num = ? WHERE id = ?', num, id)
      }
    })
  }

  /** Записать отметку установки и вернуть её номер. */
  touchInstall(id, now) {
    const row = this.sql.exec('SELECT num FROM installs WHERE id = ?', id).toArray()[0]
    const isOwner = id === this.ownerId()
    if (!row) {
      const num = isOwner && this.oneIsFree() ? 1 : this.nextNum()
      this.sql.exec('INSERT INTO installs (id, first, last, num) VALUES (?, ?, ?, ?)', id, now, now, num)
      return num
    }
    let num = row.num == null ? null : Number(row.num)
    // Владелец зарегистрировался до того, как задали секрет, — переезжает на 1, если она свободна.
    if (isOwner && num !== 1 && this.oneIsFree()) num = 1
    else if (num == null) num = this.nextNum()
    this.sql.exec('UPDATE installs SET last = ?, num = ? WHERE id = ?', now, num, id)
    return num
  }

  prune(now) {
    if (now - this.lastPrune < 60_000) return
    this.lastPrune = now
    this.sql.exec('DELETE FROM seen WHERE at < ?', now - WINDOW_MS)
    for (const [ip, r] of this.byIp) if (now - r.at > WINDOW_MS) this.byIp.delete(ip)
  }

  online(now) {
    const row = this.sql.exec('SELECT COUNT(*) AS n FROM seen WHERE at >= ?', now - WINDOW_MS).one()
    return Number(row?.n ?? 0)
  }

  peak(online) {
    const cur = Number(this.sql.exec("SELECT value AS v FROM meta WHERE key = 'peakOnline'").toArray()[0]?.v ?? 0)
    if (online > cur) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('peakOnline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", online)
      return online
    }
    return cur
  }

  count(since) {
    return Number(this.sql.exec('SELECT COUNT(*) AS n FROM installs WHERE last >= ?', since).one()?.n ?? 0)
  }

  /** Всё, что показывается в программе. Поле online оставлено для старых версий. */
  stats(now) {
    const online = this.online(now)
    return {
      online,
      installs: Number(this.sql.exec('SELECT COUNT(*) AS n FROM installs').one()?.n ?? 0),
      active24h: this.count(now - DAY_MS),
      active7d: this.count(now - 7 * DAY_MS),
      active30d: this.count(now - 30 * DAY_MS),
      peakOnline: this.peak(online)
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    const now = Date.now()
    this.prune(now)

    if (url.pathname === '/online' && request.method === 'GET') {
      return json({ online: this.online(now) })
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      return json(this.stats(now))
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
      let num = null
      r.hits++
      if (r.hits > MAX_HITS_PER_IP) return json(this.stats(now), 429)
      if (r.ids.has(id) || r.ids.size < MAX_IDS_PER_IP) {
        r.ids.add(id)
        this.sql.exec('INSERT INTO seen (id, at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at', id, now)
        num = this.touchInstall(id, now)
      }
      return json(num == null ? this.stats(now) : { ...this.stats(now), num })
    }

    return json({ error: 'not found' }, 404)
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(request.url)
    if (url.pathname === '/') {
      return new Response('LAZEYKA online counter. GET /online, GET /stats', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }
      })
    }
    if (url.pathname !== '/ping' && url.pathname !== '/online' && url.pathname !== '/stats') return json({ error: 'not found' }, 404)
    // Один глобальный счётчик на всех.
    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'))
    return stub.fetch(request)
  }
}
