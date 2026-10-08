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
  if (!url) return <p className="text-xs opacity-70">Loading image…</p>
  return (
    <img
      src={url}
      alt="shared"
      className="rounded-lg max-w-60 max-h-60 object-cover cursor-zoom-in"
      onClick={() => onOpen(url)}
    />
  )
}

export function MessageList({
  messages,
  onLoadMore,
  hasMore,
  loadingMore,
  replyTo,
  onReply,
}: {
  messages: Message[]
  onLoadMore: () => void
  hasMore: boolean
  loadingMore: boolean
  replyTo: Message | null
  onReply: (m: Message | null) => void
}) {
  const userId = useAuthStore((s) => s.userId)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  const byId = new Map(messages.map((m) => [m.id, m]))

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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50" id="message-scroll">
      {hasMore && (
        <button onClick={onLoadMore} disabled={loadingMore} className="mx-auto block text-xs text-brand-600 underline disabled:opacity-40">
          {loadingMore ? 'Loading…' : 'Load older messages'}
        </button>
      )}
      {messages.length === 0 && <p className="text-center text-sm text-gray-500 mt-10">No messages yet. Start the conversation.</p>}
      {messages
        .filter((m) => !m.deleted_at || true)
        .map((m) => {
          const mine = m.sender_id === userId
          const quoted = m.reply_to ? byId.get(m.reply_to) : null
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm group relative ${mine ? 'bg-brand-500 text-white' : 'bg-white shadow'}`}>
                {quoted && (
                  <div className={`text-xs rounded px-2 py-1 mb-1 border-l-2 ${mine ? 'bg-white/20 border-white' : 'bg-gray-100 border-gray-300'}`}>
                    {quoted.deleted_at ? <em>deleted</em> : quoted.type === 'image' ? '📷 Photo' : quoted.body}
                  </div>
                )}
                {m.deleted_at ? (
                  <em className="opacity-70">This message was deleted</em>
                ) : editingId === m.id ? (
                  <div className="flex gap-1">
                    <input className="text-black rounded px-2 py-1 text-sm flex-1" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    <button onClick={() => saveEdit(m)} className="underline text-xs">Save</button>
                  </div>
                ) : m.type === 'image' && m.image_path ? (
                  <ImageBubble path={m.image_path} onOpen={setLightbox} />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
                <p className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {m.edited_at ? ' · edited' : ''}
                </p>
                {!m.deleted_at && <MessageReactions messageId={m.id} mine={mine} />}
                {!m.deleted_at && (
                  <div className={`flex gap-2 mt-1 text-[11px] opacity-0 group-hover:opacity-100 ${mine ? 'text-white/80' : 'text-gray-500'}`}>
                    <button onClick={() => onReply(m)} className="underline">Reply</button>
                    {mine && m.type === 'text' && (
                      <>
                        <button onClick={() => { setEditingId(m.id); setEditBody(m.body ?? '') }} className="underline">Edit</button>
                        <button onClick={() => softDelete(m)} className="underline">Delete</button>
                      </>
                    )}
                    {!mine && <button onClick={() => softDelete(m)} className="hidden" />}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      {replyTo && (
        <p className="text-xs text-gray-500">Replying is set in composer below — <button className="underline" onClick={() => onReply(null)}>cancel</button></p>
      )}
      {lightbox && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="full" className="max-w-[90vw] max-h-[90vh] rounded" />
        </div>
      )}
    </div>
  )
}
