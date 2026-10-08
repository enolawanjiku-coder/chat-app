import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'

export default function JoinPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.userId)
  const setActiveId = useChatStore((s) => s.setActiveConversationId)
  const [status, setStatus] = useState('Joining…')

  useEffect(() => {
    const join = async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) {
        navigate(`/login?next=/join/${id}`)
        return
      }
      if (!id || !userId) return
      const { error } = await supabase.from('conversation_members').insert({ conversation_id: id, user_id: userId, role: 'member' })
      if (error && !error.message.toLowerCase().includes('duplicate') && error.code !== '23505') {
        setStatus(`Could not join: ${error.message}`)
        return
      }
      setActiveId(id)
      navigate('/')
    }
    join()
  }, [id, userId, navigate, setActiveId])

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow p-6 text-center space-y-3">
        <p className="text-sm">{status}</p>
        <Link to="/" className="text-sm text-brand-600 underline">Back to chats</Link>
      </div>
    </div>
  )
}
