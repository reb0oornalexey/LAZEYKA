/**
 * Какие значения считаются от смыслового цвета. Чистые данные (без импортов):
 * по ним работают живое перетаскивание, проверка «что зависит от чего» и аудит.
 */
export const DEPENDANTS: Record<string, string[]> = {
  primary: [
    'primary-foreground', 'ring', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-ring',
    'stroke-power-on', 'gradient-start-power-on', 'gradient-end-power-on', 'profile-active',
    'stroke-profile-active', 'chart-1'
  ],
  card: ['popover'],
  border: ['sidebar-border', 'stroke'],
  foreground: ['card-foreground', 'popover-foreground', 'secondary-foreground', 'accent-foreground'],
  success: ['success-foreground', 'st-ok', 'st-ok-text', 'toast-success-fg', 'toast-success-bg', 'toast-success-border'],
  destructive: [
    'destructive-foreground', 'btn-destructive-fg', 'st-err', 'st-err-text', 'toast-error-fg', 'toast-error-bg',
    'toast-error-border', 'badge-danger-bg', 'badge-danger-fg', 'badge-danger-border'
  ],
  warning: ['warning-foreground', 'st-warn', 'st-warn-text', 'toast-warning-fg', 'toast-warning-bg', 'toast-warning-border'],
  info: ['st-info-text', 'toast-info-fg', 'toast-info-bg', 'toast-info-border']
}
