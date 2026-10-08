import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function NewChatDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; username: string; display_name: string | null }[]>([])
  const [groupName, setGroupName] = useState('')
  const userId = useAuthStore((s) => s.userId)

  const search = async () => {
    const { data } = await supabase.from('profiles').select('id,username,display_name').ilike('username', `%${query}%`).limit(10)
    setResults((data ?? []).filter((r) => r.id !== userId))
  }

  const startDirect = async (otherId: string) => {
    const { data, error } = await supabase.rpc('create_direct_conversation', { other_user: otherId })
    if (!error && data) onCreated(data as string)
    else alert(error?.message ?? 'Failed to create chat')
  }

  const createGroup = async () => {
    if (!groupName.trim()) return
    const memberIds = results.slice(0, 10).map((r) => r.id)
    const { data, error } = await supabase.rpc('create_group', { group_name: groupName.trim(), member_ids: memberIds })
    if (!error && data) onCreated(data as string)
    else alert(error?.message ?? 'Failed to create group')
  }

  return (
    <div className="p-4 border-b bg-white space-y-2">
      <div className="flex gap-2">
        <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm" placeholder="Search username…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={search} className="text-sm bg-gray-900 text-white rounded-lg px-3">Search</button>
      </div>
      {results.map((r) => (
        <div key={r.id} className="flex items-center justify-between text-sm">
          <span>@{r.username} {r.display_name ? `(${r.display_name})` : ''}</span>
          <button onClick={() => startDirect(r.id)} className="text-brand-600 underline">Chat</button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm" placeholder="Group name…" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        <button onClick={createGroup} className="text-sm border rounded-lg px-3">+ Group</button>
      </div>
    </div>
  )
}
