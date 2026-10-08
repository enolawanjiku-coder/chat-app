import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'
import { useAuthStore } from '../store/authStore'
import { MessageReactions } from './MessageReactions'

function ImageBubble({ path, onOpen }: { path: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    supabase.storage.from('chat-images').createSignedUrl(path, 3600).then(({ data }) => {
      setUrl(data?.signedUrl ?? null)
    })
  }, [path])
  if (!url) return <div className="w-48 h-32 rounded-lg bg-black/10 animate-pulse" />
  return (
    <img
      src={url}
      alt="shared"
      className="rounded-xl max-w-60 max-h-72 object-cover cursor-zoom-in"
      onClick={() => onOpen(url)}
    />
  )
}

const SENDER_COLORS = ['text-red-600', 'text-amber-600', 'text-emerald-600', 'text-sky-600', 'text-violet-600']

function senderColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]
}

export function MessageList({
  messages,
  onLoadMore,
  hasMore,
  loadingMore,
  replyTo,
  onReply,
  wallpaper,
}: {
  messages: Message[]
  onLoadMore: () => void
  hasMore: boolean
  loadingMore: boolean
  replyTo: Message | null
  onReply: (m: Message | null) => void
  wallpaper: string | null
}) {
  const userId = useAuthStore((s) => s.userId)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [names, setNames] = useState<Map<string, string>>(new Map())

  const byId = new Map(messages.map((m) => [m.id, m]))

  // resolve sender names for group display
  useEffect(() => {
    const ids = [...new Set(messages.map((m) => m.sender_id).filter((id) => id !== userId))]
    if (ids.length === 0) return
    supabase.from('profiles').select('id, username, display_name').in('id', ids).then(({ data }) => {
      setNames(new Map(((data ?? []) as { id: string; username: string; display_name: string | null }[]).map((p) => [p.id, p.display_name || `@${p.username}`])))
    })
  }, [messages, userId])

  const saveEdit = async (m: Message) => {
    if (!editBody.trim() || editBody === m.body) {
      setEditingId(null)
      return
    }
    await supabase.from('messages').update({ body: editBody.trim().slice(0, 4000), edited_at: new Date().toISOString() }).eq('id', m.id)
    setEditingId(null)
  }

  const softDelete = async (m: Message) => {
    if (!confirm('Delete this message?')) return
    await supabase.from('messages').update({ deleted_at: new Date().toISOString(), body: null }).eq('id', m.id)
  }

  const dayLabel = (iso: string): string => {
    const d = new Date(iso)
    const today = new Date()
    const yesterday = new Date(today.getTime() - 864e5)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  }

  let lastDay = ''

  return (
    <div
      className={`flex-1 overflow-y-auto nice-scroll relative ${wallpaper ? '' : 'chat-wallpaper'}`}
      id="message-scroll"
      style={wallpaper ? { backgroundImage: `url(${wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {wallpaper && <div className="absolute inset-0 bg-white/80 dark:bg-[#0b141a]/80 pointer-events-none" />}
      <div className="relative px-3 sm:px-8 py-3 space-y-1">
      {hasMore && (
        <div className="flex justify-center mb-2">
          <button onClick={onLoadMore} disabled={loadingMore} className="text-xs font-medium bg-white dark:bg-zinc-800 shadow rounded-full px-4 py-1.5 text-brand-600 disabled:opacity-40">
            {loadingMore ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex justify-center mt-10">
          <p className="text-xs text-gray-600 dark:text-zinc-300 bg-[#fdf3c6] dark:bg-zinc-800 rounded-lg px-4 py-2 shadow text-center max-w-xs">
            🔒 Messages are visible to chat members. Say hi to start the conversation.
          </p>
        </div>
      )}
      {messages.map((m) => {
        const mine = m.sender_id === userId
        const quoted = m.reply_to ? byId.get(m.reply_to) : null
        const day = dayLabel(m.created_at)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={m.id}>
            {showDay && (
              <div className="flex justify-center my-2">
                <span className="text-[11px] font-medium text-gray-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 shadow rounded-lg px-3 py-1">{day}</span>
              </div>
            )}
            <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] sm:max-w-[70%] px-2.5 pt-1.5 pb-1 text-[14.5px] leading-snug shadow-sm group relative ${
                  mine
                    ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-gray-900 dark:text-zinc-100 rounded-2xl rounded-br-md'
                    : 'bg-white dark:bg-[#1f2c34] text-gray-900 dark:text-zinc-100 rounded-2xl rounded-bl-md'
                }`}
              >
                {!mine && names.get(m.sender_id) && (
                  <p className={`text-xs font-semibold ${senderColor(m.sender_id)}`}>{names.get(m.sender_id)}</p>
                )}
                {quoted && (
                  <div className={`text-xs rounded-lg px-2 py-1 mb-1 border-l-4 ${mine ? 'bg-black/5 border-brand-500' : 'bg-black/5 dark:bg-white/10 border-gray-300'}`}>
                    {quoted.deleted_at ? <em className="opacity-60">deleted</em> : quoted.type === 'image' ? '📷 Photo' : (quoted.body ?? '').slice(0, 120)}
                  </div>
                )}
                {m.deleted_at ? (
                  <p className="italic opacity-60 text-[13px] px-1 py-0.5">🚫 This message was deleted</p>
                ) : editingId === m.id ? (
                  <div className="flex gap-1 py-1">
                    <input autoFocus className="rounded-lg px-2 py-1 text-sm flex-1 text-gray-900 border" value={editBody} onChange={(e) => setEditBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m) }} />
                    <button onClick={() => saveEdit(m)} className="text-xs font-semibold text-brand-600">✓</button>
                  </div>
                ) : m.type === 'image' && m.image_path ? (
                  <div className="py-1"><ImageBubble path={m.image_path} onOpen={setLightbox} /></div>
                ) : (
                  <p className="whitespace-pre-wrap break-words px-1">{m.body}</p>
                )}
                <div className="flex justify-end items-center gap-1 -mt-0.5">
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {m.edited_at ? ' · edited' : ''}
                  </span>
                  {mine && !m.deleted_at && <span className="text-[11px] text-sky-500">✓✓</span>}
                </div>
                {!m.deleted_at && <MessageReactions messageId={m.id} mine={mine} />}
                {!m.deleted_at && (
                  <div className={`flex gap-3 mt-0.5 pb-0.5 text-[11px] font-medium sm:opacity-0 sm:group-hover:opacity-100 transition ${mine ? 'text-brand-700 dark:text-zinc-300' : 'text-gray-500'}`}>
                    <button onClick={() => onReply(m)} className="hover:underline">Reply</button>
                    {mine && m.type === 'text' && (
                      <>
                        <button onClick={() => { setEditingId(m.id); setEditBody(m.body ?? '') }} className="hover:underline">Edit</button>
                        <button onClick={() => softDelete(m)} className="hover:underline">Delete</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {replyTo && (
        <p className="text-xs text-gray-500">Replying is set in composer below — <button className="underline" onClick={() => onReply(null)}>cancel</button></p>
      )}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="full" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
      </div>
    </div>
  )
}
