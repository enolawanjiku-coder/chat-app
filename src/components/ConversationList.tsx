import { useEffect, useState } from 'react'
import { MessageCircle, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { Conversation } from '../lib/types'

export type ConversationPreview = Conversation & {
  last_body: string | null
  last_type: string | null
  last_at: string | null
  unread: number
  title: string
}

const AVATAR_BG = ['bg-red-100 text-red-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700']

function avatarColor(title: string): string {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
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
      const { data: allMembers } = await supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', ids)
      const otherIds = new Set<string>()
      const membersByConv = new Map<string, string[]>()
      for (const m of (allMembers ?? []) as { conversation_id: string; user_id: string }[]) {
        const list = membersByConv.get(m.conversation_id) ?? []
        list.push(m.user_id)
        membersByConv.set(m.conversation_id, list)
        if (m.user_id !== userId) otherIds.add(m.user_id)
      }
      const { data: others } = otherIds.size
        ? await supabase.from('profiles').select('id, username, display_name').in('id', [...otherIds])
        : { data: [] as { id: string; username: string; display_name: string | null }[] }
      const otherMap = new Map(((others ?? []) as { id: string; username: string; display_name: string | null }[]).map((p) => [p.id, p]))
      const titleFor = (c: Conversation): string => {
        if (c.type === 'group') return c.name ?? 'Group'
        const other = (membersByConv.get(c.id) ?? []).find((uid) => uid !== userId)
        const p = other ? otherMap.get(other) : undefined
        return p ? (p.display_name || `@${p.username}`) : 'Direct chat'
      }
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
          last_body: last?.body ?? (last?.type === 'image' ? 'Photo' : null),
          last_type: last?.type ?? null,
          last_at: last?.created_at ?? null,
          unread,
          title: titleFor(c),
        })
      }
      previews.sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
      setConversations(previews)
      setLoading(false)
    }
    fetchConvs()
  }, [userId, refreshKey, selectedId])

  const timeLabel = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    const weekAgo = new Date(now.getTime() - 6 * 864e5)
    if (d > weekAgo) return d.toLocaleDateString([], { weekday: 'short' })
    return d.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' })
  }

  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="animate-pulse bg-gray-200 dark:bg-zinc-700 rounded-full w-12 h-12 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="animate-pulse bg-gray-200 dark:bg-zinc-700 rounded h-3 w-2/3" />
              <div className="animate-pulse bg-gray-200 dark:bg-zinc-700 rounded h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-4">
      {conversations.length === 0 && (
        <div className="text-center px-6 py-10">
          <MessageCircle className="w-10 h-10 mx-auto text-gray-300" />
          <p className="text-sm font-medium text-gray-700 dark:text-zinc-200 mt-2">No chats yet</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">Search a username above to start your first conversation.</p>
        </div>
      )}
      {conversations.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`flex items-center gap-3 text-left px-3 py-2.5 mx-1.5 rounded-2xl active:scale-[0.99] transition hover:bg-black/5 dark:hover:bg-white/5 ${selectedId === c.id ? 'bg-brand-50 dark:bg-white/10' : ''}`}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${avatarColor(c.title)}`}>
            {c.title.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 border-b border-black/5 dark:border-white/5 pb-2.5">
            <div className="flex justify-between items-baseline gap-2">
              <p className="font-semibold text-[15px] truncate text-gray-900 dark:text-zinc-100">{c.title}</p>
              {c.last_at && <span className={`text-[11px] shrink-0 ${c.unread > 0 ? 'text-brand-600 font-semibold' : 'text-gray-400'}`}>{timeLabel(c.last_at)}</span>}
            </div>
            <div className="flex justify-between items-center gap-2 mt-0.5">
              <p className="text-[13px] text-gray-500 dark:text-zinc-400 truncate">{c.last_body ?? `${c.type === 'group' ? 'Group' : 'Say hi 👋'}`}</p>
              {c.unread > 0 ? (
                <span className="text-[11px] font-bold bg-brand-500 text-white rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center shrink-0">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              ) : c.type === 'group' ? (
                <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              ) : null}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
