import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useTyping(conversationId: string | null, username: string) {
  const [typingUsers, setTypingUsers] = useState<string[]>([])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const user = (payload.payload as { username?: string })?.username
        if (!user || user === username) return
        setTypingUsers((prev) => (prev.includes(user) ? prev : [...prev, user]))
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== user))
        }, 2500)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, username])

  const sendTyping = () => {
    if (!conversationId) return
    supabase.channel(`typing:${conversationId}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { username },
    })
  }

  return { typingUsers, sendTyping }
}
