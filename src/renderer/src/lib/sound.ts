/**
 * Звуки программы. Три вида: синтезированные через Web Audio (без файлов),
 * звуки из файлов в сборке (lib/sound-files.ts) и свои файлы пользователя
 * (папка данных → sounds/, src/main/core/custom-sounds.ts).
 * Три категории — у каждой свой звук и своя громкость, плюс общая громкость и
 * «Без звука» (Настройки → Звуки):
 *  - «Действия» — сценарии и горячие клавиши;
 *  - «Сообщения» — центр уведомлений: ответы автора, решения по темам, объявления;
 *  - «Сигналы» — сигнал о лагах во время игры («Перед каткой»).
 * У синтезированных звуков два варианта: удачно и ошибка. У файловых своего
 * варианта «ошибка» нет — см. fileSound().
 */
import { BUNDLED_FILE_SOUNDS } from './sound-files'
import { customSoundsList, customSoundsPick, customSoundsRead, customSoundsRemove } from '@renderer/utils/custom-sounds-api'

type Ctx = BaseAudioContext
let ctx: AudioContext | null = null

// ───────── Категории ─────────

export type SoundCategory = 'actions' | 'messages' | 'alerts'
/** Прежнее имя типа: места вызова передают категорию. */
export type SoundGroup = SoundCategory

export const SOUND_CATEGORIES: { id: SoundCategory; title: string; when: string }[] = [
  { id: 'actions', title: 'Действия', when: 'Сценарий применился или сработала горячая клавиша' },
  { id: 'messages', title: 'Сообщения', when: 'Ответ автора, решение по теме, объявление' },
  { id: 'alerts', title: 'Сигналы', when: 'Во время игры вырос пинг или пошли потери («Перед каткой»)' }
]

// ───────── Громкость ─────────
// Значения в процентах, 100 — как было раньше. Хранятся в localStorage главного
// окна: звук играет только оно.

export interface SoundVolume {
  /** Общая громкость, 0–200. */
  master: number
  /** Сценарии и горячие клавиши, 0–100. */
  actions: number
  /** Центр уведомлений, 0–100. */
  messages: number
  /** Сигнал о лагах, 0–100. */
  alerts: number
  muted: boolean
}

export const SOUND_MASTER_MAX = 200
const VOLUME_KEY = 'lazeyka.sound.volume'
const CHOICE_KEY = 'lazeyka.sound.choice'
const DEFAULT_VOLUME: SoundVolume = { master: 100, actions: 100, messages: 100, alerts: 100, muted: false }

const clampPct = (v: unknown, max: number, def: number): number => {
  if (v === undefined || v === null || v === '') return def
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : def
}

/**
 * Разбор сохранённой громкости. Старый формат ({ master, actions, alerts, muted })
 * читается как есть: «Сообщения» раньше звучали в группе alerts, поэтому берут её
 * значение, пока у них нет своего.
 */
export function parseVolume(raw: unknown): SoundVolume {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VOLUME }
  const r = raw as Partial<Record<keyof SoundVolume, unknown>>
  const alerts = clampPct(r.alerts, 100, 100)
  return {
    master: clampPct(r.master, SOUND_MASTER_MAX, 100),
    actions: clampPct(r.actions, 100, 100),
    messages: clampPct(r.messages, 100, alerts),
    alerts,
    muted: r.muted === true
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* хранилище недоступно — значение действует до перезапуска */
  }
}

let volume: SoundVolume = parseVolume(readJson(VOLUME_KEY))

export function getSoundVolume(): SoundVolume {
  return { ...volume }
}

export function setSoundVolume(patch: Partial<SoundVolume>): SoundVolume {
  volume = parseVolume({ ...volume, ...patch })
  writeJson(VOLUME_KEY, volume)
  // Карточка «Звуки» и пульт перерисуются (горячая клавиша «Без звука» меняет это из main).
  changed()
  return { ...volume }
}

/** Множитель громкости категории: 0 — тишина, 1 — как раньше, до 2 — громче. */
export function categoryGain(v: SoundVolume, cat: SoundCategory): number {
  if (v.muted) return 0
  return (v.master / 100) * (v[cat] / 100)
}

// ───────── Выход ─────────
// Все звуки идут через ограничитель, чтобы на 200% не было хрипа. Громкость
// задаётся отдельным узлом на каждое проигрывание: 3-секундный звук «Сообщений»
// не меняет громкость звука «Действий», запущенного поверх.

