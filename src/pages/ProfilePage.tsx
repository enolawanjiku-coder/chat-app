import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import imageCompression from 'browser-image-compression'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export default function ProfilePage() {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState((profile as { bio?: string } | null)?.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<{ blocked_id: string; username?: string }[]>([])
  const [blockUser, setBlockUser] = useState('')

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
    setBio((profile as { bio?: string } | null)?.bio ?? '')
    setAvatarUrl(profile?.avatar_url ?? null)
  }, [profile?.display_name, profile?.avatar_url, profile])

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
    const { error } = await supabase.from('profiles').update({ display_name: displayName, bio: bio.slice(0, 300) }).eq('id', userId)
    setMsg(error ? error.message : 'Saved')
    if (!error) {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      useAuthStore.getState().setAuth(userId, data)
    }
  }

  const uploadAvatar = async (file: File) => {
    if (!userId) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMsg('Avatar must be jpeg/png/webp')
      return
    }
    setUploading(true)
    try {
      const compressed = await imageCompression(file, { maxWidthOrHeight: 512, maxSizeMB: 0.2, useWebWorker: true })
      const path = `${userId}/avatar.jpg`
      const { error: upError } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true })
      if (upError) throw upError
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${data.publicUrl}?t=${Date.now()}`
      const { error: dbError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId)
      if (dbError) throw dbError
      setAvatarUrl(url)
      const { data: fresh } = await supabase.from('profiles').select('*').eq('id', userId).single()
      useAuthStore.getState().setAuth(userId, fresh)
      setMsg('Photo updated')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
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
    <div className="max-w-md mx-auto p-4 sm:p-6 space-y-4 min-h-dvh bg-[#e9e4dc] dark:bg-[#0b141a]">
      <Link to="/" className="text-sm text-brand-600 font-medium">← Back to chats</Link>
      <h1 className="text-xl font-bold dark:text-white">Profile & Settings</h1>
      <p className="text-sm text-gray-500 dark:text-zinc-400">@{profile?.username}</p>
      {msg && <p className="text-sm bg-white dark:bg-zinc-800 dark:text-zinc-200 rounded-xl px-3 py-2 shadow">{msg}</p>}
      <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow p-4 flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-full object-cover" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-3xl font-bold">
            {(profile?.username ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <label className="cursor-pointer text-sm bg-gray-900 dark:bg-zinc-700 text-white rounded-full px-4 py-2">
          {uploading ? 'Uploading…' : '📷 Change photo'}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadAvatar(f)
          }} />
        </label>
      </div>
      <form onSubmit={save} className="space-y-2 bg-white dark:bg-zinc-800 rounded-2xl shadow p-4">
        <label className="text-sm font-medium dark:text-zinc-200">Display name</label>
        <input className="w-full border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 dark:bg-zinc-900 dark:text-white" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <label className="text-sm font-medium dark:text-zinc-200">Bio <span className="text-gray-400 font-normal">({bio.length}/300)</span></label>
        <textarea className="w-full border border-black/10 dark:border-white/10 rounded-xl px-3 py-2 dark:bg-zinc-900 dark:text-white" rows={3} maxLength={300} placeholder="Tell people about yourself…" value={bio} onChange={(e) => setBio(e.target.value)} />
        <button className="bg-brand-500 text-white rounded-full px-5 py-2 text-sm font-semibold">Save</button>
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
