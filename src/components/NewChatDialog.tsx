import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function NewChatDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; username: string; display_name: string | null }[]>([])
  const [groupName, setGroupName] = useState('')
  const [open, setOpen] = useState(false)
  const userId = useAuthStore((s) => s.userId)

  const search = async () => {
    if (!query.trim()) return
    const { data } = await supabase.from('profiles').select('id,username,display_name').ilike('username', `%${query.trim()}%`).limit(10)
    setResults((data ?? []).filter((r) => r.id !== userId))
  }

  const startDirect = async (otherId: string) => {
    const { data, error } = await supabase.rpc('create_direct_conversation', { other_user: otherId })
    if (!error && data) {
      onCreated(data as string)
      setOpen(false)
      setQuery('')
      setResults([])
    } else alert(error?.message ?? 'Failed to create chat')
  }

  const createGroup = async () => {
    if (!groupName.trim()) return
    const memberIds = results.slice(0, 10).map((r) => r.id)
    const { data, error } = await supabase.rpc('create_group', { group_name: groupName.trim(), member_ids: memberIds })
    if (!error && data) {
      onCreated(data as string)
      setOpen(false)
      setGroupName('')
      setResults([])
    } else alert(error?.message ?? 'Failed to create group')
  }

  return (
    <div className="p-2.5 bg-[#f0f2f5] dark:bg-[#1f2c34]">
      {!open ? (
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-white dark:bg-[#2a3942] rounded-full px-4 py-2 text-sm text-gray-400">
            <Search className="w-4 h-4 shrink-0" />
            <button className="flex-1 text-left truncate" onClick={() => setOpen(true)}>Search or start new chat</button>
          </div>
          <button onClick={() => setOpen(true)} aria-label="New chat" className="w-10 h-10 rounded-full bg-brand-500 text-white shadow active:scale-95 transition shrink-0 flex items-center justify-center" title="New chat"><Plus className="w-5 h-5" /></button>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#2a3942] rounded-2xl p-3 space-y-2 shadow">
          <div className="flex gap-2">
            <input
              autoFocus
              className="flex-1 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-1.5 text-sm bg-transparent dark:text-zinc-100 outline-none"
              placeholder="Username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search() }}
            />
            <button onClick={search} className="text-sm bg-brand-500 text-white rounded-full px-4 font-medium">Go</button>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 px-1 flex items-center"><X className="w-5 h-5" /></button>
          </div>
          {results.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1">
              <span className="dark:text-zinc-200 truncate">@{r.username} {r.display_name ? <span className="text-gray-400">· {r.display_name}</span> : ''}</span>
              <button onClick={() => startDirect(r.id)} className="text-brand-600 font-semibold shrink-0 ml-2">Chat ›</button>
            </div>
          ))}
          <div className="flex gap-2 pt-1 border-t border-black/5 dark:border-white/10">
            <input className="flex-1 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-1.5 text-sm bg-transparent dark:text-zinc-100 outline-none" placeholder="New group name…" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            <button onClick={createGroup} className="text-sm border border-black/10 dark:border-white/20 rounded-full px-3 dark:text-zinc-200">+ Group</button>
          </div>
        </div>
      )}
    </div>
  )
}