const limiters = new WeakMap<Ctx, AudioNode>()
function limiter(c: Ctx): AudioNode {
  const have = limiters.get(c)
  if (have) return have
  const l = c.createDynamicsCompressor()
  l.threshold.value = -6
  l.knee.value = 6
  l.ratio.value = 12
  l.attack.value = 0.002
  l.release.value = 0.1
  l.connect(c.destination)
  limiters.set(c, l)
  return l
}

function voice(c: Ctx, gain: number): GainNode {
  const g = c.createGain()
  g.gain.value = gain
  g.connect(limiter(c))
  // Узел отключаем, когда самый длинный звук (свой файл до 5 с) точно закончился.
  setTimeout(() => {
    try {
      g.disconnect()
    } catch {
      /* уже отключён */
    }
  }, 7000)
  return g
}

// ───────── Синтез ─────────
// У каждого тона огибающая: подъём 12 мс и экспоненциальное затухание до
// −80 дБ — без щелчков на старте и в конце.

type Wave = OscillatorType

function tone(c: Ctx, dst: AudioNode, freq: number, start: number, dur: number, vol = 0.07, type: Wave = 'sine', slideTo?: number, attack = 0.012): void {
  const o = c.createOscillator()
  const g = c.createGain()
  const t0 = c.currentTime + start
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(dst)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

/** Тон с обертонами: [множитель частоты, громкость, доля длительности]. */
function partials(c: Ctx, dst: AudioNode, f: number, start: number, dur: number, vol: number, list: [number, number, number][], type: Wave = 'sine'): void {
  for (const [r, a, d] of list) tone(c, dst, f * r, start, dur * d, vol * a, type)
}

/** Короткий щелчок шума (без огибающей подъёма — это и есть щелчок). */
function noise(c: Ctx, dst: AudioNode, start: number, dur: number, vol = 0.05, hp = 2000): void {
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = c.createGain()
  g.gain.value = vol
  src.connect(f).connect(g).connect(dst)
  src.start(c.currentTime + start)
}

/** Шум через фильтр с плавным подъёмом и затуханием (ветер, шёпот). */
function air(c: Ctx, dst: AudioNode, start: number, dur: number, vol: number, f1: number, f2: number, q = 1.2, attack = 0.08, type: BiquadFilterType = 'bandpass'): void {
  const len = Math.max(1, Math.floor(c.sampleRate * (dur + 0.05)))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  const t0 = c.currentTime + start
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(f1, t0)
  f.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(dst)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

// ───────── Звуки из файлов ─────────
// Файл декодируется один раз (загрузка → decodeAudioData), AudioBuffer кэшируется.
// Файлы записаны намного громче синтеза (пик 0,35–0,5 против ~0,07), поэтому
// каждому считается нормирующий множитель — см. normalizeGain().

interface FileEntry {
  buffer?: AudioBuffer
  gain?: number
  pending?: Promise<AudioBuffer>
}
const files = new Map<string, FileEntry>()

/**
 * Загрузить файл из сборки как ArrayBuffer. В собранной программе страница
 * открыта по file://, а fetch() в Chromium file:// может не поддерживать —
 * тогда XMLHttpRequest (в Electron он читает файлы рядом со страницей).
 */
async function loadUrl(url: string): Promise<ArrayBuffer> {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.arrayBuffer()
  } catch (e) {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const x = new XMLHttpRequest()
      x.open('GET', url)
      x.responseType = 'arraybuffer'
      x.onload = () => (x.response && (x.status === 0 || x.status === 200) ? resolve(x.response as ArrayBuffer) : reject(new Error(`XHR ${x.status}`)))
      x.onerror = () => reject(e instanceof Error ? e : new Error(String(e)))
      x.send()
    })
  }
}

/** Синтезированные звуки после выравнивания: звучащая часть ≈ 0,02 RMS, пик ≈ 0,07. */
const TARGET_RMS = 0.022
const TARGET_PEAK = 0.2

/** Громкость звучащей части (паузы тише 10% от самого громкого куска не считаем) и пик. */
export function measureLevel(channels: Float32Array[], sampleRate: number): { rms: number; peak: number } {
  const n = channels[0]?.length ?? 0
  if (!n) return { rms: 0, peak: 0 }
  const w = Math.max(1, Math.round(sampleRate * 0.05))
  const frames: number[] = []
  let peak = 0
  for (let i = 0; i < n; i += w) {
    const end = Math.min(n, i + w)
    let sum = 0
    for (const ch of channels) {
      for (let j = i; j < end; j++) {
        const s = ch[j]
        sum += s * s
        const a = s < 0 ? -s : s
        if (a > peak) peak = a
      }
    }
    frames.push(sum / ((end - i) * channels.length))
  }
  const maxMs = Math.max(...frames)
  if (!(maxMs > 0)) return { rms: 0, peak }
  const active = frames.filter((m) => m > maxMs * 0.01) // 10% по амплитуде = 1% по мощности
  return { rms: Math.sqrt(active.reduce((a, b) => a + b, 0) / active.length), peak }
}

