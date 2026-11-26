import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { HubModal, textareaClass } from '@renderer/components/hub/modal'

/**
 * Режим автора: «Убрать у всех» — подтверждение и необязательная причина. Запись только
 * отмечается; опубликовать отметки можно в «Панели автора» вместе с правками адресов.
 */
export function DnsRemoveDialog({
  name,
  open,
  busy,
  onCancel,
  onConfirm
}: {
  name: string
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  return (
    <HubModal
      open={open}
      onClose={onCancel}
      locked={busy}
      icon={Trash2}
      title={`Убрать «${name}» у всех?`}
      subtitle="Запись пропадёт из списка DNS у пользователей после публикации."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim())} disabled={busy}>
            <Trash2 /> Убрать у всех
          </Button>
        </>
      }
    >
      <div className="space-y-1.5" data-tour="dns-remove-reason">
        <label className="text-xs font-medium text-foreground" htmlFor="dns-remove-reason">
          Причина (необязательно)
        </label>
        <textarea
          id="dns-remove-reason"
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value.replace(/[\r\n]+/g, ' '))}
          placeholder="Например: сервис перестал отвечать"
          className={textareaClass}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Причину увидят те, у кого этот DNS сейчас включён. Их настройки программа сама не меняет:
          она предложит выбрать другой. Отметка попадёт в «Опубликовать правки DNS», там её можно
          снять. Вернуть запись можно потом там же или в боте.
        </p>
      </div>
    </HubModal>
  )
}
