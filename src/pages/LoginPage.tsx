import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidEmail } from '../lib/username'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const cleanEmail = email.trim().toLowerCase()
    if (!isValidEmail(cleanEmail)) {
      setError('Enter a valid email address')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })
      if (error) throw error
      navigate('/')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      if (msg.toLowerCase().includes('not confirmed') || msg.toLowerCase().includes('confirm')) {
        setError(
          'Email not confirmed. In Supabase: Auth > Sign In/Up > disable "Confirm email", then sign up with a fresh account (old unconfirmed accounts stay blocked until confirmed or deleted in Auth > Users).',
        )
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <div className="flex items-center gap-3">
          <img src="/logo.jpg" alt="Substack Connect" className="w-12 h-12 rounded-full object-cover" />
          <div>
            <h1 className="text-xl font-bold">substack <span className="text-brand-500">connect</span></h1>
            <p className="text-sm text-gray-500">Welcome back</p>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input className="w-full border rounded-lg px-3 py-2" type="email" placeholder="email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2 font-medium disabled:opacity-50">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-sm text-center">No account? <Link className="text-brand-600 underline" to="/signup">Sign up</Link></p>
      </form>
    </div>
  )
}
