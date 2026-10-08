import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useMessages } from '../hooks/useMessages'
import { useTyping } from '../hooks/useTyping'
import { usePresence } from '../hooks/usePresence'
import { useSession } from '../hooks/useSession'
import { isValidUsername, normalizeUsername } from '../lib/username'
import type { Conversation, Message } from '../lib/types'
import { ConversationList } from '../components/ConversationList'
import { MessageList } from '../components/MessageList'
import { MessageComposer } from '../components/MessageComposer'
import { NewChatDialog } from '../components/NewChatDialog'
import { GroupInfo } from '../components/GroupInfo'

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
        if (other) {
          const { data: p } = await supabase.from('profiles').select('username, display_name').eq('id', other).maybeSingle()
          if (p) conv.name = (p as { display_name: string | null; username: string }).display_name || `@${(p as { username: string }).username}`
        }
      }
      setActiveConv(conv)
    }
    loadTitle()
  }, [activeId, refreshKey, userId])

  // mark read + bump list
  useEffect(() => {
    if (!activeId || !userId) return
    supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', activeId).eq('user_id', userId).then(() => setRefreshKey((k) => k + 1))
  }, [activeId, userId, messages.length])

  // bump list on any incoming realtime message
  useEffect(() => {
    const channel = supabase.channel('chat-page-bump').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      setRefreshKey((k) => k + 1)
    })
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // browser notifications for incoming messages while tab hidden
  const [notifOn, setNotifOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const [search, setSearch] = useState('')
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

  return (
    <div className="h-full flex flex-col max-w-6xl mx-auto bg-white shadow">
      <header className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <div className="flex items-center gap-2">
          <img src="/logo.jpg" className="w-9 h-9 rounded-full object-cover" alt="logo" />
          <h1 className="font-bold">substack <span className="text-brand-500">connect</span></h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button onClick={enableNotif} title="Browser notifications" className="text-lg">{notifOn ? '🔔' : '🔕'}</button>
          <Link to="/profile" className="text-gray-600 underline">@{profile?.username ?? '…'}</Link>
          <button onClick={logout} className="border rounded-lg px-3 py-1">Logout</button>
        </div>
      </header>
      {!isOnline && <div className="bg-amber-100 text-amber-900 text-xs px-4 py-2 text-center">Offline — reconnecting… messages will sync when back.</div>}
      {userId && !profile && (
        <form onSubmit={completeProfile} className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center gap-2 text-sm">
          <span>Pick a username to finish setup:</span>
          <input className="border rounded-lg px-3 py-1" placeholder="username" value={setupUsername} onChange={(e) => setSetupUsername(e.target.value)} />
          <button className="bg-gray-900 text-white rounded-lg px-3 py-1">Save</button>
          {setupError && <span className="text-red-600">{setupError}</span>}
        </form>
      )}
      <div className="flex-1 flex min-h-0">
        <aside className="w-80 border-r flex flex-col min-h-0">
          <NewChatDialog onCreated={(id) => { setActiveId(id); setRefreshKey((k) => k + 1) }} />
          <div className="flex-1 overflow-y-auto">
            <ConversationList selectedId={activeId} onSelect={setActiveId} refreshKey={refreshKey} />
          </div>
        </aside>
        <main className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-h-0">
            {!activeId ? (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-8 text-center">
                Select a conversation or search a user to start chatting.
              </div>
            ) : (
              <>
                <button onClick={() => setShowInfo((s) => !s)} className="px-4 py-2 border-b text-sm text-gray-700 bg-white text-left hover:bg-gray-50">
                  <span className="font-medium">{activeConv?.name ?? 'Direct chat'}</span>
                  <span className="text-gray-400"> · {onlineIds.length > 0 ? `${onlineIds.length} online` : '● online'} · info ›</span>
                  {typingUsers.length > 0 && <span className="text-brand-600"> · {typingUsers.join(', ')} typing…</span>}
                </button>
                <div className="px-4 py-1 bg-white border-b">
                  <input className="w-full text-sm border rounded-full px-3 py-1 outline-none" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <MessageList messages={visibleMessages} onLoadMore={loadMore} hasMore={hasMore && !search} loadingMore={loadingMore} replyTo={replyTo} onReply={setReplyTo} />
                <MessageComposer conversationId={activeId} replyTo={replyTo} onReply={setReplyTo} onSent={() => setRefreshKey((k) => k + 1)} />
              </>
            )}
          </div>
          {showInfo && activeConv && (
            <GroupInfo conversation={activeConv} onClose={() => setShowInfo(false)} onChanged={() => { setRefreshKey((k) => k + 1); setActiveId(null) }} />
          )}
        </main>
      </div>
    </div>
  )
}
