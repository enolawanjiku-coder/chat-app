import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'

const PAGE = 40
const POLL_MS = 5000

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]) // newest-first internal
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [live, setLive] = useState(false)

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

  // Merge the newest page into the existing list without dropping older pages
  // already loaded. Used after sending and by the polling fallback.
  const refreshLatest = useCallback(async () => {
    if (!conversationId) return
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    const rows = (data ?? []) as Message[]
    setMessages((prev) => {
      const merged = [...prev]
      const index = new Map(merged.map((m, i) => [m.id, i] as const))
      for (const r of rows) {
        const i = index.get(r.id)
        if (i === undefined) {
          index.set(r.id, merged.length)
          merged.push(r)
        } else {
          merged[i] = r
        }
      }
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at))
      return merged
    })
  }, [conversationId])

  useEffect(() => {
    setMessages([])
    setHasMore(true)
    setLive(false)
    if (conversationId) void load()
  }, [conversationId, load])

  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`messages:${conversationId}`, { config: { private: true } })
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
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED')
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  // Polling fallback: if Realtime is unavailable or unauthorized, still surface
  // new messages (and our own) so chat keeps working.
  useEffect(() => {
    if (!conversationId || live) return
    const timer = window.setInterval(() => void refreshLatest(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [conversationId, live, refreshLatest])

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || messages.length === 0) return
    void load(messages[messages.length - 1].created_at)
  }, [hasMore, loadingMore, loading, messages, load])

  return { messages: [...messages].reverse(), loadMore, loading, loadingMore, hasMore, setMessages, refreshLatest }
}
