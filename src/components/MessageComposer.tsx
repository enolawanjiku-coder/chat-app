import { useEffect, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { Camera, Images, Mic, Plus, SendHorizontal, Sticker, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { playSend } from '../lib/sounds'
import { useAuthStore } from '../store/authStore'
import { useTyping } from '../hooks/useTyping'
import { StickerPicker } from './StickerPicker'
import type { Message } from '../lib/types'

const MAX_VOICE_S = 300 // 5 min cap

function pickMime(): string {
  if (typeof MediaRecorder !== 'undefined') {
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  }
  return ''
}

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
  const [attachOpen, setAttachOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const { sendTyping } = useTyping(conversationId, profile?.username ?? '')

  // voice recording
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const mimeRef = useRef('')

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => {
    recRef.current?.state !== undefined && recRef.current?.state !== 'inactive' && recRef.current?.stop()
    stopTracks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const startRecording = async () => {
    if (!userId || recording) return
    const mime = pickMime()
    if (!mime) {
      alert('Voice recording is not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      mimeRef.current = mime
      const rec = new MediaRecorder(stream, { mimeType: mime })
      recRef.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start()
      setRecording(true)
      setRecSecs(0)
      timerRef.current = window.setInterval(() => {
        setRecSecs((s) => {
          if (s + 1 >= MAX_VOICE_S) void finishRecording(true)
          return s + 1
        })
      }, 1000)
    } catch {
      alert('Could not access the microphone. Check permissions.')
    }
  }

  const cancelRecording = () => {
    recRef.current?.stop()
    recRef.current = null
    chunksRef.current = []
    stopTracks()
    setRecording(false)
  }

  const finishRecording = async (fromTimer = false) => {
    const rec = recRef.current
    if (!rec || !userId) {
      if (!fromTimer) cancelRecording()
      return
    }
    setRecording(false)
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' }))
      }
    })
    rec.stop()
    const blob = await done
    stopTracks()
    recRef.current = null
    if (blob.size < 1000) return // too short, discard
    setSending(true)
    setFailed(false)
    try {
      const ext = mimeRef.current.includes('mp4') ? 'm4a' : 'webm'
      const path = `${conversationId}/${crypto.randomUUID()}.${ext}`
      const { error: upError } = await supabase.storage.from('chat-images').upload(path, blob, {
        contentType: mimeRef.current,
      })
      if (upError) throw upError
      const { error: msgError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userId,
        type: 'audio',
        audio_path: path,
        reply_to: replyTo?.id ?? null,
      })
      if (msgError) throw msgError
      onReply(null)
      onSent()
      playSend()
    } catch (err) {
      setFailed(true)
      alert(err instanceof Error ? err.message : 'Voice note failed to send')
    } finally {
      setSending(false)
    }
  }

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

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
      {stickersOpen && (
        <div className="mx-1 mb-1.5">
          <StickerPicker conversationId={conversationId} onSent={() => { onSent(); setStickersOpen(false) }} />
        </div>
      )}      {replyTo && (
        <div className="mx-1 mb-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-zinc-300 bg-white dark:bg-[#0b141a] rounded-xl border-l-4 border-brand-500 flex justify-between items-center">
          <span className="truncate">Replying to: {replyTo.type === 'image' ? 'Photo' : replyTo.type === 'audio' ? 'Voice note' : replyTo.type === 'sticker' ? 'Sticker' : (replyTo.body ?? '').slice(0, 80)}</span>
          <button onClick={() => onReply(null)} aria-label="Cancel reply" className="ml-2 text-gray-400 flex items-center"><X className="w-4 h-4" /></button>
        </div>
      )}
      {failed && (
        <p className="text-xs text-red-600 px-3 pb-1">Couldn't send <button className="underline font-semibold" onClick={() => setFailed(false)}>dismiss</button></p>
      )}
      {!navigator.onLine && <p className="text-xs text-amber-700 bg-amber-50 px-3 py-1 rounded-lg mb-1.5">Offline — messages will send when reconnected</p>}
      {recording ? (
        <div className="flex items-center gap-2 p-1">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-sm font-mono text-gray-700 dark:text-zinc-200">{fmtTime(recSecs)}</span>
          <span className="flex-1 flex items-center gap-0.5 h-6 overflow-hidden" aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
              <span key={i} className="w-1 rounded bg-brand-400 animate-pulse" style={{ height: `${8 + ((i * 7 + recSecs * 3) % 16)}px`, animationDelay: `${i * 0.08}s` }} />
            ))}
          </span>
          <button onClick={cancelRecording} aria-label="Discard" className="w-11 h-11 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-500">
            <Trash2 className="w-5 h-5" />
          </button>
          <button
            onClick={() => finishRecording()}
            disabled={sending}
            aria-label="Send voice note"
            className="w-11 h-11 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center shadow active:scale-95 disabled:opacity-40"
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      ) : (
      <form onSubmit={sendText} className="flex items-end gap-1.5 min-w-0">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setAttachOpen((o) => !o)}
            aria-label="Attach photo"
            title="Send photo"
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-500 dark:text-zinc-300"
          >
            <Plus className="w-6 h-6" />
          </button>
          {attachOpen && (
            <div className="absolute bottom-12 left-0 bg-white dark:bg-zinc-800 shadow-xl rounded-2xl p-1.5 w-48 z-20 border border-black/5 dark:border-white/10">
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-sm dark:text-zinc-100">
                <Camera className="w-5 h-5 text-brand-500" /> Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    setAttachOpen(false)
                    if (f) void sendImage(f)
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-sm dark:text-zinc-100">
                <Images className="w-5 h-5 text-brand-500" /> Gallery
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    setAttachOpen(false)
                    if (f) void sendImage(f)
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => { setStickersOpen(true); setAttachOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-sm dark:text-zinc-100"
              >
                <Sticker className="w-5 h-5 text-brand-500" /> Stickers
              </button>
            </div>
          )}
        </div>
        <input
          className="min-w-0 flex-1 rounded-full px-4 py-2.5 text-[16px] sm:text-[15px] outline-none bg-white dark:bg-[#2a3942] text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 shadow-sm"
          placeholder="Message"
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            sendTyping()
          }}
        />
        {!body.trim() && (
          <button
            type="button"
            onClick={startRecording}
            aria-label="Record voice note"
            title="Voice note"
            className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-500 dark:text-zinc-300"
          >
            <Mic className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => { setStickersOpen((o) => !o); setAttachOpen(false) }}
          aria-label="Stickers"
          title="Stickers"
          className={`hidden sm:flex w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 items-center justify-center ${stickersOpen ? 'text-brand-500' : 'text-gray-500 dark:text-zinc-300'}`}
        >
          <Sticker className="w-5 h-5" />
        </button>
        <button
          type="submit"
          disabled={sending || !body.trim()}
          aria-label="Send"
          className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center shadow disabled:opacity-40 active:scale-95 transition"
        >
          {sending ? <span className="typing-dots"><span>•</span></span> : <SendHorizontal className="w-5 h-5" />}
        </button>
      </form>
      )}
    </div>
  )
}
