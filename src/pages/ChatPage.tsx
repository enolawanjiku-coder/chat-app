import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useMessages } from '../hooks/useMessages'
import { useTyping } from '../hooks/useTyping'
import { usePresence } from '../hooks/usePresence'
import { useSession } from '../hooks/useSession'
import { useCalls } from '../hooks/useCalls'
import { isMuted, playPop, playTick, setMuted } from '../lib/sounds'
import { isValidUsername, normalizeUsername } from '../lib/username'
import { WALLPAPERS, getWallpaper, setWallpaper, wallpaperSrc } from '../lib/wallpapers'
import type { Conversation, Message } from '../lib/types'
import { ConversationList } from '../components/ConversationList'
import { MessageList } from '../components/MessageList'
import { MessageComposer } from '../components/MessageComposer'
import { NewChatDialog } from '../components/NewChatDialog'
import { GroupInfo } from '../components/GroupInfo'
import { StatusRow } from '../components/StatusRow'
import { CallOverlay } from '../components/CallOverlay'

export default function ChatPage() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const clear = useAuthStore((s) => s.clear)
  const activeId = useChatStore((s) => s.activeConversationId)
  const setActiveId = useChatStore((s) => s.setActiveConversationId)
  useSession()
  const { messages, loadMore, loadingMore, hasMore } = useMessages(activeId)
  const { typingUsers } = useTyping(activeId, profile?.username ?? '')
  const { onlineIds } = usePresence(activeId)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [setupUsername, setSetupUsername] = useState('')
  const [setupError, setSetupError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [dark, setDark] = useState(() => localStorage.getItem('sc-theme') === 'dark')
  const [search, setSearch] = useState('')
  const [otherUserId, setOtherUserId] = useState<string | null>(null)
  const [notifOn, setNotifOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const [muted, setMutedState] = useState(isMuted())
  const { incoming, active, callError, startCall, acceptCall, declineCall, endCall } = useCalls()
  const prevMsgCount = useRef(0)

  const toggleSound = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  // incoming message pop + typing tick
  useEffect(() => {
    if (messages.length > prevMsgCount.current && prevMsgCount.current > 0) {
      const last = messages[messages.length - 1]
      if (last.sender_id !== userId && !last.deleted_at) playPop()
    }
    prevMsgCount.current = messages.length
  }, [messages, userId])
  const prevTyping = useRef(0)
  useEffect(() => {
    if (typingUsers.length > 0 && prevTyping.current === 0) playTick()
    prevTyping.current = typingUsers.length
  }, [typingUsers])
  const [wallpaperId, setWallpaperId] = useState(getWallpaper)
  const [showWallpapers, setShowWallpapers] = useState(false)

  const pickWallpaper = (id: string) => {
    setWallpaper(id)
    setWallpaperId(id)
    setShowWallpapers(false)
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('sc-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate('/login')
    })
  }, [navigate])

  useEffect(() => {
    if (!activeId) {
      setActiveConv(null)
      return
    }
    const loadTitle = async () => {
      const { data } = await supabase.from('conversations').select('*').eq('id', activeId).maybeSingle()
      const conv = data as Conversation | null
      if (!conv) {
        setActiveConv(null)
        return
      }
      if (conv.type === 'direct' && !conv.name) {
        const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', activeId)
        const other = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).find((uid) => uid !== userId)
        setOtherUserId(other ?? null)
        if (other) {
          const { data: p } = await supabase.from('profiles').select('username, display_name').eq('id', other).maybeSingle()
          if (p) conv.name = (p as { display_name: string | null; username: string }).display_name || `@${(p as { username: string }).username}`
        }
      } else {
        setOtherUserId(null)
      }
      setActiveConv(conv)
    }
    loadTitle()
  }, [activeId, refreshKey, userId])

  useEffect(() => {
    if (!activeId || !userId) return
    supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', activeId).eq('user_id', userId).then(() => setRefreshKey((k) => k + 1))
  }, [activeId, userId, messages.length])

  useEffect(() => {
    const channel = supabase.channel('chat-page-bump').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      setRefreshKey((k) => k + 1)
    })
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!notifOn || !document.hidden || messages.length === 0) return
    const last = messages[messages.length - 1]
    if (last.sender_id === userId || last.deleted_at) return
    new Notification('Substack Connect', { body: last.type === 'image' ? '📷 New photo' : (last.body ?? 'New message').slice(0, 120) })
  }, [messages, notifOn, userId])

  const enableNotif = async () => {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifOn(perm === 'granted')
  }

  const visibleMessages = search.trim()
    ? messages.filter((m) => (m.body ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    : messages

  const completeProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSetupError(null)
    const uname = normalizeUsername(setupUsername)
    if (!isValidUsername(uname)) {
      setSetupError('Username must be 3-20 chars: a-z, 0-9, _')
      return
    }
    if (!userId) return
    const { error } = await supabase.from('profiles').insert({ id: userId, username: uname, display_name: uname })
    if (error) {
      setSetupError(error.message)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    useAuthStore.getState().setAuth(userId, data)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
  }

  // mobile: show list OR chat; desktop: both
  const showChatOnMobile = !!activeId

  return (
    <div className="h-dvh flex flex-col bg-[#e9e4dc] dark:bg-[#0b141a]">
      {/* top bar */}
      <header className="flex items-center justify-between pl-3 pr-2 py-2 bg-brand-600 text-white shadow-md z-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.jpg" className="w-9 h-9 rounded-full object-cover bg-white" alt="logo" />
          <h1 className="font-bold text-[17px] truncate">substack <span className="font-light">connect</span></h1>
        </div>
        <div className="flex items-center gap-0.5 text-white">
          <button onClick={() => setDark((d) => !d)} title="Dark mode" className="w-10 h-10 rounded-full hover:bg-white/10 text-lg">{dark ? '☀️' : '🌙'}</button>
          <button onClick={toggleSound} title="Sounds" className="w-10 h-10 rounded-full hover:bg-white/10 text-lg">{muted ? '🔇' : '🔊'}</button>
          <div className="relative">
            <button onClick={() => setShowWallpapers((s) => !s)} title="Chat wallpaper" className="w-10 h-10 rounded-full hover:bg-white/10 text-lg">🎨</button>
            {showWallpapers && (
              <div className="absolute right-0 top-11 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl p-2 grid grid-cols-2 gap-2 w-44 z-30">
                {WALLPAPERS.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => pickWallpaper(w.id)}
                    className={`rounded-xl overflow-hidden border-2 text-left ${wallpaperId === w.id ? 'border-brand-500' : 'border-transparent'}`}
                  >
                    {w.src ? (
                      <img src={w.src} alt={w.label} className="w-full h-16 object-cover" />
                    ) : (
                      <span className="block w-full h-16 chat-wallpaper" />
                    )}
                    <span className="block text-[11px] text-gray-600 dark:text-zinc-300 px-1.5 py-1">{w.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={enableNotif} title="Notifications" className="w-10 h-10 rounded-full hover:bg-white/10 text-lg">{notifOn ? '🔔' : '🔕'}</button>
          <Link to="/profile" title="Profile" className="h-10 px-2 rounded-full hover:bg-white/10 flex items-center text-sm font-medium max-w-28 truncate">
            @{profile?.username ?? '…'}
          </Link>
          <button onClick={logout} title="Logout" className="w-10 h-10 rounded-full hover:bg-white/10 text-lg">⎋</button>
        </div>
      </header>

      {!isOnline && <div className="bg-amber-400 text-amber-950 text-xs px-4 py-1.5 text-center font-medium shrink-0">Offline — reconnecting…</div>}
      {userId && !profile && (
        <form onSubmit={completeProfile} className="bg-sky-100 dark:bg-sky-950 px-4 py-2.5 flex items-center gap-2 text-sm shrink-0">
          <span className="dark:text-zinc-200">Pick a username:</span>
          <input className="border rounded-full px-3 py-1 text-sm flex-1 min-w-0 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white" placeholder="username" value={setupUsername} onChange={(e) => setSetupUsername(e.target.value)} />
          <button className="bg-brand-600 text-white rounded-full px-4 py-1 font-medium shrink-0">Save</button>
          {setupError && <span className="text-red-600">{setupError}</span>}
        </form>
      )}

      <div className="flex-1 flex min-h-0 max-w-6xl w-full mx-auto md:p-3 md:gap-3">
        {/* conversation list pane */}
        <aside className={`${showChatOnMobile ? 'hidden' : 'flex'} md:flex flex-col min-h-0 flex-1 md:flex-none md:w-[340px] bg-white dark:bg-[#111b21] md:rounded-2xl md:shadow overflow-hidden`}>
          <NewChatDialog onCreated={(id) => { setActiveId(id); setRefreshKey((k) => k + 1) }} />
          <StatusRow onChanged={() => {}} />
          <div className="flex-1 overflow-y-auto nice-scroll">
            <ConversationList selectedId={activeId} onSelect={setActiveId} refreshKey={refreshKey} />
          </div>
        </aside>

        {/* chat pane */}
        <main className={`${showChatOnMobile ? 'flex' : 'hidden'} md:flex flex-1 min-h-0 min-w-0`}>
          <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#efeae2] dark:bg-[#0b141a] md:rounded-2xl md:shadow overflow-hidden">
            {!activeId ? (
              <div className="hidden md:flex flex-1 flex-col items-center justify-center text-center p-8 chat-wallpaper">
                <img src="/logo.jpg" className="w-20 h-20 rounded-full object-cover mb-3 shadow" alt="" />
                <p className="font-bold text-lg text-gray-700 dark:text-zinc-200">Substack Connect</p>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1 max-w-xs">Select a conversation or search a username to start messaging.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-0.5 px-1 py-1 bg-[#f0f2f5] dark:bg-[#1f2c34] shrink-0">
                  <button onClick={() => setShowInfo((s) => !s)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    <span onClick={(e) => { e.stopPropagation(); setActiveId(null) }} className="md:hidden w-9 h-9 flex items-center justify-center text-xl text-gray-600 dark:text-zinc-300 shrink-0" aria-label="Back">←</span>
                    <span className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
                      {(activeConv?.name ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-[15px] truncate text-gray-900 dark:text-zinc-100">{activeConv?.name ?? '…'}</span>
                      <span className="block text-xs text-gray-500 dark:text-zinc-400 truncate">
                        {typingUsers.length > 0 ? <span className="text-brand-600 font-medium typing-dots">{typingUsers.join(', ')} typing<span>•</span><span>•</span><span>•</span></span> : onlineIds.length > 0 ? `${onlineIds.length} online` : 'tap for info'}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => activeId && startCall(activeId, activeConv?.name ?? 'Chat', false, otherUserId)}
                    title="Voice call"
                    className="w-10 h-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-xl shrink-0"
                  >📞</button>
                  <button
                    onClick={() => activeId && startCall(activeId, activeConv?.name ?? 'Chat', true, otherUserId)}
                    title="Video call"
                    className="w-10 h-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-xl shrink-0"
                  >🎥</button>
                </div>
                <div className="px-3 py-1 bg-[#f0f2f5] dark:bg-[#1f2c34] shrink-0">
                  <input className="w-full text-sm rounded-full px-3.5 py-1.5 outline-none bg-white dark:bg-[#2a3942] dark:text-zinc-100 placeholder:text-gray-400" placeholder="🔍 Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <MessageList messages={visibleMessages} onLoadMore={loadMore} hasMore={hasMore && !search} loadingMore={loadingMore} replyTo={replyTo} onReply={setReplyTo} wallpaper={wallpaperSrc(wallpaperId)} />
                <MessageComposer conversationId={activeId} replyTo={replyTo} onReply={setReplyTo} onSent={() => setRefreshKey((k) => k + 1)} />
              </>
            )}
          </div>
          {showInfo && activeConv && (
            <div className={`${showChatOnMobile ? 'hidden md:block' : 'block'} shrink-0`}>
              <GroupInfo conversation={activeConv} onClose={() => setShowInfo(false)} onChanged={() => { setRefreshKey((k) => k + 1); setActiveId(null) }} />
            </div>
          )}
        </main>
      </div>
      {callError && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm rounded-full px-4 py-2 shadow-lg z-40">
          {callError}
        </div>
      )}
      <CallOverlay incoming={incoming} active={active} onAccept={acceptCall} onDecline={declineCall} onEnd={() => endCall()} />
    </div>
  )
}
