import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@renderer/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border transition-colors outline-none cursor-pointer active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        "data-[state=unchecked]:border-transparent data-[state=unchecked]:bg-input",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
        "focus-visible:ring-2 focus-visible:ring-stroke",
        "data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full ring-0 transition-transform",
          "data-[state=unchecked]:bg-background data-[state=checked]:bg-primary-foreground shadow-sm",
          "group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5",
          "data-[state=checked]:translate-x-[calc(100%+4px)] data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
