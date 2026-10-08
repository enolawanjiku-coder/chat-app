import { useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useTyping } from '../hooks/useTyping'
import type { Message } from '../lib/types'

export function MessageComposer({
  conversationId,
  replyTo,
  onReply,
  onSent,
}: {
  conversationId: string
  replyTo: Message | null
  onReply: (m: Message | null) => void
  onSent: () => void
}) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const { sendTyping } = useTyping(conversationId, profile?.username ?? '')

  const sendText = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim() || !userId) return
    setSending(true)
    setFailed(false)
    // optimistic: realtime INSERT will reconcile; on error show retry
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      type: 'text',
      body: body.trim().slice(0, 4000),
      reply_to: replyTo?.id ?? null,
    })
    setSending(false)
    if (!error) {
      setBody('')
      onReply(null)
      onSent()
    } else {
      setFailed(true)
    }
  }

  const sendImage = async (file: File) => {
    if (!userId) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Only jpeg/png/webp allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Max 5MB before compression')
      return
    }
    setSending(true)
    setFailed(false)
    try {
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 1600,
        maxSizeMB: 0.3,
        useWebWorker: true,
      })
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`
      const { error: upError } = await supabase.storage.from('chat-images').upload(path, compressed)
      if (upError) throw upError
      const { error: msgError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userId,
        type: 'image',
        image_path: path,
        reply_to: replyTo?.id ?? null,
      })
      if (msgError) throw msgError
      onReply(null)
      onSent()
    } catch (err) {
      setFailed(true)
      alert(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t bg-white">
      {replyTo && (
        <div className="px-4 py-1 text-xs text-gray-600 bg-gray-50 border-b flex justify-between">
          <span>Replying to: {replyTo.type === 'image' ? '📷 Photo' : (replyTo.body ?? '').slice(0, 80)}</span>
          <button onClick={() => onReply(null)} className="underline">✕</button>
        </div>
      )}
      {failed && <p className="text-xs text-red-600 px-4 pt-1">Message failed to send <button className="underline" onClick={() => setFailed(false)}>Retry</button></p>}
      {!navigator.onLine && <p className="text-xs text-amber-700 bg-amber-50 px-4 py-1">Offline — messages will send when reconnected</p>}
      <form onSubmit={sendText} className="flex items-center gap-2 p-3">
        <label className="cursor-pointer text-xl" title="Send photo">
          📎
          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void sendImage(f)
          }} />
        </label>
        <input
          className="flex-1 border rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-brand-100"
          placeholder="Type a message…"
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            sendTyping()
          }}
        />
        <button disabled={sending || !body.trim()} className="bg-brand-500 text-white rounded-full w-10 h-10 disabled:opacity-40">
          {sending ? '…' : '➤'}
        </button>
      </form>
    </div>
  )
}
