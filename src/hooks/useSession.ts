import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function useSession() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const setHydrated = useAuthStore((s) => s.setHydrated)

  useEffect(() => {
    let mounted = true
    const loadProfile = async (userId: string) => {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (mounted) setAuth(userId, profile ?? null)
    }
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id ?? null
      if (!userId) {
        if (mounted) {
          setAuth(null, null)
          setHydrated()
        }
        return
      }
      await loadProfile(userId)
      if (mounted) setHydrated()
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      const userId = session?.user.id ?? null
      if (event === 'SIGNED_OUT' || !userId) {
        setAuth(null, null)
        setHydrated()
        return
      }
      if (event === 'INITIAL_SESSION') {
        setHydrated()
        return
      }
      await loadProfile(userId)
      setHydrated()
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [setAuth, setHydrated])
}
