import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, ListMusic, Loader2, Lock, MonitorPlay, Pause, Phone, Play } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'
import { useAuthStore } from '../store/authStore'
import { findYouTubeLink, youTubeThumbnail, type YouTubeLink } from '../lib/youtube'
import { buildScreenShareUrl, findScreenShareSession } from '../lib/screenShare'
import { MessageReactions } from './MessageReactions'
import { useMusic } from './MusicProvider'

function ScreenShareCard({ conversationId, sessionId }: { conversationId: string; sessionId: string }) {
  return (
    <div className="my-1 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
      <div className="flex items-center gap-2 p-2">
        <span className="w-10 h-10 rounded-full shrink-0 bg-brand-500/15 text-brand-600 flex items-center justify-center">
          <MonitorPlay className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-gray-800 dark:text-zinc-200">Live screen share</p>
          <p className="text-[11px] text-gray-400 truncate">Open this chat to receive the invite</p>
        </div>
        <a
          href={buildScreenShareUrl(conversationId, sessionId)}
          className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-white bg-brand-500 rounded-full px-3 py-1.5"
        >
          <MonitorPlay className="w-3.5 h-3.5" />
          Join
        </a>
      </div>
    </div>
  )
}

function YouTubeCard({ link }: { link: YouTubeLink }) {
  const music = useMusic()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isActive =
    (!!link.videoId && music.state.videoId === link.videoId) ||
    (!!link.playlistId && music.state.playlistId === link.playlistId)

  const start = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await music.startFromLink(link)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not play that link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-1 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
      <div className="flex items-center gap-2 p-2">
        {link.videoId ? (
          <img src={youTubeThumbnail(link.videoId)} alt="" loading="lazy" className="w-20 h-11 rounded object-cover shrink-0 bg-black/20" />
        ) : (
          <span className="w-20 h-11 rounded shrink-0 bg-black/20 flex items-center justify-center text-gray-500 dark:text-zinc-400">
            <ListMusic className="w-6 h-6" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate text-gray-800 dark:text-zinc-200">
            {link.playlistId ? 'YouTube playlist' : 'YouTube video'}
          </p>
          <p className="text-[11px] text-gray-400 truncate">{isActive ? 'Playing for everyone' : 'Watch together'}</p>
        </div>
        <button
          onClick={() => void start()}
          disabled={busy}
          className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-white bg-brand-500 disabled:opacity-50 rounded-full px-3 py-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {isActive ? 'Playing' : 'Play'}
        </button>
      </div>
      {err && <p className="px-2 pb-1 text-[11px] text-red-600">{err}</p>}
    </div>
  )
}

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

function AudioBubble({ path, mine }: { path: string; mine: boolean }) {  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    supabase.storage.from('chat-images').createSignedUrl(path, 3600).then(({ data }) => {
      setUrl(data?.signedUrl ?? null)
    })
  }, [path])
  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }
  if (!url) return <div className="w-44 h-10 rounded-full bg-black/10 animate-pulse" />
  return (
    <div className="flex items-center gap-2 py-1 min-w-44">
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${mine ? 'bg-brand-600 text-white' : 'bg-gray-900 dark:bg-zinc-700 text-white'}`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        className="w-36 h-8"
        controls
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}

const SENDER_COLORS = ['text-red-600', 'text-amber-600', 'text-emerald-600', 'text-sky-600', 'text-violet-600']

function senderColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]
}

function StickerView({ message }: { message: Message }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (message.image_path) {
      const { data } = supabase.storage.from('stickers').getPublicUrl(message.image_path)
      setUrl(data.publicUrl)
    }
  }, [message.image_path])
  if (message.image_path) {
    if (!url) return <div className="w-28 h-28 rounded-2xl bg-black/10 animate-pulse" />
    return <img src={url} alt="sticker" className="w-32 h-32 object-contain drop-shadow" />
  }
  return <p className="text-7xl leading-none py-1">{message.body}</p>
}

export function MessageList({
  messages,
  onLoadMore,
  hasMore,
  loadingMore,
  replyTo,
  onReply,
  wallpaper,
  dark,
  peerLastRead,
  peerOnline,
  isDirect,
}: {
  messages: Message[]
  onLoadMore: () => void
  hasMore: boolean
  loadingMore: boolean
  replyTo: Message | null
  onReply: (m: Message | null) => void
  wallpaper: string | null
  dark: boolean
  peerLastRead: string | null
  peerOnline: boolean
  isDirect: boolean
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

  const saveSticker = async (m: Message) => {
    if (!m.image_path || !userId) return
    try {
      // copy the file into my sticker collection (download + re-upload)
      const { data: signed } = await supabase.storage.from('chat-images').createSignedUrl(m.image_path, 60)
      if (!signed?.signedUrl) throw new Error('Could not fetch image')
      const res = await fetch(signed.signedUrl)
      const blob = await res.blob()
      const path = `${userId}/${crypto.randomUUID()}.jpg`
      const { error: upError } = await supabase.storage.from('stickers').upload(path, blob)
      if (upError) throw upError
      const { error: dbError } = await supabase.from('stickers').insert({ user_id: userId, image_path: path })
      if (dbError) throw dbError
      alert('Saved to your stickers')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed')
    }
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
      className={`flex-1 min-h-0 overflow-y-auto nice-scroll ${wallpaper ? '' : 'chat-wallpaper'}`}
      id="message-scroll"
      style={
        wallpaper
          ? {
              // dim baked into the background itself so it covers the whole
              // scroll area — an overlay div would end mid-scroll and split the screen
              backgroundImage: `linear-gradient(${dark ? 'rgba(11,20,26,0.85), rgba(11,20,26,0.85)' : 'rgba(255,255,255,0.82), rgba(255,255,255,0.82)'}), url(${wallpaper})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      <div className="px-3 sm:px-8 py-3 space-y-1">
      {hasMore && (
        <div className="flex justify-center mb-2">
          <button onClick={onLoadMore} disabled={loadingMore} className="text-xs font-medium bg-white dark:bg-zinc-800 shadow rounded-full px-4 py-1.5 text-brand-600 disabled:opacity-40">
            {loadingMore ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex justify-center mt-10">
          <p className="flex items-center justify-center gap-1.5 text-xs text-gray-600 dark:text-zinc-300 bg-[#fdf3c6] dark:bg-zinc-800 rounded-lg px-4 py-2 shadow text-center max-w-xs">
            <Lock className="w-3.5 h-3.5 shrink-0" /> Messages are visible to chat members. Say hi to start the conversation.
          </p>
        </div>
      )}
      {messages.map((m) => {
        const mine = m.sender_id === userId
        const quoted = m.reply_to ? byId.get(m.reply_to) : null
        const yt = m.type === 'text' && !m.deleted_at ? findYouTubeLink(m.body) : null
        const screenSession = m.type === 'text' && !m.deleted_at ? findScreenShareSession(m.body) : null
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
            {m.type === 'system' ? (
              <div className="flex justify-center my-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 shadow rounded-full px-3 py-1">
                  <Phone className="w-3 h-3" /> {m.body}
                </span>
              </div>
            ) : m.type === 'sticker' && !m.deleted_at ? (
              <div className={`flex ${mine ? 'justify-end' : 'justify-start'} group relative`}>
                <StickerView message={m} />
              </div>
            ) : (
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
                    {quoted.deleted_at ? <em className="opacity-60">deleted</em> : quoted.type === 'image' ? 'Photo' : quoted.type === 'audio' ? 'Voice note' : quoted.type === 'sticker' ? 'Sticker' : (quoted.body ?? '').slice(0, 120)}
                  </div>
                )}
                {m.deleted_at ? (
                  <p className="italic opacity-60 text-[13px] px-1 py-0.5">This message was deleted</p>
                ) : editingId === m.id ? (
                  <div className="flex gap-1 py-1">
                    <input autoFocus className="rounded-lg px-2 py-1 text-sm flex-1 text-gray-900 border" value={editBody} onChange={(e) => setEditBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m) }} />
                    <button onClick={() => saveEdit(m)} className="text-xs font-semibold text-brand-600">✓</button>
                  </div>
                ) : m.type === 'image' && m.image_path ? (
                  <div className="py-1"><ImageBubble path={m.image_path} onOpen={setLightbox} /></div>
                ) : m.type === 'audio' && m.audio_path ? (
                  <AudioBubble path={m.audio_path} mine={mine} />
                ) : screenSession ? null : (
                  <p className="whitespace-pre-wrap break-words px-1">{m.body}</p>
                )}
                {!m.deleted_at && screenSession && <ScreenShareCard conversationId={m.conversation_id} sessionId={screenSession} />}
                {!m.deleted_at && yt && <YouTubeCard link={yt} />}
                <div className="flex justify-end items-center gap-1 -mt-0.5">
                  <span className="text-[10px] text-gray-500 dark:text-zinc-400">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {m.edited_at ? ' · edited' : ''}
                  </span>
                  {mine && !m.deleted_at && isDirect && (
                    peerLastRead && peerLastRead >= m.created_at ? (
                      <span title="Read"><CheckCheck className="w-4 h-4 text-sky-500" /></span>
                    ) : peerOnline ? (
                      <span title="Delivered"><CheckCheck className="w-4 h-4 text-gray-400" /></span>
                    ) : (
                      <span title="Sent"><Check className="w-4 h-4 text-gray-400" /></span>
                    )
                  )}
                </div>
                {!m.deleted_at && <MessageReactions messageId={m.id} mine={mine} />}
                {!m.deleted_at && (
                  <div className={`flex gap-3 mt-0.5 pb-0.5 text-[11px] font-medium sm:opacity-0 sm:group-hover:opacity-100 transition ${mine ? 'text-brand-700 dark:text-zinc-300' : 'text-gray-500'}`}>
                    <button onClick={() => onReply(m)} className="hover:underline">Reply</button>
                    {m.type === 'image' && m.image_path && (
                      <button onClick={() => saveSticker(m)} className="hover:underline">Save sticker</button>
                    )}
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
            )}
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
