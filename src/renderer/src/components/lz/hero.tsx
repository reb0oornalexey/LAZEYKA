import React from 'react'
import { cn } from '@renderer/lib/utils'
import { LzPanel } from './panel'
import type { LzTone } from './tone'

type DivProps = { [k: `data-${string}`]: string | undefined }

interface Props extends DivProps {
  tone: LzTone
  /** Главный предмет раздела слева: кольцо, крупное число, значок. */
  visual?: React.ReactNode
  title: React.ReactNode
  text?: React.ReactNode
  /** Строка под текстом: ссылка-помощь, мелкие действия. */
  extra?: React.ReactNode
  /** Справа: одна главная кнопка (+ одна второстепенная под ней). */
  actions?: React.ReactNode
  /** Низ плашки, через тонкую черту: чипы показателей. */
  footer?: React.ReactNode
  className?: string
}

/**
 * Главная плашка раздела («пульт»). Одна на вкладку, всегда первой.
 * Слева — предмет, по центру — состояние словами, справа — одно действие,
 * снизу — живые показатели.
 */
export const LzHero: React.FC<Props> = ({ tone, visual, title, text, extra, actions, footer, className, ...rest }) => (
  <LzPanel hero tone={tone} glow={tone === 'off' ? 0 : 13} className={className} {...rest}>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lz-panel-pad">
      {visual}
      <div className="min-w-[min(100%,220px)] flex-1">
        <h2 className="text-[24px] font-extrabold leading-[1.15] tracking-[-0.01em] text-[color:var(--text-title)]">{title}</h2>
        {text && <p className="mt-1.5 max-w-[58ch] text-[13px] leading-relaxed text-muted-foreground">{text}</p>}
        {extra && <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">{extra}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-col items-stretch gap-2">{actions}</div>}
    </div>
    {footer && <div className={cn('border-t border-foreground/[0.07] px-4 py-3')}>{footer}</div>}
  </LzPanel>
)

export default LzHero
