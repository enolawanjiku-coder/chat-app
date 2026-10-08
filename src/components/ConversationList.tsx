import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { Conversation } from '../lib/types'

export type ConversationPreview = Conversation & {
  last_body: string | null
  last_type: string | null
  last_at: string | null
  unread: number
}

export function ConversationList({
  selectedId,
  onSelect,
  refreshKey,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
  refreshKey: number
}) {
  const userId = useAuthStore((s) => s.userId)
  const [conversations, setConversations] = useState<ConversationPreview[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    const fetchConvs = async () => {
      setLoading(true)
      const { data: memberships } = await supabase
        .from('conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId)
      const ids = (memberships ?? []).map((m) => m.conversation_id)
      const readMap = new Map((memberships ?? []).map((m) => [m.conversation_id, m.last_read_at]))
      if (ids.length === 0) {
        setConversations([])
        setLoading(false)
        return
      }
      const { data: convs } = await supabase.from('conversations').select('*').in('id', ids)
      const previews: ConversationPreview[] = []
      for (const c of (convs ?? []) as Conversation[]) {
        const { data: last } = await supabase
          .from('messages')
          .select('body, type, created_at')
          .eq('conversation_id', c.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const lastRead = readMap.get(c.id) as string | undefined
        let unread = 0
        if (last?.created_at) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', c.id)
            .is('deleted_at', null)
            .gt('created_at', lastRead ?? '1970-01-01')
            .neq('sender_id', userId)
          unread = count ?? 0
        }
        previews.push({
          ...c,
          last_body: last?.body ?? (last?.type === 'image' ? '📷 Photo' : null),
          last_type: last?.type ?? null,
          last_at: last?.created_at ?? null,
          unread,
        })
      }
      previews.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
      setConversations(previews)
      setLoading(false)
    }
    fetchConvs()
  }, [userId, refreshKey, selectedId])

  // live-refresh list on any new message in user's conversations
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        // lightweight: trigger parent refresh via selectedId change is hacky;
        // rely on refreshKey bumps from ChatPage realtime instead
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  if (loading) {
    return (
      <div className="p-2 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse bg-gray-100 rounded-lg h-14" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {conversations.length === 0 && (
        <p className="text-sm text-gray-500 p-4">No chats yet. Search a username above to start.</p>
      )}
      {conversations.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`flex items-center gap-3 text-left px-4 py-3 border-b hover:bg-gray-50 ${selectedId === c.id ? 'bg-brand-50' : ''}`}
        >
          <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
            {(c.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-baseline gap-2">
              <p className="font-medium truncate">{c.name ?? 'Direct chat'}</p>
              {c.last_at && (
                <span className="text-[10px] text-gray-400 shrink-0">
                  {new Date(c.last_at).toLocaleDateString() === new Date().toLocaleDateString()
                    ? new Date(c.last_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date(c.last_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="flex justify-between items-center gap-2">
              <p className="text-xs text-gray-500 truncate">{c.last_body ?? `${c.type} chat — say hi`}</p>
              {c.unread > 0 && (
                <span className="text-[10px] bg-brand-500 text-white rounded-full min-w-5 h-5 px-1 flex items-center justify-center shrink-0">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
