import { useEffect, useState } from 'react'
import { adminState, onAdminChanged, type AdminState } from '@renderer/utils/hub-admin-api'

/** Привязка режима автора: только «есть / нет» (локально, без сети). */
export function useAuthorState(): AdminState | null {
  const [st, setSt] = useState<AdminState | null>(null)
  useEffect(() => {
    let alive = true
    adminState()
      .then((v) => alive && setSt(v))
      .catch(() => alive && setSt({ available: false, paired: false, until: null }))
    const off = onAdminChanged((v) => setSt(v))
    return () => {
      alive = false
      off()
    }
  }, [])
  return st
}
