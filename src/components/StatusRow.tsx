import { useEffect, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export type Status = {
  id: string
  user_id: string
  image_path: string
  caption: string | null
  created_at: string
  expires_at: string
  username?: string
  url?: string
}

async function signUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('status-media').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export function StatusRow({ onChanged }: { onChanged: () => void }) {
  const userId = useAuthStore((s) => s.userId)
  const [groups, setGroups] = useState<{ user_id: string; username: string; items: Status[] }[]>([])
  const [viewing, setViewing] = useState<Status[] | null>(null)
  const [viewIdx, setViewIdx] = useState(0)
  const [uploading, setUploading] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('statuses')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(100)
    const rows = (data ?? []) as Status[]
    // cleanup my expired ones quietly
    if (userId) {
      await supabase.from('statuses').delete().eq('user_id', userId).lte('expires_at', new Date().toISOString())
    }
    const ids = [...new Set(rows.map((r) => r.user_id))]
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, username').in('id', ids)
      : { data: [] as { id: string; username: string }[] }
    const pmap = new Map(((profiles ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]))
    const byUser = new Map<string, Status[]>()
    for (const r of rows) {
      const list = byUser.get(r.user_id) ?? []
      list.push({ ...r, username: pmap.get(r.user_id) ?? '?' })
      byUser.set(r.user_id, list)
    }
    // own status first
    const ordered = [...byUser.entries()].sort((a, b) => (a[0] === userId ? -1 : b[0] === userId ? 1 : 0))
    setGroups(ordered.map(([uid, items]) => ({ user_id: uid, username: items[0].username ?? '?', items })))
    onChanged()
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upload = async (file: File) => {
    if (!userId) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Photos only (jpeg/png/webp)')
      return
    }
    setUploading(true)
    try {
      const compressed = await imageCompression(file, { maxWidthOrHeight: 1280, maxSizeMB: 0.5, useWebWorker: true })
      const path = `${userId}/${crypto.randomUUID()}.jpg`
      const { error: upError } = await supabase.storage.from('status-media').upload(path, compressed)
      if (upError) throw upError
      const { error: dbError } = await supabase.from('statuses').insert({ user_id: userId, image_path: path })
      if (dbError) throw dbError
      load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Status upload failed')
    } finally {
      setUploading(false)
    }
  }

  const openViewer = async (items: Status[]) => {
    const withUrls = await Promise.all(items.map(async (s) => ({ ...s, url: (await signUrl(s.image_path)) ?? undefined })))
    setViewing(withUrls)
    setViewIdx(0)
  }

  // auto-advance viewer
  useEffect(() => {
    if (!viewing) return
    if (viewIdx >= viewing.length) {
      setViewing(null)
      return
    }
    const t = setTimeout(() => setViewIdx((i) => i + 1), 5000)
    return () => clearTimeout(t)
  }, [viewing, viewIdx])

  const deleteStatus = async (s: Status) => {
    if (!confirm('Delete this status?')) return
    await supabase.from('statuses').delete().eq('id', s.id)
    await supabase.storage.from('status-media').remove([s.image_path])
    setViewing(null)
    load()
  }

  const current = viewing?.[viewIdx]

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-3 py-2.5 nice-scroll">
        <label className="flex flex-col items-center gap-1 shrink-0 cursor-pointer">
          <span className="w-14 h-14 rounded-full bg-black/5 dark:bg-white/10 border-2 border-dashed border-gray-300 flex items-center justify-center text-xl">
            {uploading ? '…' : '＋'}
          </span>
          <span className="text-[10px] text-gray-500 dark:text-zinc-400">My status</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            e.target.value = ''
          }} />
        </label>
        {groups.map((g) => (
          <button key={g.user_id} onClick={() => openViewer(g.items)} className="flex flex-col items-center gap-1 shrink-0">
            <span className={`w-14 h-14 rounded-full p-0.5 ${g.user_id === userId ? 'bg-gray-300' : 'bg-gradient-to-tr from-brand-500 via-pink-500 to-amber-400'}`}>
              <span className="w-full h-full rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg border-2 border-white dark:border-zinc-900">
                {g.username.slice(0, 1).toUpperCase()}
              </span>
            </span>
            <span className="text-[10px] text-gray-500 dark:text-zinc-400 max-w-14 truncate">{g.user_id === userId ? 'You' : g.username}</span>
          </button>
        ))}
      </div>

      {viewing && current && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col" onClick={() => setViewing(null)}>
          <div className="flex gap-1 p-2">
            {viewing.map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded bg-white/30 overflow-hidden">
                {i < viewIdx && <div className="h-full w-full bg-white" />}
                {i === viewIdx && <div className="h-full bg-white animate-[statusbar_5s_linear]" style={{ animation: 'statusbar 5s linear forwards' }} />}
              </div>
            ))}
          </div>
          <div className="px-4 py-1 flex items-center justify-between text-white" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">@{current.username} · {new Date(current.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            {current.user_id === userId && (
              <button onClick={() => deleteStatus(current)} className="text-sm text-red-300 underline">Delete</button>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 p-2" onClick={(e) => e.stopPropagation()}>
            {current.url && <img src={current.url} alt="status" className="max-h-full max-w-full rounded-xl object-contain" />}
          </div>
          {current.caption && <p className="text-white text-center text-sm pb-6 px-6">{current.caption}</p>}
        </div>
      )}
      <style>{`@keyframes statusbar { from { width: 0 } to { width: 100% } }`}</style>
    </>
  )
}
