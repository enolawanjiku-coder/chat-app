import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { Conversation } from '../lib/types'

type Member = { user_id: string; role: string; username?: string; display_name?: string | null; avatar_url?: string | null }

export function GroupInfo({ conversation, onClose, onChanged }: { conversation: Conversation; onClose: () => void; onChanged: () => void }) {
  const userId = useAuthStore((s) => s.userId)
  const [members, setMembers] = useState<Member[]>([])
  const [myRole, setMyRole] = useState<string>('member')
  const [addUsername, setAddUsername] = useState('')
  const [groupName, setGroupName] = useState(conversation.name ?? '')

  const load = async () => {
    const { data } = await supabase.from('conversation_members').select('user_id, role').eq('conversation_id', conversation.id)
    const rows = (data ?? []) as { user_id: string; role: string }[]
    const ids = rows.map((r) => r.user_id)
    const { data: profiles } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    const pmap = new Map((profiles ?? []).map((p) => [p.id, p]))
    setMembers(rows.map((r) => ({ ...r, username: pmap.get(r.user_id)?.username, display_name: pmap.get(r.user_id)?.display_name, avatar_url: pmap.get(r.user_id)?.avatar_url })))
    setMyRole(rows.find((r) => r.user_id === userId)?.role ?? 'member')
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id])

  const isGroup = conversation.type === 'group'
  const canManage = myRole === 'admin'

  const addMember = async () => {
    const q = addUsername.trim().toLowerCase()
    if (!q) return
    const { data: user } = await supabase.from('profiles').select('id').eq('username', q).maybeSingle()
    if (!user) {
      alert('User not found')
      return
    }
    const { error } = await supabase.from('conversation_members').insert({ conversation_id: conversation.id, user_id: user.id, role: 'member' })
    if (error) alert(error.message)
    else {
      setAddUsername('')
      load()
    }
  }

  const removeMember = async (uid: string) => {
    if (!confirm('Remove this member?')) return
    const { error } = await supabase.from('conversation_members').delete().eq('conversation_id', conversation.id).eq('user_id', uid)
    if (error) alert(error.message)
    else load()
  }

  const leave = async () => {
    if (!confirm('Leave this chat?')) return
    await supabase.from('conversation_members').delete().eq('conversation_id', conversation.id).eq('user_id', userId)
    onChanged()
    onClose()
  }

  const saveName = async () => {
    if (!groupName.trim()) return
    const { error } = await supabase.from('conversations').update({ name: groupName.trim() }).eq('id', conversation.id)
    if (error) alert(error.message)
    else onChanged()
  }

  const copyInvite = async () => {
    const link = `${window.location.origin}/join/${conversation.id}`
    try {
      await navigator.clipboard.writeText(link)
      alert('Invite link copied — anyone with the link joins the chat.')
    } catch {
      prompt('Copy this invite link:', link)
    }
  }

  return (
    <div className="p-4 space-y-3 bg-white border-l w-72 overflow-y-auto">
      <div className="flex justify-between items-center">
        <h2 className="font-bold">{isGroup ? 'Group info' : 'Chat info'}</h2>
        <button onClick={onClose} aria-label="Close" className="text-gray-500 flex items-center"><X className="w-5 h-5" /></button>
      </div>
      {isGroup && (
        <div className="flex gap-2">
          <input className="flex-1 border rounded px-2 py-1 text-sm" value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={!canManage} />
          {canManage && <button onClick={saveName} className="text-sm underline">Save</button>}
        </div>
      )}
      <h3 className="text-sm font-medium">Members ({members.length})</h3>
      {members.map((m) => (
        <div key={m.user_id} className="flex justify-between items-center text-sm gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {m.avatar_url ? (
              <img src={m.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
            ) : (
              <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm shrink-0">
                {(m.username ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate">@{m.username ?? m.user_id.slice(0, 6)} <span className="text-gray-400 text-xs">{m.role}</span></span>
          </span>
          {canManage && m.user_id !== userId && (
            <button onClick={() => removeMember(m.user_id)} className="text-red-600 text-xs underline">Remove</button>
          )}
        </div>
      ))}
      {isGroup && canManage && (
        <div className="flex gap-2 pt-2">
          <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="username to add" value={addUsername} onChange={(e) => setAddUsername(e.target.value)} />
          <button onClick={addMember} className="text-sm bg-gray-900 text-white rounded px-2">Add</button>
        </div>
      )}
      <button onClick={leave} className="text-sm text-red-600 underline">Leave chat</button>
      <button onClick={copyInvite} className="text-sm text-brand-600 underline text-left">Copy invite link</button>
    </div>
  )
}
