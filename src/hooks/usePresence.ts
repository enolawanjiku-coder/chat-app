import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

/** Tracks online users in a conversation via Supabase Presence + last_seen heartbeat. */
export function usePresence(conversationId: string | null) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [onlineIds, setOnlineIds] = useState<string[]>([])

  useEffect(() => {
    if (!conversationId || !userId) return
    const channel = supabase.channel(`presence:${conversationId}`, {
      config: { presence: { key: userId } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        // exclude self — only OTHER online users
        setOnlineIds(Object.keys(state).filter((id) => id !== userId))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: userId, username: profile?.username, online_at: new Date().toISOString() })
          // heartbeat last_seen (cheap, on subscribe only — not every heartbeat)
          await supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', userId)
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, userId, profile?.username])

  return { onlineIds }
}
