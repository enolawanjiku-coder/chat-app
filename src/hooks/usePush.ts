import { useCallback, useEffect, useState } from 'react'
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { useAuthStore } from '../store/authStore'

export function usePush() {
  const userId = useAuthStore((s) => s.userId)
  const [supported] = useState(() => isPushSupported())
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    isSubscribed()
      .then((v) => {
        if (!cancelled) setEnabled(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [supported])

  const toggle = useCallback(async () => {
    if (!userId || busy) return
    setBusy(true)
    setError(null)
    try {
      if (enabled) {
        await unsubscribeFromPush()
        setEnabled(false)
      } else {
        const ok = await subscribeToPush(userId)
        setEnabled(ok)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update notifications.')
    } finally {
      setBusy(false)
    }
  }, [userId, busy, enabled])

  return { supported, enabled, busy, error, toggle }
}
