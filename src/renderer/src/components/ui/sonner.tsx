import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // 'system' was removed as a user-facing option, but next-themes can still
  // briefly hand us undefined / a stale value during the first render. Fall
  // back to 'dark' to match the app's default theme.
  const { resolvedTheme } = useTheme()
  const theme: ToasterProps["theme"] = resolvedTheme === "light" ? "light" : "dark"

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          // Цвета уведомлений берутся из токенов оформления (см. main.css).
          "--normal-bg": "var(--toast-normal-bg)",
          "--normal-text": "var(--toast-normal-fg)",
          "--normal-border": "var(--toast-normal-border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "var(--toast-success-bg)",
          "--success-text": "var(--toast-success-fg)",
          "--success-border": "var(--toast-success-border)",
          "--info-bg": "var(--toast-info-bg)",
          "--info-text": "var(--toast-info-fg)",
          "--info-border": "var(--toast-info-border)",
          "--warning-bg": "var(--toast-warning-bg)",
          "--warning-text": "var(--toast-warning-fg)",
          "--warning-border": "var(--toast-warning-border)",
          "--error-bg": "var(--toast-error-bg)",
          "--error-border": "var(--toast-error-border)",
          "--error-text": "var(--toast-error-fg)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
