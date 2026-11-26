import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { Ctl, InfoTip, Segmented } from './section'

/*
 * Е6: «Масштаб всего окна» — рядом с «Размером текста» в «Оформлении».
 * Размер текста меняет только шрифт; масштаб окна увеличивает всё: текст,
 * отступы, значки, как масштаб страницы в браузере. Хранится в конфиге
 * (windowZoom) и применяется главным процессом (core/window-prefs.ts) сразу
 * и при запуске; мини-окно не масштабируется.
 */

const OPTIONS = [
  { id: '0.9', label: '90 %' },
  { id: '1', label: '100 %' },
  { id: '1.1', label: '110 %' },
  { id: '1.25', label: '125 %' }
] as const

type ZoomId = (typeof OPTIONS)[number]['id']

export const WindowZoomCtl: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const z = Number(appConfig?.windowZoom) || 1
  const value = (OPTIONS.find((o) => Math.abs(Number(o.id) - z) < 0.001)?.id ?? '1') as ZoomId
  return (
    <Ctl id="setting:windowZoom" className="mt-2 rounded-xl border border-border bg-background/30 px-2 py-2">
      <div data-setting="windowZoom" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span>Масштаб всего окна</span>
            <InfoTip text="Увеличивает или уменьшает всё окно целиком: текст, отступы, кнопки и значки — как масштаб страницы в браузере. Размер текста выше меняет только шрифт. Мини-окно поверх игры не масштабируется." />
          </div>
          <div className="text-[11px] text-muted-foreground">Для 4K-мониторов и маленьких экранов ноутбуков</div>
        </div>
        <Segmented<ZoomId> value={value} options={OPTIONS.map((o) => ({ ...o }))} onChange={(v) => void patchAppConfig({ windowZoom: Number(v) })} />
      </div>
    </Ctl>
  )
}

export default WindowZoomCtl
