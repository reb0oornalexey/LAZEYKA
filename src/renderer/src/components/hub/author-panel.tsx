import React, { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { adminPair, adminPairCancel } from '@renderer/utils/hub-admin-api'
import { HubModal } from './modal'
import { useAuthorState } from './use-author'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fmt = (t: number): string => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Привязка: код из бота → подтверждение «Да» в Telegram. */
const PairDialog: React.FC<{ open: boolean; onClose: () => void; available: boolean }> = ({ open, onClose, available }) => {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const digits = code.replace(/\D/g, '')

  const close = (): void => {
    if (busy) void adminPairCancel()
    setCode('')
    setError(null)
    onClose()
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await adminPair(digits)
      if (r.ok) {
        toast.success('Админка доступна в меню слева', { description: `Режим автора действует до ${fmt(r.until)}.` })
        setCode('')
        onClose()
      } else setError(r.message)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <HubModal
      open={open}
      onClose={close}
      icon={KeyRound}
      title="Вход для автора"
      subtitle="Привязка программы к вашему боту"
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {busy ? 'Отменить' : 'Закрыть'}
          </Button>
          <Button onClick={() => void run()} disabled={!available || busy || digits.length !== 8}>
            {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {busy ? 'Жду подтверждения…' : 'Привязать'}
          </Button>
        </>
      }
    >
      {!available ? (
        <p className="rounded-lg border border-st-warn/30 bg-st-warn/10 px-3 py-2 text-xs text-st-warn-text">
          Защищённое хранилище системы недоступно, поэтому ключ негде безопасно сохранить. Привязка на этом устройстве невозможна.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Код выдаёт бот: меню → «Режим автора в программе» → «Получить код». После ввода бот спросит подтверждение — нажмите там «Да» (на это есть 2 минуты).</p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 10))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="8 цифр"
            disabled={busy}
            className="text-center font-mono text-lg tracking-[0.3em]"
            aria-label="Код привязки"
          />
          {busy && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Подтвердите запрос в Telegram…</p>}
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        </>
      )}
    </HubModal>
  )
}

const AUTHOR_ENTRY_EVENT = 'lazeyka:author-entry'
const TAPS_NEEDED = 5
const TAPS_WINDOW_MS = 3000

/**
 * Тайный вход для автора: 5 быстрых нажатий (за 3 секунды) на ник автора на странице «Автор и поддержка».
 * Внешне ник не выглядит нажимаемым: тот же курсор и вид, без подсказок. Сам по себе вход ничего
 * не открывает посторонним: привязка возможна только с кодом из бота автора и его «Да» в Telegram.
 */
export function useAuthorSecretTap(): () => void {
  const taps = React.useRef<number[]>([])
  return React.useCallback(() => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < TAPS_WINDOW_MS), now]
    if (taps.current.length >= TAPS_NEEDED) {
      taps.current = []
      window.dispatchEvent(new Event(AUTHOR_ENTRY_EVENT))
    }
  }, [])
}

/**
 * Тайный вход на странице «Автор и поддержка»: окно привязки (открывается 5 нажатиями на ник).
 * После привязки здесь ничего не показывается — всё управление в пункте меню «Админка».
 */
export const AuthorCorner: React.FC = () => {
  const st = useAuthorState()
  const navigate = useNavigate()
  const paired = Boolean(st?.paired)
  const [pairOpen, setPairOpen] = useState(false)
  React.useEffect(() => {
    // Уже привязано — тот же жест ведёт в «Админку».
    const open = (): void => {
      if (paired) void navigate('/admin')
      else setPairOpen(true)
    }
    window.addEventListener(AUTHOR_ENTRY_EVENT, open)
    return () => window.removeEventListener(AUTHOR_ENTRY_EVENT, open)
  }, [paired, navigate])
  if (!st || st.paired) return null
  return <PairDialog open={pairOpen} onClose={() => setPairOpen(false)} available={st.available} />
}
