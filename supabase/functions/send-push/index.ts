// Supabase Edge Function: delivers a Web Push notification when a message is
// inserted. Triggered by a Database Webhook on `public.messages` (INSERT).
//
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//            VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=...
// The function also has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY injected by default.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

function preview(record: { type?: string; body?: string | null }): string {
  if (record.type === 'image') return 'Photo'
  if (record.type === 'audio') return 'Voice note'
  if (record.type === 'sticker') return 'Sticker'
  return (record.body ?? 'New message').slice(0, 120)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response('VAPID keys are not configured', { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const record = (payload?.record ?? payload) as
    | { conversation_id?: string; sender_id?: string; type?: string; body?: string | null }
    | null
  const conversationId = record?.conversation_id
  const senderId = record?.sender_id
  if (!conversationId || !senderId) return new Response('ignored', { status: 200 })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: members } = await admin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
  const recipients = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== senderId)
  if (recipients.length === 0) return new Response('no recipients', { status: 200 })

  const [{ data: subs }, { data: sender }] = await Promise.all([
    admin.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', recipients),
    admin.from('profiles').select('display_name, username').eq('id', senderId).maybeSingle(),
  ])
  if (!subs || subs.length === 0) return new Response('no subscriptions', { status: 200 })

  const title = sender?.display_name || (sender?.username ? `@${sender.username}` : 'New message')
  const body = JSON.stringify({
    title,
    body: preview(record ?? {}),
    url: `/?conv=${conversationId}`,
    tag: conversationId,
  })

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        .catch(async (err) => {
          const status = (err as { statusCode?: number })?.statusCode
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          }
          throw err
        }),
    ),
  )

  return new Response(
    JSON.stringify({ sent: results.filter((r) => r.status === 'fulfilled').length, total: results.length }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
})
