const SESSION_RE = /[?&]screen=([0-9a-fA-F-]{36})/

function appBase(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  return typeof window !== 'undefined' ? window.location.origin : ''
}

export function buildScreenShareUrl(conversationId: string, sessionId: string): string {
  return `${appBase()}/?conv=${conversationId}&screen=${sessionId}`
}

export function buildScreenShareMessage(conversationId: string, sessionId: string): string {
  return `I'm sharing my screen. Tap to watch: ${buildScreenShareUrl(conversationId, sessionId)}`
}

export function findScreenShareSession(text: string | null | undefined): string | null {
  if (!text) return null
  const match = text.match(SESSION_RE)
  return match ? match[1] : null
}
