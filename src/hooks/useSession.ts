import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function useSession() {
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const userId = data.session?.user.id ?? null
      if (!userId) {
        setAuth(null, null)
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      setAuth(userId, profile ?? null)
    }
    init()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const userId = session?.user.id ?? null
      if (!userId) {
        setAuth(null, null)
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      setAuth(userId, profile ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [setAuth])
}
