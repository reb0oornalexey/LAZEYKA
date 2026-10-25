import React, { useEffect, useRef } from 'react'
import { Popover } from 'radix-ui'
import { ColorField } from './color-field'
import { PV } from '@renderer/lib/appearance/pv-map'
import { useUiState } from '@renderer/lib/appearance/ui-state'

export interface PvPopState {
  x: number
  y: number
  id: string
}

/**
 * Окно у места клика по элементу предпросмотра: 1–4 свойства строками [образец][название][hex].
 * Строка открывает тот же выбор цвета (живое обновление). Если свойство одно — выбор открывается сразу.
 */
export const PvPopover: React.FC<{ pop: PvPopState | null; onClose: () => void }> = ({ pop, onClose }) => {
  const group = pop ? PV[pop.id] : null
  const virtual = useRef({ getBoundingClientRect: () => new DOMRect(0, 0, 0, 0) })
  useEffect(() => {
    if (pop) virtual.current = { getBoundingClientRect: () => new DOMRect(pop.x, pop.y, 0, 0) }
  }, [pop])
  if (pop) virtual.current = { getBoundingClientRect: () => new DOMRect(pop.x, pop.y, 0, 0) }

  return (
    <Popover.Root open={Boolean(group)} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor virtualRef={virtual} />
      <Popover.Portal>
        {group && (
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-[190] w-60 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl outline-none"
          >
            <div className="mb-1 px-1.5 text-xs font-semibold">{group.label}</div>
            {group.props.map((pr) => (
              <ColorField key={pr.key} tokenKey={pr.key} label={pr.name} autoOpen={group.props.length === 1} />
            ))}
            <button
              type="button"
              onClick={() => {
                const ui = useUiState.getState()
                ui.focusControl(group.props[0].key)
                if (ui.drawer) ui.setDrawer(false)
                onClose()
              }}
              className="mt-1 w-full cursor-pointer rounded-lg px-1.5 py-1 text-left text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              Перейти к настройке →
            </button>
          </Popover.Content>
        )}
      </Popover.Portal>
    </Popover.Root>
  )
}
