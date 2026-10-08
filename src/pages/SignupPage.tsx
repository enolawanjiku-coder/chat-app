import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isValidEmail, isValidUsername, normalizeUsername } from '../lib/username'

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const cleanEmail = email.trim().toLowerCase()
    const uname = normalizeUsername(username)
    if (!isValidEmail(cleanEmail)) {
      setError('Enter a valid email address')
      return
    }
    if (!isValidUsername(uname)) {
      setError('Username must be 3-20 chars: a-z, 0-9, _')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { username: uname, display_name: displayName || uname },
        },
      })
      if (signUpError) throw signUpError
      const userId = data.user?.id
      if (!userId) throw new Error('Signup failed, try logging in')

      // Confirm Email ON → no session yet. DB trigger creates the profile;
      // user completes login after confirming (or if you disable Confirm Email, instant).
      if (!data.session) {
        setInfo('Account created! If email confirmation is ON, check your inbox, then log in. If OFF, just log in now.')
        return
      }

      // Confirm Email OFF → we have a session, ensure profile exists (trigger may have made it)
      const { error: profileError } = await supabase.from('profiles').upsert(
        {
          id: userId,
          username: uname,
          display_name: displayName || uname,
        },
        { onConflict: 'id' },
      )
      if (profileError) {
        if (profileError.message.includes('duplicate') || profileError.code === '23505') {
          throw new Error('Username already taken — try logging in instead.')
        }
        throw profileError
      }
      navigate('/')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signup failed'
      if (msg.toLowerCase().includes('rate limit')) {
        setError(
          'Email rate limit exceeded — too many signups in a short time. Wait 5–15 min, then try again with one click. To stop this permanently: Supabase > Auth > disable "Confirm email" so no signup email is sent.',
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
            <p className="text-sm text-gray-500">Create your account</p>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">{info}</p>}
        <input className="w-full border rounded-lg px-3 py-2" type="email" placeholder="email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2" placeholder="username (a-z 0-9 _)" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2" placeholder="display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input className="w-full border rounded-lg px-3 py-2" type="password" placeholder="password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2 font-medium disabled:opacity-50">
          {busy ? 'Creating…' : 'Sign up'}
        </button>
        <p className="text-sm text-center">Have an account? <Link className="text-brand-600 underline" to="/login">Log in</Link></p>
      </form>
    </div>
  )
}