/**
 * Множитель, приводящий файл к громкости синтеза: звучащая часть — к TARGET_RMS,
 * но пик не выше TARGET_PEAK. Чистая функция — проверяется без Web Audio.
 */
export function normalizeGain(channels: Float32Array[], sampleRate: number): number {
  const { rms, peak } = measureLevel(channels, sampleRate)
  if (!(rms > 0) || !(peak > 0)) return 1
  return Math.min(TARGET_RMS / rms, TARGET_PEAK / peak)
}

function decodeBytes(c: Ctx, key: string, load: () => Promise<ArrayBuffer>): Promise<AudioBuffer> {
  let e = files.get(key)
  if (e?.buffer) return Promise.resolve(e.buffer)
  if (e?.pending) return e.pending
  e = {}
  files.set(key, e)
  const entry = e
  entry.pending = load()
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buf) => {
      const chans: Float32Array[] = []
      for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i))
      entry.buffer = buf
      entry.gain = normalizeGain(chans, buf.sampleRate)
      entry.pending = undefined
      return buf
    })
    .catch((err: unknown) => {
      // Следующая попытка — при следующем проигрывании.
      files.delete(key)
      console.warn('[sound] не удалось загрузить звук', key, err instanceof Error ? err.message : String(err))
      throw err
    })
  return entry.pending
}

type Loader = { key: string; load: () => Promise<ArrayBuffer> }

function playBuffer(c: Ctx, dst: AudioNode, src: Loader, onFail: () => void): void {
  void decodeBytes(c, src.key, src.load)
    .then((buf) => {
      const s = c.createBufferSource()
      s.buffer = buf
      const g = c.createGain()
      g.gain.value = files.get(src.key)?.gain ?? 1
      s.connect(g).connect(dst)
      s.start()
    })
    .catch(onFail)
}

// ───────── Набор звуков ─────────

export type SoundKind = 'soft' | 'game' | 'tech' | 'quiet' | 'file' | 'custom'

export const SOUND_KINDS: { id: SoundKind; title: string }[] = [
  { id: 'soft', title: 'Мягкие' },
  { id: 'game', title: 'Игровые' },
  { id: 'tech', title: 'Технологичные' },
  { id: 'quiet', title: 'Тихие' },
  { id: 'file', title: 'Из файлов' },
  { id: 'custom', title: 'Свои' }
]

export interface SoundDef {
  id: string
  name: string
  kind: SoundKind
  /** Выравнивание громкости синтезированного звука (по замеру measureSynthLevels). */
  level?: number
  /** Источник файла (для звуков из файлов и своих). */
  src?: Loader
  play: (c: Ctx, ok: boolean, dst: AudioNode, cat: SoundCategory) => void
}

/** Стандартный звук ошибки — нисходящий «Звон». */
function chimeError(c: Ctx, dst: AudioNode): void {
  tone(c, dst, 330, 0, 0.16)
  tone(c, dst, 247, 0.15, 0.24)
}

/** Запасной звук, если файл не загрузился: «Капля» (для «Сообщений») или «Звон». */
function fallbackSynth(c: Ctx, ok: boolean, dst: AudioNode, cat: SoundCategory): void {
  const id = cat === 'messages' ? 'drop' : 'chime'
  SYNTH.find((s) => s.id === id)?.play(c, ok, dst, cat)
}

/**
 * Проигрывание звука из файла. Вариант «ошибка» для «Действий» — стандартный
 * синтезированный звук ошибки («Звон», два нисходящих тона), а не тот же файл
 * ниже по высоте: «Успех» и SMS — мажорные восходящие мотивы, и на 0,8 они
 * звучат просто как тот же сигнал чуть ниже и медленнее — на слух в игре это
 * легко принять за «получилось». Нисходящий звон узнаётся сразу.
 * В «Сигналах» (там всегда «ошибка») и «Сообщениях» файл играет как есть:
 * пользователь сам выбрал этот звук, подменять его было бы странно.
 */
