import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useScreenShare, type UseScreenShare } from '../hooks/useScreenShare'

type ScreenShareContextValue = UseScreenShare & { peerName: string }

const ScreenShareContext = createContext<ScreenShareContextValue | null>(null)

export function useScreenShareCtx(): ScreenShareContextValue {
  const ctx = useContext(ScreenShareContext)
  if (!ctx) throw new Error('useScreenShareCtx must be used inside <ScreenShareProvider>')
  return ctx
}

export function ScreenShareProvider({
  conversationId,
  peerId,
  peerName,
  enabled,
  children,
}: {
  conversationId: string | null
  peerId: string | null
  peerName: string
  enabled: boolean
  children: ReactNode
}) {
  const share = useScreenShare(conversationId, peerId, enabled)
  const value = useMemo<ScreenShareContextValue>(() => ({ ...share, peerName }), [share, peerName])
  return <ScreenShareContext.Provider value={value}>{children}</ScreenShareContext.Provider>
}
