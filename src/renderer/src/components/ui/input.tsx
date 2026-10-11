import * as React from "react"
import { ClipboardPaste } from "lucide-react"

import { cn } from "@renderer/lib/utils"
import { insertIntoField, readClipboardText } from "@renderer/utils/clipboard-field"

type InputProps = React.ComponentProps<"input"> & {
  /**
   * Кнопка «Вставить» внутри поля: заменяет содержимое текстом из буфера
   * обмена (как в оптимизаторе маршрута) — всё можно сделать мышкой.
   */
  paste?: boolean
  /** Подпись кнопки (по умолчанию «Вставить»). */
  pasteLabel?: string
}

function Input({ className, type, paste, pasteLabel, ...props }: InputProps) {
  const ref = React.useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-border/80 h-9 w-full min-w-0 rounded-xl border bg-background/50 px-3.5 py-1 text-base transition-all outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        paste && "pr-24",
        className
      )}
      {...props}
    />
  )
  if (!paste) return input
  return (
    <div className="relative min-w-0 flex-1 w-full">
      {input}
      <button
        type="button"
        tabIndex={-1}
        disabled={props.disabled || props.readOnly}
        // Не забираем фокус у поля до вставки.
        onMouseDown={(e) => e.preventDefault()}
        onClick={async () => {
          const el = ref.current
          if (!el) return
          const text = await readClipboardText()
          if (text.trim()) insertIntoField(el, text, "replace")
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
        title="Вставить из буфера обмена (или правая кнопка мыши в поле)"
      >
        <ClipboardPaste className="size-3.5" />
        {pasteLabel ?? "Вставить"}
      </button>
    </div>
  )
}

export { Input }