function fileSound(src: Loader): SoundDef['play'] {
  return (c, ok, dst, cat) => {
    if (!ok && cat === 'actions') chimeError(c, dst)
    else playBuffer(c, dst, src, () => fallbackSynth(c, ok, dst, cat))
  }
}

const SYNTH: SoundDef[] = [
  // Мягкие
  {
    id: 'chime',
    name: 'Звон (стандартный)',
    kind: 'soft',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 660, 0, 0.14)
        tone(c, d, 990, 0.11, 0.2)
      } else chimeError(c, d)
    }
  },
  {
    id: 'drop',
    name: 'Капля',
    kind: 'soft',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 520, 0, 0.13, 0.09, 'sine', 1500)
        tone(c, d, 760, 0.14, 0.11, 0.04, 'sine', 1900)
      } else tone(c, d, 1300, 0, 0.22, 0.08, 'sine', 330)
    }
  },
  {
    id: 'glass',
    name: 'Стекло',
    kind: 'soft',
    play: (c, ok, d) => {
      const g: [number, number, number][] = [
        [1, 1, 1],
        [2.76, 0.3, 0.6],
        [5.4, 0.1, 0.35]
      ]
      if (ok) {
        partials(c, d, 1760, 0, 0.8, 0.04, g)
        partials(c, d, 2349, 0.09, 0.8, 0.035, g)
      } else {
        partials(c, d, 1397, 0, 0.6, 0.04, g)
        partials(c, d, 1047, 0.12, 0.7, 0.04, g)
      }
    }
  },
  {
    id: 'bell',
    name: 'Колокольчик',
    kind: 'soft',
    play: (c, ok, d) => {
      const f = ok ? 1318 : 740
      tone(c, d, f, 0, 0.6, 0.06)
      tone(c, d, f * 2.01, 0, 0.35, 0.02)
      tone(c, d, f * 3.02, 0, 0.2, 0.012)
    }
  },
  {
    id: 'xylo',
    name: 'Ксилофон',
    kind: 'soft',
    play: (c, ok, d) => {
      const x: [number, number, number][] = [
        [1, 1, 1],
        [3.93, 0.25, 0.3]
      ]
      const notes = ok ? [1047, 1319, 1568] : [784, 622]
      notes.forEach((n, i) => partials(c, d, n, i * 0.08, 0.3, 0.06, x, 'triangle'))
    }
  },
  {
    id: 'harp',
    name: 'Арфа',
    kind: 'soft',
    play: (c, ok, d) => {
      const h: [number, number, number][] = [
        [1, 1, 1],
        [2, 0.3, 0.6]
      ]
      const notes = ok ? [523, 659, 784, 1047] : [587, 494, 415]
      notes.forEach((n, i) => partials(c, d, n, i * 0.055, 0.7, 0.035, h))
    }
  },
  {
    id: 'marimba',
    name: 'Маримба',
    kind: 'soft',
    play: (c, ok, d) => {
      const m: [number, number, number][] = [
        [1, 1, 1],
        [4, 0.2, 0.25],
        [10, 0.05, 0.1]
      ]
      const notes = ok ? [659, 988] : [494, 370]
      notes.forEach((n, i) => partials(c, d, n, i * 0.1, 0.4, 0.07, m))
    }
  },
  {
    id: 'piano',
    name: 'Пианино',
    kind: 'soft',
    play: (c, ok, d) => {
      const p: [number, number, number][] = [
        [1, 1, 1],
        [2, 0.4, 0.7],
        [3, 0.18, 0.5],
        [4, 0.08, 0.35]
      ]
      if (ok) {
        partials(c, d, 523, 0, 0.8, 0.035, p)
        partials(c, d, 659, 0, 0.8, 0.03, p)
        partials(c, d, 784, 0.12, 0.9, 0.035, p)
      } else {
        partials(c, d, 466, 0, 0.6, 0.035, p)
        partials(c, d, 349, 0.14, 0.8, 0.035, p)
      }
    }
  },
  {
    id: 'ping',
    name: 'Пинг',
    kind: 'soft',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 1568, 0, 0.45, 0.06)
        tone(c, d, 3136, 0, 0.15, 0.01)
      } else {
        tone(c, d, 784, 0, 0.25, 0.06)
        tone(c, d, 784, 0.18, 0.35, 0.05)
      }
    }
  },
  {
    id: 'soft',
    name: 'Мягкий',
    kind: 'soft',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 523, 0, 0.5, 0.045, 'triangle')
        tone(c, d, 659, 0.04, 0.5, 0.035, 'triangle')
        tone(c, d, 784, 0.08, 0.55, 0.03, 'triangle')
      } else {
        tone(c, d, 311, 0, 0.5, 0.05, 'triangle')
        tone(c, d, 370, 0.04, 0.5, 0.035, 'triangle')
      }
    }
  },
  {
    id: 'pop',
    name: 'Пузырёк',
    kind: 'soft',
    play: (c, ok, d) => {
      if (ok) tone(c, d, 380, 0, 0.12, 0.12, 'sine', 900)
      else tone(c, d, 600, 0, 0.16, 0.1, 'sine', 220)
    }
  },
  // Игровые
  {
    id: 'coin',
    name: 'Монетка',
    kind: 'game',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 988, 0, 0.08, 0.03, 'square', undefined, 0.005)
        tone(c, d, 1319, 0.07, 0.35, 0.03, 'square', undefined, 0.005)
      } else {
        tone(c, d, 494, 0, 0.1, 0.03, 'square', undefined, 0.005)
        tone(c, d, 370, 0.09, 0.3, 0.03, 'square', undefined, 0.005)
      }
    }
  },
  {
    id: 'bit8',
    name: '8-бит',
    kind: 'game',
    play: (c, ok, d) => {
      const notes = ok ? [784, 988, 1175, 1568] : [330, 262, 196]
      notes.forEach((n, i) => tone(c, d, n, i * 0.045, 0.06, 0.03, 'square', undefined, 0.004))
    }
  },
  {
    id: 'arcade',
    name: 'Аркада',
    kind: 'game',
    play: (c, ok, d) => {
      const notes = ok ? [523, 659, 784, 1046] : [392, 330, 262]
      notes.forEach((n, i) => tone(c, d, n, i * 0.06, 0.09, 0.04, 'square'))
    }
  },
  {
    id: 'levelup',
    name: 'Уровень пройден',
    kind: 'game',
    play: (c, ok, d) => {
      if (ok) {
        ;[523, 659, 784, 1047].forEach((n, i) => tone(c, d, n, i * 0.07, 0.1, 0.035, 'triangle'))
        tone(c, d, 1319, 0.28, 0.45, 0.04, 'triangle')
        tone(c, d, 1568, 0.28, 0.45, 0.02, 'triangle')
      } else {
        ;[784, 740, 698].forEach((n, i) => tone(c, d, n, i * 0.12, 0.14, 0.04, 'triangle'))
        tone(c, d, 659, 0.36, 0.5, 0.045, 'triangle')
      }
    }
  },
  {
    id: 'laser',
    name: 'Лазер',
    kind: 'game',
    play: (c, ok, d) => {
      if (ok) tone(c, d, 1600, 0, 0.18, 0.05, 'sawtooth', 300)
      else tone(c, d, 200, 0, 0.3, 0.06, 'sawtooth', 80)
    }
  },
  {
    id: 'radar',
    name: 'Радар',
    kind: 'game',
    play: (c, ok, d) => {
      const f = ok ? 1175 : 523
      tone(c, d, f, 0, 0.3, 0.06, 'sine', f * 0.97)
      tone(c, d, f, 0.28, 0.3, 0.035, 'sine', f * 0.97)
      tone(c, d, f, 0.56, 0.3, 0.018, 'sine', f * 0.97)
    }
  },
  // Технологичные
  {
    id: 'sonar',
    name: 'Сонар',
    kind: 'tech',
    play: (c, ok, d) => {
      tone(c, d, ok ? 1200 : 500, 0, 0.5, 0.06, 'sine', ok ? 1150 : 420)
      if (!ok) tone(c, d, 420, 0.28, 0.5, 0.05)
    }
  },
  {
    id: 'scan',
    name: 'Сканер',
    kind: 'tech',
    play: (c, ok, d) => {
      if (ok) {
        tone(c, d, 400, 0, 0.25, 0.04, 'triangle', 2000, 0.03)
        tone(c, d, 2000, 0.26, 0.12, 0.05)
      } else {
        tone(c, d, 2000, 0, 0.25, 0.04, 'triangle', 400, 0.03)
        tone(c, d, 300, 0.26, 0.2, 0.06)
      }
    }
  },
  {
    id: 'holo',
    name: 'Голограмма',
    kind: 'tech',
    play: (c, ok, d) => {
      const f = ok ? 880 : 440
      tone(c, d, f, 0, 0.7, 0.035, 'sine', undefined, 0.06)
      tone(c, d, f + 6, 0, 0.7, 0.035, 'sine', undefined, 0.06)
      tone(c, d, ok ? f * 1.5 : f * 0.75, 0.12, 0.55, 0.025, 'sine', undefined, 0.06)
    }
  },
  {
    id: 'pulse',
    name: 'Импульс',
    kind: 'tech',
    play: (c, ok, d) => {
      const n = ok ? 3 : 2
      const f = ok ? 1200 : 400
      for (let i = 0; i < n; i++) tone(c, d, f, i * 0.07, 0.05, 0.03, 'square', undefined, 0.004)
    }
  },
  // Тихие
  {
    id: 'click',
    name: 'Щелчок',
    kind: 'quiet',
    play: (c, ok, d) => {
      noise(c, d, 0, 0.03, 0.2, 3000)
      tone(c, d, ok ? 1800 : 600, 0, 0.04, 0.05, 'square')
      if (!ok) {
        noise(c, d, 0.09, 0.03, 0.2, 3000)
        tone(c, d, 500, 0.09, 0.04, 0.05, 'square')
      }
    }
  },
  {
    id: 'knock',
    name: 'Тук',
    kind: 'quiet',
    play: (c, ok, d) => {
      tone(c, d, ok ? 240 : 170, 0, 0.12, 0.12, 'sine', ok ? 150 : 100, 0.003)
      if (!ok) tone(c, d, 150, 0.16, 0.12, 0.11, 'sine', 90, 0.003)
    }
  },
  {
    id: 'whisper',
    name: 'Шёпот',
    kind: 'quiet',
    play: (c, ok, d) => {
      if (ok) air(c, d, 0, 0.4, 0.06, 2500, 4000, 2)
      else air(c, d, 0, 0.45, 0.07, 1400, 700, 2)
    }
  },
  {
    id: 'wind',
    name: 'Ветер',
    kind: 'quiet',
    play: (c, ok, d) => {
      if (ok) air(c, d, 0, 0.9, 0.06, 400, 1400, 1.5, 0.25)
      else air(c, d, 0, 0.9, 0.06, 1300, 300, 1.5, 0.25)
    }
  }
]

