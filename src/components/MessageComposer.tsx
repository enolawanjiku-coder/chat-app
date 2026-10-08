import { useState } from 'react'
import imageCompression from 'browser-image-compression'
import { Plus, SendHorizontal, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { playSend } from '../lib/sounds'
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
      playSend()
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
      playSend()
    } catch (err) {
      setFailed(true)
      alert(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-[#f0f2f5] dark:bg-[#1f2c34] px-2 sm:px-4 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {replyTo && (
        <div className="mx-1 mb-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#0b141a] rounded-xl border-l-4 border-brand-500 flex justify-between items-center">
          <span className="truncate">Replying to: {replyTo.type === 'image' ? 'Photo' : (replyTo.body ?? '').slice(0, 80)}</span>
          <button onClick={() => onReply(null)} aria-label="Cancel reply" className="ml-2 text-gray-400 flex items-center"><X className="w-4 h-4" /></button>
        </div>
      )}
      {failed && (
        <p className="text-xs text-red-600 px-3 pb-1">Couldn't send <button className="underline font-semibold" onClick={() => setFailed(false)}>dismiss</button></p>
      )}
      {!navigator.onLine && <p className="text-xs text-amber-700 bg-amber-50 px-3 py-1 rounded-lg mb-1.5">Offline — messages will send when reconnected</p>}
      <form onSubmit={sendText} className="flex items-end gap-1.5">
        <label className="cursor-pointer w-11 h-11 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-500 dark:text-zinc-300" title="Send photo">
          <Plus className="w-6 h-6" />
          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void sendImage(f)
            e.target.value = ''
          }} />
        </label>
        <input
          className="flex-1 rounded-full px-4 py-2.5 text-[15px] outline-none bg-white dark:bg-[#2a3942] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 shadow-sm"
          placeholder="Message"
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            sendTyping()
          }}
        />
        <button
          disabled={sending || !body.trim()}
          aria-label="Send"
          className="w-11 h-11 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center shadow disabled:opacity-40 active:scale-95 transition"
        >
          {sending ? <span className="typing-dots"><span>•</span></span> : <SendHorizontal className="w-5 h-5" />}
        </button>
      </form>
    </div>
  )
}
