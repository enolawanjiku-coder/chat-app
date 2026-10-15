import { useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

type Result = { id: string; username: string; display_name: string | null }

export function NewChatDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [groupName, setGroupName] = useState('')
  const [picked, setPicked] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const userId = useAuthStore((s) => s.userId)

  const search = async () => {
    if (!query.trim()) return
    const { data } = await supabase.from('profiles').select('id,username,display_name').ilike('username', `%${query.trim()}%`).limit(10)
    setResults(((data ?? []) as Result[]).filter((r) => r.id !== userId && !picked.some((p) => p.id === r.id)))
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

  const togglePick = (r: Result) => {
    setPicked((prev) => (prev.some((p) => p.id === r.id) ? prev.filter((p) => p.id !== r.id) : [...prev, r]))
    setResults((prev) => prev.filter((x) => x.id !== r.id))
  }

  const createGroup = async () => {
    if (!groupName.trim()) {
      alert('Type a group name first')
      return
    }
    if (picked.length === 0) {
      alert('Pick at least one member below (search, then tap +)')
      return
    }
    const { data, error } = await supabase.rpc('create_group', { group_name: groupName.trim(), member_ids: picked.map((p) => p.id) })
    if (!error && data) {
      onCreated(data as string)
      setOpen(false)
      setGroupName('')
      setPicked([])
      setResults([])
      setQuery('')
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
              className="flex-1 min-w-0 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-1.5 text-sm bg-transparent dark:text-zinc-100 outline-none"
              placeholder="Search username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') search() }}
            />
            <button onClick={search} className="text-sm bg-brand-500 text-white rounded-full px-4 font-medium shrink-0">Go</button>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 px-1 flex items-center shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {results.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1 gap-2">
              <span className="dark:text-zinc-200 truncate">@{r.username} {r.display_name ? <span className="text-gray-400">· {r.display_name}</span> : ''}</span>
              <span className="flex gap-2 shrink-0">
                <button onClick={() => togglePick(r)} className="text-brand-600 font-semibold" title="Add to new group">+ Group</button>
                <button onClick={() => startDirect(r.id)} className="text-brand-600 font-semibold">Chat ›</button>
              </span>
            </div>
          ))}

          <div className="pt-1 border-t border-black/5 dark:border-white/10 space-y-2">
            <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400">New group {picked.length > 0 && `(${picked.length} picked)`}</p>
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <button key={p.id} onClick={() => togglePick(p)} title="Remove" className="text-xs bg-brand-100 dark:bg-white/10 text-brand-700 dark:text-zinc-200 rounded-full px-2.5 py-1">
                    @{p.username} ✕
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className="flex-1 min-w-0 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-1.5 text-sm bg-transparent dark:text-zinc-100 outline-none" placeholder="Group name…" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              <button onClick={createGroup} className="text-sm bg-gray-900 dark:bg-zinc-700 text-white rounded-full px-4 shrink-0">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