// Множители громкости по замеру measureSynthLevels(): цель — звучащая часть
// ≈ 0,02 RMS, как у «Звона». Квадратные «игровые» волны богаче обертонами и на
// слух громче — им цель ниже (≈ 0,014); «Тихие» — нарочно тише (≈ 0,012).
// Короткие щелчки (Щелчок, Пузырёк, Тук) по RMS кажутся громкими, на слух — нет.
const SYNTH_LEVEL: Record<string, number> = {
  drop: 0.9,
  glass: 1.3,
  xylo: 1.1,
  harp: 1.1,
  marimba: 0.8,
  piano: 1.3,
  ping: 1.15,
  soft: 1.3,
  pop: 0.75,
  coin: 1.4,
  bit8: 1.5,
  levelup: 1.8,
  laser: 1.25,
  radar: 1.35,
  sonar: 1.1,
  scan: 1.4,
  holo: 1.4,
  pulse: 1.6,
  knock: 0.55,
  whisper: 2.6,
  wind: 4
}
for (const s of SYNTH) s.level = SYNTH_LEVEL[s.id] ?? 1

const FILE_SOUNDS: SoundDef[] = BUNDLED_FILE_SOUNDS.map((f) => {
  const src: Loader = { key: f.url, load: () => loadUrl(f.url) }
  return { id: f.id, name: f.name, kind: 'file', src, play: fileSound(src) }
})

