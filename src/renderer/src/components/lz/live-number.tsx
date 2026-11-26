import React from 'react'
import { cn } from '@renderer/lib/utils'
import './lz.css'

/**
 * Живое число: при смене значения новое мягко подъезжает снизу. Цифры
 * моноширинные по ширине (tabular-nums), поэтому соседний текст не прыгает.
 * Без анимаций (motion-off) — просто меняется.
 */
export const LiveNumber: React.FC<{ value: React.ReactNode; className?: string }> = ({ value, className }) => (
  <span className={cn('inline-flex overflow-hidden tabular-nums', className)}>
    <span key={String(value)} className="lz-tick">
      {value}
    </span>
  </span>
)

export default LiveNumber
