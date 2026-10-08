import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function ProfilePage() {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<{ blocked_id: string; username?: string }[]>([])
  const [blockUser, setBlockUser] = useState('')

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
  }, [profile?.display_name])

  const loadBlocks = async () => {
    if (!userId) return
    const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', userId)
    const rows = data ?? []
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', rows.map((r) => r.blocked_id).length ? rows.map((r) => r.blocked_id) : ['00000000-0000-0000-0000-000000000000'])
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p.username]))
    setBlocks(rows.map((r) => ({ ...r, username: pmap.get(r.blocked_id) })))
  }

  useEffect(() => {
    loadBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId)
    setMsg(error ? error.message : 'Saved')
    if (!error) {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      useAuthStore.getState().setAuth(userId, data)
    }
  }

  const block = async () => {
    const q = blockUser.trim().toLowerCase()
    if (!q) return
    const { data: user } = await supabase.from('profiles').select('id').eq('username', q).maybeSingle()
    if (!user) {
      setMsg('User not found')
      return
    }
    const { error } = await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: user.id })
    setMsg(error ? error.message : `Blocked @${q}`)
    setBlockUser('')
    loadBlocks()
  }

  const unblock = async (bid: string) => {
    await supabase.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', bid)
    loadBlocks()
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <Link to="/" className="text-sm underline">← Back to chats</Link>
      <h1 className="text-xl font-bold">Profile & Settings</h1>
      <p className="text-sm text-gray-500">@{profile?.username} · {profile?.id?.slice(0, 8)}</p>
      {msg && <p className="text-sm bg-gray-100 rounded p-2">{msg}</p>}
      <form onSubmit={save} className="space-y-2 bg-white rounded shadow p-4">
        <label className="text-sm">Display name</label>
        <input className="w-full border rounded px-3 py-2" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <label className="text-sm text-gray-400">Bio (coming soon)</label>
        <input className="w-full border rounded px-3 py-2 bg-gray-50" value={bio} readOnly placeholder="Bio — v2" />
        <button className="bg-brand-500 text-white rounded px-4 py-2 text-sm">Save</button>
      </form>
      <div className="bg-white rounded shadow p-4 space-y-2">
        <h2 className="font-medium">Blocked users</h2>
        <div className="flex gap-2">
          <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="username" value={blockUser} onChange={(e) => setBlockUser(e.target.value)} />
          <button onClick={block} className="text-sm border rounded px-2">Block</button>
        </div>
        {blocks.map((b) => (
          <div key={b.blocked_id} className="flex justify-between text-sm">
            <span>@{b.username ?? b.blocked_id.slice(0, 6)}</span>
            <button onClick={() => unblock(b.blocked_id)} className="underline text-brand-600">Unblock</button>
          </div>
        ))}
        {blocks.length === 0 && <p className="text-xs text-gray-400">Nobody blocked.</p>}
      </div>
    </div>
  )
}