/** Свои звуки пользователя: id вида custom:<uuid>. */
let customSounds: SoundDef[] = []

function customDef(id: string, name: string): SoundDef {
  const src: Loader = {
    key: `custom:${id}`,
    load: () => customSoundsRead(id).then((u) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer)
  }
  return { id: `custom:${id}`, name, kind: 'custom', src, play: fileSound(src) }
}

/** Все звуки: синтез, файлы из сборки, свои. */
export function allSounds(): SoundDef[] {
  return [...SYNTH, ...FILE_SOUNDS, ...customSounds]
}

/** Прежний экспорт: встроенный набор. */
export const SOUNDS: SoundDef[] = [...SYNTH, ...FILE_SOUNDS]

const findSound = (id: string | undefined): SoundDef | undefined => (id ? allSounds().find((s) => s.id === id) : undefined)
const validId = (id: unknown): id is string => typeof id === 'string' && (SOUNDS.some((s) => s.id === id) || /^custom:[a-f0-9-]{36}$/.test(id))

// ───────── Изменения набора (для карточки настроек) ─────────

const listeners = new Set<() => void>()
let version = 0
export function subscribeSounds(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function soundsVersion(): number {
  return version
}
function changed(): void {
  version++
  listeners.forEach((f) => f())
}

// ───────── Выбор звука по категориям ─────────
// Хранится в localStorage. Звук «Действий» дополнительно лежит в конфиге
// (hotkeySoundId) — прежнее поле «какой звук»; при старте main.tsx передаёт его
// сюда через setCurrentSound, так что прежний выбор становится звуком «Действий».
// «Сигналы» без своего выбора звучат как «Действия» — так было раньше.

type SoundChoice = Partial<Record<SoundCategory, string>>

export const DEFAULT_SOUND: Record<SoundCategory, string> = {
  actions: 'chime',
  // SMS, пока он есть в сборке (lib/sound-files.ts); иначе синтезированная «Капля».
  messages: BUNDLED_FILE_SOUNDS.some((f) => f.id === 'sms') ? 'sms' : 'drop',
  alerts: 'chime'
}

export function parseChoice(raw: unknown): SoundChoice {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: SoundChoice = {}
  for (const k of ['actions', 'messages', 'alerts'] as const) if (validId(r[k])) out[k] = r[k]
  return out
}

/** Какой звук у категории по сохранённому выбору (без проверки, загружен ли свой звук). */
export function resolveSound(choice: SoundChoice, cat: SoundCategory): string {
  if (cat === 'alerts') return choice.alerts ?? choice.actions ?? DEFAULT_SOUND.alerts
  return choice[cat] ?? DEFAULT_SOUND[cat]
}

let choice: SoundChoice = parseChoice(readJson(CHOICE_KEY))

/** Звук категории; если выбранного звука нет (свой удалён, файл убран) — звук по умолчанию. */
export function getCategorySound(cat: SoundCategory): string {
  const id = resolveSound(choice, cat)
  return findSound(id) ? id : DEFAULT_SOUND[cat]
}

export function setCategorySound(cat: SoundCategory, id: string): void {
  if (!validId(id)) return
  choice = { ...choice, [cat]: id }
  writeJson(CHOICE_KEY, choice)
  changed()
}

/** Звук «Действий» из конфига (hotkeySoundId): читается при старте. */
export function setCurrentSound(id: string | undefined): void {
  if (validId(id) && choice.actions !== id) {
    choice = { ...choice, actions: id }
    changed()
  }
}

// ───────── Свои звуки ─────────

let customLoaded: Promise<void> | null = null

/** Перечитать список своих звуков (один раз при старте и после изменений). */
export function loadCustomSounds(): Promise<void> {
  customLoaded = customSoundsList()
    .then((list) => {
      customSounds = list.map((s) => customDef(s.id, s.name))
      changed()
    })
    .catch(() => void 0)
  return customLoaded
}

const MAX_CUSTOM_SEC = 5

/**
 * Добавить свой звук: системный диалог, копия в папку данных, проверка
 * декодированием (длина до 5 с). null — пользователь отменил выбор.
 */
export async function addCustomSound(): Promise<SoundDef | null> {
  const info = await customSoundsPick()
  if (!info) return null
  const def = customDef(info.id, info.name)
  ctx ??= new AudioContext()
  let err: string | null = null
  try {
    const src = def.src as Loader
    const buf = await decodeBytes(ctx, src.key, src.load)
    if (buf.duration > MAX_CUSTOM_SEC + 0.2) err = `Звук длиннее ${MAX_CUSTOM_SEC} с (${buf.duration.toFixed(1)} с) — выберите короче`
  } catch {
    err = 'Не получилось прочитать звук: файл повреждён или формат не поддерживается'
  }
  if (err) {
    files.delete(def.id)
    await customSoundsRemove(info.id).catch(() => void 0)
    throw new Error(err)
  }
  customSounds = [...customSounds, def]
  changed()
  return def
}

export async function removeCustomSound(id: string): Promise<void> {
  const raw = id.replace(/^custom:/, '')
  await customSoundsRemove(raw)
  files.delete(id)
  customSounds = customSounds.filter((s) => s.id !== id)
  // Категории с этим звуком возвращаются к звуку по умолчанию.
  const next: SoundChoice = { ...choice }
  for (const k of ['actions', 'messages', 'alerts'] as const) if (next[k] === id) delete next[k]
  choice = next
  writeJson(CHOICE_KEY, choice)
  changed()
}

// ───────── Проигрывание ─────────

/** Повтор звука сообщения для того же события из второго места — не чаще раза в 1,5 с. */
const MESSAGE_DEDUP_MS = 1500
let lastMessageAt = -Infinity

/**
 * Сыграть звук. id — конкретный звук (для прослушивания в настройках); без id —
 * звук, выбранный для категории. test — прослушивание из настроек: без защиты
 * от повтора.
 */
export function playSound(id: string | undefined, ok: boolean, cat: SoundCategory = 'actions', test = false): void {
  try {
    const gain = categoryGain(volume, cat)
    if (gain <= 0) return
    if (cat === 'messages' && !test) {
      const now = performance.now()
      if (now - lastMessageAt < MESSAGE_DEDUP_MS) return
      lastMessageAt = now
    }
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const def = findSound(id ?? getCategorySound(cat)) ?? findSound(DEFAULT_SOUND[cat]) ?? SYNTH[0]
    def.play(ctx, ok, voice(ctx, gain * (def.level ?? 1)), cat)
  } catch {
    /* звук недоступен — не страшно */
  }
}

/** Звук «Действий» (сценарии). */
export function playChime(ok: boolean): void {
  playSound(undefined, ok, 'actions')
}

// ───────── Самопроверка ─────────
// Вызывается из теста через window.__lazeykaSound; сама ничего не запускает.

/** Загрузить и декодировать звуки из файлов: из сборки и свои. */
export async function checkSoundFiles(): Promise<{ id: string; ok: boolean; duration?: number; gain?: number; error?: string }[]> {
  ctx ??= new AudioContext()
  const c = ctx
  if (customLoaded) await customLoaded
  return Promise.all(
    allSounds()
      .filter((s) => s.src)
      .map(async (s) => {
        const src = s.src as Loader
        try {
          const buf = await decodeBytes(c, src.key, src.load)
          return { id: s.id, ok: true, duration: Math.round(buf.duration * 100) / 100, gain: Math.round((files.get(src.key)?.gain ?? 0) * 1000) / 1000 }
        } catch (e) {
          return { id: s.id, ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      })
  )
}

/** Замер громкости синтезированных звуков (с учётом level) — для выравнивания набора. */
export async function measureSynthLevels(): Promise<{ id: string; ok: boolean; rms: number; peak: number; len: number }[]> {
  const out: { id: string; ok: boolean; rms: number; peak: number; len: number }[] = []
  for (const s of SYNTH) {
    for (const ok of [true, false]) {
      const oc = new OfflineAudioContext(1, 48000 * 1.6, 48000)
      const g = oc.createGain()
      g.gain.value = s.level ?? 1
      g.connect(oc.destination)
      s.play(oc, ok, g, 'actions')
      const buf = await oc.startRendering()
      const ch = buf.getChannelData(0)
      let last = 0
      for (let i = ch.length - 1; i >= 0; i--)
        if (Math.abs(ch[i]) > 0.001) {
          last = i
          break
        }
      const m = measureLevel([ch], 48000)
      out.push({ id: s.id, ok, rms: Math.round(m.rms * 10000) / 10000, peak: Math.round(m.peak * 1000) / 1000, len: Math.round((last / 48000) * 100) / 100 })
    }
  }
  return out
}

/** Слушать команду из main: горячая клавиша сработала (окно может быть скрыто). */
export function installSoundListener(): void {
  try {
    // main присылает id из конфига; играем звук «Действий» отсюда — он тот же,
    // но так нет рассинхрона, если конфиг ещё не перечитан.
    window.electron.ipcRenderer.on('app:playSound', (_e, _id: string, ok: boolean) => playSound(undefined, ok, 'actions'))
    // Е6: горячая клавиша «Без звука» — переключить и коротко сообщить (окно может быть скрыто).
    window.electron.ipcRenderer.on('app:toggleMute', () => {
      const muted = !getSoundVolume().muted
      setSoundVolume({ muted })
      if (!muted) playSound(undefined, true, 'actions')
      void window.electron.ipcRenderer
        .invoke('app:showNotification', 'LAZEYKA', muted ? 'Звуки выключены' : 'Звуки включены', 'actions')
        .catch(() => void 0)
    })
    void loadCustomSounds()
  } catch {
    /* нет моста — не страшно */
  }
  ;(window as unknown as { __lazeykaSound?: unknown }).__lazeykaSound = { checkSoundFiles, measureSynthLevels }
}
