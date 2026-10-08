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
    supabase.from('conversations').select('*').eq('id', activeId).maybeSingle().then(({ data }) => {
      setActiveConv(data as Conversation | null)
    })
  }, [activeId, refreshKey])

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
                <MessageList messages={messages} onLoadMore={loadMore} hasMore={hasMore} loadingMore={loadingMore} replyTo={replyTo} onReply={setReplyTo} />
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
