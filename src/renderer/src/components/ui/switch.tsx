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
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border transition-colors outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=unchecked]:border-transparent data-[state=unchecked]:bg-[color:var(--switch-off)]",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-[color:var(--switch-on)]",
        "focus-visible:ring-2 focus-visible:ring-stroke",
        "data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7",
        // Размер бегунка — переменной: положение считается от неё и ширины дорожки,
        // поэтому бегунок не вылезает за край ни при каком размере шрифта и стиле.
        "data-[size=default]:[--sw-thumb:0.875rem] data-[size=sm]:[--sw-thumb:0.625rem]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute top-1/2 block size-[var(--sw-thumb)] -translate-y-1/2 rounded-full ring-0 transition-[left] duration-150",
          "data-[state=unchecked]:bg-[color:var(--switch-thumb-off)] data-[state=checked]:bg-[color:var(--switch-thumb-on)] shadow-sm",
          "data-[state=unchecked]:left-[2px] data-[state=checked]:left-[calc(100%-var(--sw-thumb)-2px)]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
