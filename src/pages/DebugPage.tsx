import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function DebugPage() {
  const [out, setOut] = useState<string[]>([])
  const [testEmail, setTestEmail] = useState('')

  const log = (s: string) => setOut((p) => [...p, s])

  const run = async () => {
    setOut([])
    log(`VITE_SUPABASE_URL set: ${!!import.meta.env.VITE_SUPABASE_URL}`)
    log(`VITE_SUPABASE_ANON_KEY set: ${!!import.meta.env.VITE_SUPABASE_ANON_KEY}`)
    log(`URL value: ${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.slice(0, 40) ?? '(empty)'}`)

    try {
      const { data: session } = await supabase.auth.getSession()
      log(`session: ${session.session ? `yes (${session.session.user.email})` : 'no'}`)
    } catch (e) {
      log(`session error: ${e instanceof Error ? e.message : e}`)
    }

    for (const table of ['profiles', 'conversations', 'conversation_members', 'messages']) {
      try {
        const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true })
        log(`${table}: ${error ? `ERROR ${error.message}` : `OK count=${count}`}`)
      } catch (e) {
        log(`${table}: EXCEPTION ${e instanceof Error ? e.message : e}`)
      }
    }

    try {
      const { data, error } = await supabase.rpc('create_direct_conversation', { other_user: '00000000-0000-0000-0000-000000000000' })
      log(`RPC create_direct_conversation reachable: ${error ? `ERROR ${error.message}` : `OK ${data}`}`)
    } catch (e) {
      log(`RPC exception: ${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">Debug — copy this output to error.txt</h1>
      <button onClick={run} className="bg-gray-900 text-white rounded px-4 py-2">Run checks</button>
      <div className="flex gap-2">
        <input className="flex-1 border rounded px-3 py-1 text-sm" placeholder="fresh-test-email@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
        <button
          onClick={async () => {
            log(`--- signup test: ${testEmail} ---`)
            const { data, error } = await supabase.auth.signUp({
              email: testEmail.trim(),
              password: 'Test1234!',
            })
            log(`error: ${error?.message ?? '(none)'}`)
            log(`user: ${data.user?.id ?? '(none)'}`)
            log(`session: ${data.session ? 'yes' : 'no (Confirm Email is ON or rate limited)'}`)
          }}
          className="border rounded px-3 py-1 text-sm"
        >
          Test signup
        </button>
      </div>
      <pre className="bg-black text-green-300 text-xs p-4 rounded whitespace-pre-wrap">{out.join('\n') || 'Click Run checks'}</pre>
    </div>
  )
}
