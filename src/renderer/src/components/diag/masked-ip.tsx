import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { maskIp } from '@renderer/utils/diag-api'

/** IP-адрес с маской последних двух октетов и кнопкой «показать». */
export const MaskedIp: React.FC<{ ip: string | null | undefined }> = ({ ip }) => {
  const [shown, setShown] = useState(false)
  if (!ip) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span data-sensitive="ip" className="font-mono">
        {shown ? ip : maskIp(ip)}
      </span>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {shown ? 'скрыть' : 'показать'}
      </button>
    </span>
  )
}
