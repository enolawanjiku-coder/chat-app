import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'

const PAGE = 40

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]) // newest-first internal
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const load = useCallback(
    async (before?: string) => {
      if (!conversationId) return
      if (before) setLoadingMore(true)
      else setLoading(true)
      let query = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE)
      if (before) query = query.lt('created_at', before)
      const { data } = await query
      const rows = (data ?? []) as Message[]
      if (rows.length < PAGE) setHasMore(false)
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const fresh = rows.filter((r) => !seen.has(r.id))
        return before ? [...prev, ...fresh] : rows
      })
      if (before) setLoadingMore(false)
      else setLoading(false)
    },
    [conversationId],
  )

  useEffect(() => {
    setMessages([])
    setHasMore(true)
    if (conversationId) void load()
  }, [conversationId, load])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Message
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as Message
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)))
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || messages.length === 0) return
    void load(messages[messages.length - 1].created_at)
  }, [hasMore, loadingMore, loading, messages, load])

  return { messages: [...messages].reverse(), loadMore, loading, loadingMore, hasMore, setMessages }
}
