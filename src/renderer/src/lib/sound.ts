/**
 * Звуки подтверждения (без файлов, через Web Audio). Набор на выбор —
 * Настройки → Горячие клавиши. «chime» — исходный звук, остаётся по умолчанию.
 * У каждого звука два варианта: удачно и ошибка.
 */
let ctx: AudioContext | null = null

type Wave = OscillatorType

function tone(c: AudioContext, freq: number, start: number, dur: number, vol = 0.07, type: Wave = 'sine', slideTo?: number): void {
  const o = c.createOscillator()
  const g = c.createGain()
  const t0 = c.currentTime + start
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.03)
}

function noise(c: AudioContext, start: number, dur: number, vol = 0.05, hp = 2000): void {
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
  src.connect(f).connect(g).connect(c.destination)
  src.start(c.currentTime + start)
}

export interface SoundDef {
  id: string
  name: string
  play: (c: AudioContext, ok: boolean) => void
}

export const SOUNDS: SoundDef[] = [
  {
    id: 'chime',
    name: 'Звон (стандартный)',
    play: (c, ok) => {
      if (ok) {
        tone(c, 660, 0, 0.14)
        tone(c, 990, 0.11, 0.2)
      } else {
        tone(c, 330, 0, 0.16)
        tone(c, 247, 0.15, 0.24)
      }
    }
  },
  {
    id: 'bell',
    name: 'Колокольчик',
    play: (c, ok) => {
      const f = ok ? 1318 : 740
      tone(c, f, 0, 0.6, 0.06)
      tone(c, f * 2.01, 0, 0.35, 0.02)
      tone(c, f * 3.02, 0, 0.2, 0.012)
    }
  },
  {
    id: 'pop',
    name: 'Пузырёк',
    play: (c, ok) => {
      if (ok) tone(c, 380, 0, 0.12, 0.12, 'sine', 900)
      else tone(c, 600, 0, 0.16, 0.1, 'sine', 220)
    }
  },
  {
    id: 'click',
    name: 'Щелчок',
    play: (c, ok) => {
      noise(c, 0, 0.03, 0.2, 3000)
      tone(c, ok ? 1800 : 600, 0, 0.04, 0.05, 'square')
      if (!ok) {
        noise(c, 0.09, 0.03, 0.2, 3000)
        tone(c, 500, 0.09, 0.04, 0.05, 'square')
      }
    }
  },
  {
    id: 'arcade',
    name: 'Аркада',
    play: (c, ok) => {
      const notes = ok ? [523, 659, 784, 1046] : [392, 330, 262]
      notes.forEach((n, i) => tone(c, n, i * 0.06, 0.09, 0.04, 'square'))
    }
  },
  {
    id: 'soft',
    name: 'Мягкий',
    play: (c, ok) => {
      if (ok) {
        tone(c, 523, 0, 0.5, 0.045, 'triangle')
        tone(c, 659, 0.04, 0.5, 0.035, 'triangle')
        tone(c, 784, 0.08, 0.55, 0.03, 'triangle')
      } else {
        tone(c, 311, 0, 0.5, 0.05, 'triangle')
        tone(c, 370, 0.04, 0.5, 0.035, 'triangle')
      }
    }
  },
  {
    id: 'sonar',
    name: 'Сонар',
    play: (c, ok) => {
      tone(c, ok ? 1200 : 500, 0, 0.5, 0.06, 'sine', ok ? 1150 : 420)
      if (!ok) tone(c, 420, 0.28, 0.5, 0.05)
    }
  },
  {
    id: 'laser',
    name: 'Лазер',
    play: (c, ok) => {
      if (ok) tone(c, 1600, 0, 0.18, 0.05, 'sawtooth', 300)
      else tone(c, 200, 0, 0.3, 0.06, 'sawtooth', 80)
    }
  }
]

/** Выбранный звук: читается при старте и меняется из настроек. */
let current = 'chime'
export function setCurrentSound(id: string | undefined): void {
  current = id && SOUNDS.some((s) => s.id === id) ? id : 'chime'
}

export function playSound(id: string | undefined, ok: boolean): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const def = SOUNDS.find((s) => s.id === (id ?? current)) ?? SOUNDS[0]
    def.play(ctx, ok)
  } catch {
    /* звук недоступен — не страшно */
  }
}

/** Звук подтверждения выбранным в настройках звуком. */
export function playChime(ok: boolean): void {
  playSound(current, ok)
}

/** Слушать команду из main: горячая клавиша сработала (окно может быть скрыто). */
export function installSoundListener(): void {
  try {
    window.electron.ipcRenderer.on('app:playSound', (_e, id: string, ok: boolean) => playSound(id, ok))
  } catch {
    /* нет моста — не страшно */
  }
}
