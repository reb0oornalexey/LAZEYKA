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
 *
 * Расход строк SQLite (бесплатный план: 5 млн прочитанных и 100 000 записанных в сутки).
 * Раньше каждый /ping считал «всего установок» и «активны за 24 часа / 7 / 30 дней» по всей
 * таблице installs (~500 прочитанных строк на запрос). Теперь:
 *  - «всего установок» — счётчик в meta (installsTotal), растёт при первой отметке нового ID;
 *  - «активны за …» — один проход по индексу installs_last раз в STATS_TTL_MS, результат
 *    лежит в памяти объекта и в таблице cache (переживает выгрузку объекта из памяти);
 *  - «онлайн» и рекорд — пересчёт не чаще раза в ONLINE_TTL_MS, между ними — из памяти;
 *  - installs.last обновляется, только если сдвинулся на LAST_STEP_MS и больше (меньше записей;
 *    окна в 24 часа и больше от этого почти не меняются).
 */
import { DurableObject } from 'cloudflare:workers'

const WINDOW_MS = 7 * 60 * 1000
const MAX_IDS_PER_IP = 25
const MAX_HITS_PER_IP = 60
const DAY_MS = 24 * 60 * 60 * 1000
/** Как долго «активны за 24 часа / 7 / 30 дней» берутся из кэша. */
const STATS_TTL_MS = 10 * 60 * 1000
/** Как долго «онлайн» берётся из памяти. */
const ONLINE_TTL_MS = 60 * 1000
/** installs.last переписывается, только если отметка сдвинулась хотя бы на столько. */
const LAST_STEP_MS = 15 * 60 * 1000

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
    // Кэш посчитанной статистики (JSON), чтобы после выгрузки объекта не считать заново.
    this.sql.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)')
    // Первый запуск после обновления Worker: переносим уже известные ID.
    // Проверка «таблица пуста» — одна строка, а не COUNT(*) по всей таблице на каждом запуске объекта.
    if (this.sql.exec('SELECT 1 FROM installs LIMIT 1').toArray().length === 0) {
      this.sql.exec('INSERT OR IGNORE INTO installs (id, first, last) SELECT id, at, at FROM seen')
      this.sql.exec("DELETE FROM meta WHERE key = 'installsTotal'")
    }
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
    /** Кэш в памяти экземпляра (живёт между запросами, пока объект не выгружен). */
    this.mem = { total: null, peak: null, online: null, active: null }
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
    const row = this.sql.exec('SELECT num, last FROM installs WHERE id = ?', id).toArray()[0]
    const isOwner = id === this.ownerId()
    if (!row) {
      const num = isOwner && this.oneIsFree() ? 1 : this.nextNum()
      const total = this.installsTotal()
      this.bumpActive(null, now)
      this.sql.exec('INSERT INTO installs (id, first, last, num) VALUES (?, ?, ?, ?)', id, now, now, num)
      this.sql.exec("UPDATE meta SET value = value + 1 WHERE key = 'installsTotal'")
      this.mem.total = total + 1
      return num
    }
    this.bumpActive(Number(row.last), now)
    const had = row.num == null ? null : Number(row.num)
    let num = had
    // Владелец зарегистрировался до того, как задали секрет, — переезжает на 1, если она свободна.
    if (isOwner && num !== 1 && this.oneIsFree()) num = 1
    else if (num == null) num = this.nextNum()
    if (num !== had) this.sql.exec('UPDATE installs SET last = ?, num = ? WHERE id = ?', now, num, id)
    else if (now - Number(row.last) >= LAST_STEP_MS) this.sql.exec('UPDATE installs SET last = ? WHERE id = ?', now, id)
    return num
  }

  /** Всего установок: счётчик в meta; COUNT(*) — только один раз, если счётчика ещё нет. */
  installsTotal() {
    if (this.mem.total !== null) return this.mem.total
    let v = this.sql.exec("SELECT value FROM meta WHERE key = 'installsTotal'").toArray()[0]?.value
    if (v === undefined || v === null) {
      v = Number(this.sql.exec('SELECT COUNT(*) AS n FROM installs').one()?.n ?? 0)
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('installsTotal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", v)
    }
    this.mem.total = Number(v)
    return this.mem.total
  }

  /**
   * Между пересчётами кэш «активны за …» досчитывается сразу: установка, которой в окне не было
   * (новая — prevLast = null), добавляется. Выбывшие из окна убираются при следующем пересчёте.
   */
  bumpActive(prevLast, now) {
    const a = this.mem.active
    if (!a) return
    const out = (w) => prevLast === null || !Number.isFinite(prevLast) || prevLast < now - w
    if (out(DAY_MS)) a.d1++
    if (out(7 * DAY_MS)) a.d7++
    if (out(30 * DAY_MS)) a.d30++
  }

  /** «Активны за 24 часа / 7 / 30 дней»: один проход по индексу installs_last, кэш STATS_TTL_MS. */
  active(now) {
    const fresh = (c) => c && now - c.at < STATS_TTL_MS && c.at <= now
    if (fresh(this.mem.active)) return this.mem.active
    if (!this.mem.active) {
      const row = this.sql.exec("SELECT v, at FROM cache WHERE k = 'active'").toArray()[0]
      if (row) {
        try {
          const c = { ...JSON.parse(row.v), at: Number(row.at) }
          this.mem.active = c
          if (fresh(c)) return c
        } catch {
          /* повреждённый кэш — посчитаем заново */
        }
      }
    }
    const r = this.sql
      .exec('SELECT COUNT(*) AS d30, SUM(last >= ?) AS d7, SUM(last >= ?) AS d1 FROM installs WHERE last >= ?', now - 7 * DAY_MS, now - DAY_MS, now - 30 * DAY_MS)
      .one()
    const c = { d1: Number(r?.d1 ?? 0), d7: Number(r?.d7 ?? 0), d30: Number(r?.d30 ?? 0), at: now }
    this.sql.exec(
      "INSERT INTO cache (k, v, at) VALUES ('active', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at",
      JSON.stringify({ d1: c.d1, d7: c.d7, d30: c.d30 }),
      now
    )
    this.mem.active = c
    return c
  }

  prune(now) {
    if (now - this.lastPrune < 60_000) return
    this.lastPrune = now
    this.sql.exec('DELETE FROM seen WHERE at < ?', now - WINDOW_MS)
    for (const [ip, r] of this.byIp) if (now - r.at > WINDOW_MS) this.byIp.delete(ip)
  }

  /** Онлайн (по индексу seen_at; в seen только отметки за окно) — не чаще раза в ONLINE_TTL_MS. */
  online(now) {
    const c = this.mem.online
    if (c && now - c.at < ONLINE_TTL_MS && c.at <= now) return c.n
    const row = this.sql.exec('SELECT COUNT(*) AS n FROM seen WHERE at >= ?', now - WINDOW_MS).one()
    const n = Number(row?.n ?? 0)
    this.mem.online = { n, at: now }
    this.peak(n)
    return n
  }

  /** Рекорд онлайна: из meta один раз, дальше из памяти; запись — только при новом рекорде. */
  peak(online) {
    if (this.mem.peak === null) this.mem.peak = Number(this.sql.exec("SELECT value AS v FROM meta WHERE key = 'peakOnline'").toArray()[0]?.v ?? 0)
    if (online > this.mem.peak) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('peakOnline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", online)
      this.mem.peak = online
    }
    return this.mem.peak
  }

  /** Всё, что показывается в программе. Поле online оставлено для старых версий. */
  stats(now) {
    const online = this.online(now)
    const a = this.active(now)
    return {
      online,
      installs: this.installsTotal(),
      active24h: a.d1,
      active7d: a.d7,
      active30d: a.d30,
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
        // Новая в окне установка сразу прибавляется к онлайну из памяти (выбывшие — при пересчёте).
        const prev = this.sql.exec('SELECT at FROM seen WHERE id = ?', id).toArray()[0]
        this.sql.exec('INSERT INTO seen (id, at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at', id, now)
        if (this.mem.online && (!prev || Number(prev.at) < now - WINDOW_MS)) {
          this.mem.online.n++
          this.peak(this.mem.online.n)
        }
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
    // Хранилище Cloudflare иногда перезапускается (обновление, перенос) — тогда запрос падает с
    // временной ошибкой, и в статистике это «ошибка в коде». Повторяем один раз с новым обращением,
    // а если не вышло — отвечаем спокойным 503, программа просто спросит позже.
    const id = env.COUNTER.idFromName('global')
    const retry = request.clone()
    try {
      return await env.COUNTER.get(id).fetch(request)
    } catch (e) {
      if (e && e.retryable && !e.overloaded) {
        try {
          return await env.COUNTER.get(id).fetch(retry)
        } catch {
          /* ниже — 503 */
        }
      }
      return json({ error: 'busy' }, 503)
    }
  }
}
