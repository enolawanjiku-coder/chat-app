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
        setError('Email not confirmed. Ask the admin to disable "Confirm email" in Supabase Auth, then sign up fresh.')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-brand-600">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6 sm:p-8 space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          <img src="/logo.jpg" alt="Substack Connect" className="w-20 h-20 rounded-full object-cover shadow" />
          <h1 className="text-2xl font-bold tracking-tight">substack <span className="text-brand-500">connect</span></h1>
          <p className="text-sm text-gray-500">Fast, simple, private messaging</p>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <input className="w-full border border-black/10 rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-brand-200" type="email" inputMode="email" autoComplete="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border border-black/10 rounded-2xl px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-brand-200" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full bg-brand-500 hover:bg-brand-600 active:scale-[0.99] text-white rounded-2xl py-3 font-semibold disabled:opacity-50 transition">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-sm text-center text-gray-500">No account? <Link className="text-brand-600 font-semibold" to="/signup">Sign up</Link></p>
      </form>
    </div>
  )
}
