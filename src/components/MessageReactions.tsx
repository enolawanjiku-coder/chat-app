import { useEffect, useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const QUICK = ['❤️', '👍', '😂', '😮', '😢']

type Reaction = { message_id: string; user_id: string; emoji: string }

export function MessageReactions({ messageId, mine }: { messageId: string; mine: boolean }) {
  const userId = useAuthStore((s) => s.userId)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase.from('message_reactions').select('*').eq('message_id', messageId).then(({ data }) => {
      setReactions((data ?? []) as Reaction[])
    })
    const channel = supabase
      .channel(`reactions:${messageId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `message_id=eq.${messageId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setReactions((prev) => [...prev, payload.new as Reaction])
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as Partial<Reaction>
          setReactions((prev) => prev.filter((r) => !(r.user_id === old.user_id && r.emoji === old.emoji)))
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [messageId])

  const toggle = async (emoji: string) => {
    if (!userId) return
    const existing = reactions.some((r) => r.user_id === userId && r.emoji === emoji)
    if (existing) {
      await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId).eq('emoji', emoji)
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji })
    }
    setOpen(false)
  }

  const grouped = new Map<string, number>()
  for (const r of reactions) grouped.set(r.emoji, (grouped.get(r.emoji) ?? 0) + 1)

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {[...grouped.entries()].map(([emoji, count]) => (
        <button
          key={emoji}
          onClick={() => toggle(emoji)}
          className={`text-xs rounded-full px-1.5 border ${mine ? 'border-white/40 bg-white/20' : 'border-gray-200 bg-gray-50'}`}
          title="Toggle reaction"
        >
          {emoji} {count}
        </button>
      ))}
      <div className="relative">
        <button onClick={() => setOpen((o) => !o)} aria-label="React" className={`hover:opacity-100 ${mine ? 'text-white/70' : 'text-gray-400'}`} title="React">
          <SmilePlus className="w-3.5 h-3.5" />
        </button>
        {open && (
          <div className="absolute bottom-5 left-0 bg-white shadow-lg rounded-full px-2 py-1 flex gap-1 z-10 border">
            {QUICK.map((e) => (
              <button key={e} onClick={() => toggle(e)} className="text-lg hover:scale-125">{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
