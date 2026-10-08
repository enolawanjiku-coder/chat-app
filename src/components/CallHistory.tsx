import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Phone, Video } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export type CallLog = {
  id: string
  call_id: string
  conversation_id: string
  caller_id: string
  callee_id: string | null
  call_type: 'voice' | 'video'
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended'
  started_at: string
  ended_at: string | null
  duration_s: number | null
}

function fmtDuration(s: number | null): string {
  if (s === null || s === undefined) return ''
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function CallHistory({ refreshKey, onOpenChat }: { refreshKey: number; onOpenChat: (conversationId: string) => void }) {
  const userId = useAuthStore((s) => s.userId)
  const [logs, setLogs] = useState<(CallLog & { title: string })[]>([])

  useEffect(() => {
    if (!userId) return
    const load = async () => {
      const { data } = await supabase.from('call_logs').select('*').order('started_at', { ascending: false }).limit(50)
      const rows = (data ?? []) as CallLog[]
      // resolve titles
      const convIds = [...new Set(rows.map((r) => r.conversation_id))]
      const { data: convs } = convIds.length ? await supabase.from('conversations').select('id, type, name').in('id', convIds) : { data: [] }
      const cmap = new Map(((convs ?? []) as { id: string; type: string; name: string | null }[]).map((c) => [c.id, c]))
      const otherIds = [...new Set(rows.flatMap((r) => [r.caller_id, r.callee_id]).filter((id): id is string => !!id && id !== userId))]
      const { data: profiles } = otherIds.length ? await supabase.from('profiles').select('id, username, display_name').in('id', otherIds) : { data: [] }
      const pmap = new Map(((profiles ?? []) as { id: string; username: string; display_name: string | null }[]).map((p) => [p.id, p.display_name || `@${p.username}`]))
      setLogs(
        rows.map((r) => {
          const c = cmap.get(r.conversation_id)
          let title = c?.name ?? 'Chat'
          if (c?.type === 'direct') {
            const other = r.caller_id === userId ? r.callee_id : r.caller_id
            title = (other && pmap.get(other)) || 'Direct chat'
          }
          return { ...r, title }
        }),
      )
    }
    load()
  }, [userId, refreshKey])

  if (logs.length === 0) {
    return (
      <div className="text-center px-6 py-10">
        <Phone className="w-8 h-8 mx-auto text-gray-300" />
        <p className="text-sm font-medium text-gray-700 dark:text-zinc-200 mt-2">No calls yet</p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">Voice and video calls will appear here.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col pb-4">
      {logs.map((l) => {
        const outgoing = l.caller_id === userId
        const missed = l.status === 'missed' || (l.status === 'ringing' && !outgoing)
        return (
          <button
            key={l.id}
            onClick={() => onOpenChat(l.conversation_id)}
            className="flex items-center gap-3 text-left px-4 py-2.5 mx-1.5 rounded-2xl hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] transition"
          >
            <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${missed ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
              {l.call_type === 'video' ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className={`block font-semibold text-[15px] truncate ${missed ? 'text-red-600' : 'text-gray-900 dark:text-zinc-100'}`}>{l.title}</span>
              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                {outgoing ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                {l.status === 'missed' ? 'Missed' : l.status === 'declined' ? 'Declined' : l.status === 'ringing' ? 'Ringing…' : l.duration_s ? fmtDuration(l.duration_s) : l.status}
                {' · '}
                {timeLabel(l.started_at)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
