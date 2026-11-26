import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { DON_PALETTE, DON_PALETTE_RU, emojiOk, levelHex } from '@renderer/utils/hub-donations-api'
import { inputClass } from './admin-section'

/** Частые эмодзи для объявлений и ников. */
export const COMMON_EMOJI = ['🔥', '🎉', '⚡', '💜', '❤️', '⭐', '👑', '💎', '🚀', '📢', '⚠️', '✅', '🛠️', '🎁', '🙏', '👋']

/**
 * Цвет: кружки набора, поле #rrggbb и выбор на палитре системы. allowHex = false — только набор
 * (у объявлений Hub принимает только ключи набора). none — подпись кнопки «без цвета».
 */
export const ColorPick: React.FC<{
  value: string | null
  onChange: (v: string | null) => void
  allowHex?: boolean
  none?: string
  palette?: Record<string, string>
}> = ({ value, onChange, allowHex = true, none, palette = DON_PALETTE }) => {
  const [hex, setHex] = useState(value?.startsWith('#') ? value : '')
  useEffect(() => setHex(value?.startsWith('#') ? value : ''), [value])
  const hexOk = /^#[0-9a-f]{6}$/i.test(hex)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {none && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn('inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[10.5px]', !value ? 'border-foreground/60 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          <X className="size-3" /> {none}
        </button>
      )}
      {Object.entries(palette).map(([k, c]) => (
        <button
          key={k}
          type="button"
          title={DON_PALETTE_RU[k] ?? k}
          aria-label={DON_PALETTE_RU[k] ?? k}
          onClick={() => onChange(k)}
          className={cn('size-5 cursor-pointer rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110', value === k && 'ring-2 ring-foreground/70')}
          style={{ background: c }}
        />
      ))}
      {allowHex && (
        <span className={cn('ml-1 inline-flex h-7 items-center gap-1 rounded-full border pl-1 pr-1.5', value?.startsWith('#') ? 'border-foreground/50' : 'border-border')}>
          <label className="relative size-5 cursor-pointer rounded-full ring-1 ring-border" style={{ background: hexOk ? hex : value ? levelHex(value) : 'transparent' }} title="Выбрать на палитре">
            <input
              type="color"
              value={hexOk ? hex.toLowerCase() : value ? levelHex(value) : '#8b5cf6'}
              onChange={(e) => onChange(e.target.value.toLowerCase())}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Свой цвет на палитре"
            />
          </label>
          <input
            className="h-6 w-[4.6rem] bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
            value={hex}
            placeholder="#rrggbb"
            spellCheck={false}
            aria-label="Свой цвет: #rrggbb"
            onChange={(e) => {
              const v = e.target.value.trim().slice(0, 7)
              setHex(v)
              if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase())
            }}
          />
        </span>
      )}
    </div>
  )
}

/** Эмодзи: набор частых и своё поле. Пусто — без эмодзи. */
export const EmojiPick: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const bad = value.trim().length > 0 && !emojiOk(value)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn('inline-flex h-7 cursor-pointer items-center rounded-lg border px-2 text-[10.5px]', !value ? 'border-foreground/60 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
        >
          без
        </button>
        {COMMON_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onChange(e)}
            className={cn('inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors', value === e ? 'border-primary/70 bg-primary/12' : 'border-transparent hover:bg-foreground/[0.06]')}
          >
            {e}
          </button>
        ))}
        <input className={cn(inputClass, 'h-7 w-20 text-center', bad && 'border-st-err/70')} value={value} onChange={(e) => onChange(e.target.value.slice(0, 16))} placeholder="своё" aria-label="Свой эмодзи" />
      </div>
      {bad && <p className="text-[10.5px] text-st-err-text">Только эмодзи (до 8 знаков), без букв и цифр.</p>}
    </div>
  )
}
