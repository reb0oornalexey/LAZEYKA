import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@renderer/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold cursor-pointer transition-colors duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive select-none",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--btn-primary-bg)] text-[color:var(--btn-primary-fg)] hover:bg-[color:var(--btn-primary-hover)] shadow-[inset_0_0_0_1px_var(--btn-primary-border)]",
        destructive:
          "bg-[color:var(--btn-destructive-bg)] text-[color:var(--btn-destructive-fg)] hover:bg-[color:var(--btn-destructive-hover)] shadow-[inset_0_0_0_1px_var(--btn-destructive-border)] focus-visible:ring-destructive/30 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-[color:var(--btn-outline-border)] bg-[color:var(--btn-outline-bg)] text-[color:var(--btn-outline-fg)] hover:bg-[color:var(--btn-outline-hover)] hover:border-[color:var(--btn-outline-hover-border)]",
        secondary:
          "bg-[color:var(--btn-secondary-bg)] text-[color:var(--btn-secondary-fg)] hover:bg-[color:var(--btn-secondary-hover)] border border-[color:var(--btn-secondary-border)]",
        ghost:
          "bg-[color:var(--btn-ghost-bg)] text-[color:var(--btn-ghost-fg)] hover:bg-[color:var(--btn-ghost-hover)] shadow-[inset_0_0_0_1px_var(--btn-ghost-border)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 p-1 bg-clip-content",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
