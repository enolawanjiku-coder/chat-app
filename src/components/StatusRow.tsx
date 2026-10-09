import { useEffect, useRef, useState } from 'react'
import { Eye, Plus, Reply, X } from 'lucide-react'
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

// session cache so revisits are instant
const urlCache = new Map<string, string>()

async function signUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path)
  if (hit) return hit
  const { data } = await supabase.storage.from('status-media').createSignedUrl(path, 3600)
  const url = data?.signedUrl ?? null
  if (url) urlCache.set(path, url)
  return url
}

export function StatusRow({ onChanged }: { onChanged: () => void }) {
  const userId = useAuthStore((s) => s.userId)
  const [groups, setGroups] = useState<{ user_id: string; username: string; avatar?: string | null; items: Status[] }[]>([])
  const [viewing, setViewing] = useState<Status[] | null>(null)
  const [viewIdx, setViewIdx] = useState(0)
  const [loadingView, setLoadingView] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reply, setReply] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [viewCounts, setViewCounts] = useState<Map<string, { count: number; names: string[] }>>(new Map())
  const [showViewers, setShowViewers] = useState(false)
  const viewerTimer = useRef<number | null>(null)

  const load = async () => {
    const { data } = await supabase
      .from('statuses')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(30)
    const rows = (data ?? []) as Status[]
    if (userId) {
      await supabase.from('statuses').delete().eq('user_id', userId).lte('expires_at', new Date().toISOString())
    }
    const ids = [...new Set(rows.map((r) => r.user_id))]
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, username, avatar_url').in('id', ids)
      : { data: [] as { id: string; username: string; avatar_url: string | null }[] }
    const pmap = new Map(((profiles ?? []) as { id: string; username: string; avatar_url: string | null }[]).map((p) => [p.id, p]))
    const byUser = new Map<string, Status[]>()
    for (const r of rows) {
      const list = byUser.get(r.user_id) ?? []
      list.push({ ...r, username: pmap.get(r.user_id)?.username ?? '?' })
      byUser.set(r.user_id, list)
    }
    const ordered = [...byUser.entries()].sort((a, b) => (a[0] === userId ? -1 : b[0] === userId ? 1 : 0))
    setGroups(
      ordered.map(([uid, items]) => ({
        user_id: uid,
        username: items[0].username ?? '?',
        avatar: pmap.get(uid)?.avatar_url ?? null,
        items,
      })),
    )
    // view receipts for my own statuses
    if (userId) {
      const mine = rows.filter((r) => r.user_id === userId)
      if (mine.length) {
        const { data: views } = await supabase.from('status_views').select('status_id, viewer_id').in('status_id', mine.map((m) => m.id))
        const vrows = (views ?? []) as { status_id: string; viewer_id: string }[]
        const viewerIds = [...new Set(vrows.map((v) => v.viewer_id).filter((id) => id !== userId))]
        const { data: vprofiles } = viewerIds.length
          ? await supabase.from('profiles').select('id, username').in('id', viewerIds)
          : { data: [] as { id: string; username: string }[] }
        const vmap = new Map(((vprofiles ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]))
        const counts = new Map<string, { count: number; names: string[] }>()
        for (const m of mine) {
          const vs = vrows.filter((v) => v.status_id === m.id)
          counts.set(m.id, { count: vs.length, names: vs.map((v) => (v.viewer_id === userId ? 'You' : vmap.get(v.viewer_id) ?? '?')) })
        }
        setViewCounts(counts)
      }
    }
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
    setViewing(items)
    setViewIdx(0)
    setLoadingView(true)
    setReply('')
    setShowViewers(false)
    // preload all in parallel — fast
    const withUrls = await Promise.all(items.map(async (s) => ({ ...s, url: (await signUrl(s.image_path)) ?? undefined })))
    setViewing(withUrls)
    setLoadingView(false)
  }

  // record view + auto-advance
  useEffect(() => {
    if (!viewing) return
    const current = viewing[viewIdx]
    if (!current) {
      setViewing(null)
      return
    }
    if (current.user_id !== userId) {
      void supabase.from('status_views').upsert(
        { status_id: current.id, viewer_id: userId },
        { onConflict: 'status_id,viewer_id' },
      )
    }
    if (viewerTimer.current) window.clearTimeout(viewerTimer.current)
    viewerTimer.current = window.setTimeout(() => setViewIdx((i) => i + 1), 5000)
    return () => {
      if (viewerTimer.current) window.clearTimeout(viewerTimer.current)
    }
  }, [viewing, viewIdx, userId])

  const sendReply = async () => {
    const current = viewing?.[viewIdx]
    if (!current || !reply.trim() || !userId || current.user_id === userId) return
    setSendingReply(true)
    try {
      const { data: convId, error: rpcError } = await supabase.rpc('create_direct_conversation', { other_user: current.user_id })
      if (rpcError) throw rpcError
      const { error: msgError } = await supabase.from('messages').insert({
        conversation_id: convId as string,
        sender_id: userId,
        type: 'text',
        body: `Replied to @${current.username}'s status: ${reply.trim().slice(0, 500)}`,
      })
      if (msgError) throw msgError
      setReply('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Reply failed')
    } finally {
      setSendingReply(false)
    }
  }

  const deleteStatus = async (s: Status) => {
    if (!confirm('Delete this status?')) return
    await supabase.from('statuses').delete().eq('id', s.id)
    await supabase.storage.from('status-media').remove([s.image_path])
    urlCache.delete(s.image_path)
    setViewing(null)
    load()
  }

  const current = viewing?.[viewIdx]
  const currentViews = current ? viewCounts.get(current.id) : undefined

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-3 py-2.5 nice-scroll">
        <label className="flex flex-col items-center gap-1 shrink-0 cursor-pointer">
          <span className="w-14 h-14 rounded-full bg-black/5 dark:bg-white/10 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
            {uploading ? '…' : <Plus className="w-6 h-6" />}
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
              {g.avatar ? (
                <img src={g.avatar} alt={g.username} className="w-full h-full rounded-full object-cover border-2 border-white dark:border-zinc-900" />
              ) : (
                <span className="w-full h-full rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg border-2 border-white dark:border-zinc-900">
                  {g.username.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-zinc-400 max-w-14 truncate">{g.user_id === userId ? 'You' : g.username}</span>
          </button>
        ))}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex gap-1 p-2">
            {viewing.map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded bg-white/30 overflow-hidden">
                {i < viewIdx && <div className="h-full w-full bg-white" />}
                {i === viewIdx && <div className="h-full bg-white" style={{ animation: 'statusbar 5s linear forwards' }} />}
              </div>
            ))}
          </div>
          <div className="px-4 py-1 flex items-center justify-between text-white">
            <p className="text-sm font-semibold">@{current?.username} · {current && new Date(current.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            <div className="flex items-center gap-3">
              {current && current.user_id === userId && (
                <>
                  <button onClick={() => setShowViewers((s) => !s)} className="flex items-center gap-1 text-sm text-white">
                    <Eye className="w-4 h-4" /> {currentViews?.count ?? 0}
                  </button>
                  <button onClick={() => deleteStatus(current)} className="text-sm text-red-300">Delete</button>
                </>
              )}
              <button onClick={() => setViewing(null)} aria-label="Close" className="text-white"><X className="w-6 h-6" /></button>
            </div>
          </div>
          {showViewers && current && (
            <div className="mx-4 mb-1 rounded-xl bg-white/10 text-white text-sm p-3 max-h-32 overflow-y-auto">
              <p className="text-xs text-white/70 mb-1">Viewed by ({currentViews?.count ?? 0})</p>
              {(currentViews?.names ?? []).length === 0 && <p className="text-xs text-white/60">No views yet</p>}
              {(currentViews?.names ?? []).map((n, i) => <p key={i} className="text-sm">@{n}</p>)}
            </div>
          )}
          <div className="flex-1 flex items-center justify-center min-h-0 p-2" onClick={() => setViewIdx((i) => i + 1)}>
            {loadingView || !current?.url ? (
              <div className="w-16 h-16 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            ) : (
              <img src={current.url} alt="status" className="max-h-full max-w-full rounded-xl object-contain" />
            )}
          </div>
          {current?.caption && <p className="text-white text-center text-sm px-6">{current.caption}</p>}
          {current && current.user_id !== userId && (
            <form
              onSubmit={(e) => { e.preventDefault(); void sendReply() }}
              className="flex items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <Reply className="w-5 h-5 text-white/70 shrink-0" />
              <input
                className="flex-1 rounded-full px-4 py-2.5 text-sm bg-white/10 text-white placeholder:text-white/50 outline-none border border-white/20"
                placeholder={`Reply to @${current.username}…`}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <button disabled={sendingReply || !reply.trim()} className="text-white text-sm font-semibold disabled:opacity-40">
                {sendingReply ? '…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
      <style>{`@keyframes statusbar { from { width: 0 } to { width: 100% } }`}</style>
    </>
  )
}
