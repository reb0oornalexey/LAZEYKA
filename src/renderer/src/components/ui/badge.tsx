import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-primary',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/20 text-primary shadow-[0_0_10px_rgba(99,102,241,0.25)]',
        secondary: 'border-border/60 bg-foreground/[0.07] text-foreground',
        destructive: 'border-rose-500/30 bg-rose-500/20 text-rose-700 dark:text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.25)]',
        outline: 'border-border/80 text-muted-foreground'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
