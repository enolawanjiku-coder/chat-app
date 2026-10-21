import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { buildScreenShareMessage } from '../lib/screenShare'
import { useAuthStore } from '../store/authStore'

export type ScreenShareRole = 'sharer' | 'viewer' | null
export type ScreenSharePhase = 'idle' | 'starting' | 'ringing' | 'connecting' | 'live' | 'failed'

export type IncomingShare = {
  sessionId: string
  from: string
  fromName: string
  offer: RTCSessionDescriptionInit
}

type SignalPayload = {
  sessionId?: unknown
  from?: unknown
  to?: unknown
  fromName?: unknown
  sdp?: unknown
  candidate?: unknown
}

// STUN gives us a direct peer-to-peer path in most home/mobile networks.
// A TURN relay can be added later (VITE_TURN_*) for symmetric NAT / strict
// corporate firewalls where a direct path is impossible.
const STUN: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
}

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [STUN]
  const url = import.meta.env.VITE_TURN_URL as string | undefined
  if (url) {
    const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
    const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
    servers.push({ urls: url, username: username || undefined, credential: credential || undefined })
  }
  return servers
}

/**
 * One-to-one screen sharing over WebRTC. Signaling (offer/answer/ICE) is sent on
 * a *private* Supabase Realtime channel `screen:<conversation_id>`; membership is
 * enforced by the `realtime.messages` policies (migration 0014/0016). No media
 * ever touches Supabase, and no stream is captured without the native
 * getDisplayMedia picker.
 */
export function useScreenShare(conversationId: string | null, peerId: string | null, enabled: boolean) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)

  const [role, setRole] = useState<ScreenShareRole>(null)
  const [phase, setPhase] = useState<ScreenSharePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remoteHasAudio, setRemoteHasAudio] = useState(false)
  const [incoming, setIncoming] = useState<IncomingShare | null>(null)
  const [muted, setMuted] = useState(false)
  const [signalStatus, setSignalStatus] = useState<'connecting' | 'ready' | 'error'>('connecting')
  const [sessionId, setSessionId] = useState<string | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionRef = useRef<string | null>(null)
  const pendingJoinRef = useRef<string | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const remoteRef = useRef<MediaStream | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const incomingRef = useRef<IncomingShare | null>(null)
  const mutedRef = useRef(false)
  const mountedRef = useRef(true)
  const stopShareRef = useRef<(() => void) | null>(null)
  const reofferRef = useRef<number | null>(null)
  const lossTimerRef = useRef<number | null>(null)
  const everConnectedRef = useRef(false)

  const userRef = useRef(userId)
  userRef.current = userId
  const peerRef = useRef(peerId)
  peerRef.current = peerId
  const convRef = useRef(conversationId)
  convRef.current = conversationId
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const nameRef = useRef('Someone')
  nameRef.current = profile?.display_name || profile?.username || 'Someone'
  incomingRef.current = incoming
  mutedRef.current = muted

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const sendSignal = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload })
  }, [])

  // Fire-and-forget send on a short-lived channel (used when leaving the chat).
  const sendTransient = useCallback((convId: string, event: string, payload: Record<string, unknown>) => {
    const ch = supabase.channel(`screen:${convId}`, { config: { private: true } })
    const cleanup = () => void supabase.removeChannel(ch)
    const timer = window.setTimeout(cleanup, 5000)
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void ch
          .send({ type: 'broadcast', event, payload })
          .then(() => {
            window.clearTimeout(timer)
            window.setTimeout(cleanup, 300)
          })
          .catch(() => {
            window.clearTimeout(timer)
            cleanup()
          })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timer)
        cleanup()
      }
    })
  }, [])

  const resetLocal = useCallback(() => {
    if (reofferRef.current !== null) {
      window.clearInterval(reofferRef.current)
      reofferRef.current = null
    }
    if (lossTimerRef.current !== null) {
      window.clearTimeout(lossTimerRef.current)
      lossTimerRef.current = null
    }
    const pc = pcRef.current
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        /* already closed */
      }
    }
    pcRef.current = null
    localRef.current?.getTracks().forEach((t) => t.stop())
    remoteRef.current?.getTracks().forEach((t) => t.stop())
    localRef.current = null
    remoteRef.current = null
    pendingIceRef.current = []
    sessionRef.current = null
    pendingJoinRef.current = null
    everConnectedRef.current = false
    if (!mountedRef.current) return
    setSessionId(null)
    setLocalStream(null)
    setRemoteStream(null)
    setRemoteHasAudio(false)
    setMuted(false)
    setRole(null)
    setPhase('idle')
    setIncoming(null)
  }, [])

  const flushIce = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    const queued = pendingIceRef.current
    pendingIceRef.current = []
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand))
      } catch {
        /* ignore a candidate the browser rejects */
      }
    }
  }, [])

  const wirePc = useCallback(
    (pc: RTCPeerConnection, sessionId: string) => {
      pc.onicecandidate = (e) => {
        const target = peerRef.current
        if (e.candidate && target && sessionRef.current === sessionId) {
          sendSignal('ice', { sessionId, to: target, from: userRef.current, candidate: e.candidate.toJSON() })
        }
      }
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track])
        remoteRef.current = stream
        if (!mountedRef.current) return
        setRemoteStream(stream)
        setRemoteHasAudio(stream.getAudioTracks().length > 0)
      }
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          everConnectedRef.current = true
          if (lossTimerRef.current !== null) {
            window.clearTimeout(lossTimerRef.current)
            lossTimerRef.current = null
          }
          if (mountedRef.current) {
            setPhase('live')
            setError(null)
          }
        } else if (state === 'disconnected' || state === 'failed') {
          if (mountedRef.current) {
            if (state === 'disconnected') setPhase('connecting')
            else {
              setPhase('failed')
              setError('Screen share connection failed. A network may be blocking peer-to-peer video.')
            }
          }
          // Either side closing the tab/app can leave the other waiting forever.
          // If the peer does not come back, end the session for both.
          if (everConnectedRef.current && lossTimerRef.current === null) {
            lossTimerRef.current = window.setTimeout(() => {
              lossTimerRef.current = null
              if (sessionRef.current !== sessionId) return
              if (pcRef.current?.connectionState === 'connected') return
              const wasSharing = !!localRef.current
              resetLocal()
              if (mountedRef.current) {
                setNotice(
                  wasSharing
                    ? 'The other person left the screen share.'
                    : 'The screen share ended — the other person left or the connection was lost.',
                )
              }
            }, 12000)
          }
        }
      }
    },
    [resetLocal, sendSignal],
  )

  const onOffer = useCallback(
    (raw: unknown) => {
      const p = raw as SignalPayload
      if (typeof p?.sessionId !== 'string' || typeof p.from !== 'string') return
      if (p.from !== peerRef.current || p.from === userRef.current) return
      if (typeof p.to === 'string' && p.to !== userRef.current) return
      if (!p.sdp || typeof p.sdp !== 'object') return
      if (sessionRef.current) {
        if (sessionRef.current !== p.sessionId) {
          sendSignal('decline', { sessionId: p.sessionId, to: p.from, from: userRef.current })
        }
        return
      }
      if (!mountedRef.current) return
      setError(null)
      setNotice(null)
      setIncoming({
        sessionId: p.sessionId,
        from: p.from,
        fromName: typeof p.fromName === 'string' ? p.fromName : 'Someone',
        offer: p.sdp as RTCSessionDescriptionInit,
      })
    },
    [sendSignal],
  )

  const onAnswer = useCallback(
    (raw: unknown) => {
      const p = raw as SignalPayload
      if (typeof p?.sessionId !== 'string' || !p.sdp || typeof p.sdp !== 'object') return
      if (p.to !== userRef.current || p.from !== peerRef.current) return
      if (sessionRef.current !== p.sessionId) return
      const pc = pcRef.current
      if (!pc) return
      void (async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp as RTCSessionDescriptionInit))
          await flushIce()
          if (mountedRef.current) setPhase('connecting')
        } catch {
          if (mountedRef.current) {
            setError('Could not establish the screen share.')
            setPhase('failed')
          }
        }
      })()
    },
    [flushIce],
  )

  const onIce = useCallback((raw: unknown) => {
    const p = raw as SignalPayload
    if (typeof p?.sessionId !== 'string' || typeof p.from !== 'string') return
    if (p.to !== userRef.current || p.from !== peerRef.current) return
    if (sessionRef.current !== p.sessionId) return
    const cand = p.candidate as RTCIceCandidateInit | undefined
    if (!cand || typeof cand !== 'object') return
    const pc = pcRef.current
    if (!pc) return
    if (!pc.remoteDescription) {
      pendingIceRef.current.push(cand)
      return
    }
    void pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {})
  }, [])

  const onStop = useCallback(
    (raw: unknown) => {
      const p = raw as SignalPayload
      if (typeof p?.from !== 'string' || p.from !== peerRef.current) return
      if (sessionRef.current && typeof p.sessionId === 'string' && p.sessionId !== sessionRef.current) return
      const wasSharing = !!localRef.current
      resetLocal()
      if (mountedRef.current) {
        setNotice(
          wasSharing
            ? 'The other person left the screen share.'
            : 'The other person stopped sharing their screen.',
        )
      }
    },
    [resetLocal],
  )

  const onDecline = useCallback(
    (raw: unknown) => {
      const p = raw as SignalPayload
      if (p?.to !== userRef.current || p.from !== peerRef.current) return
      if (sessionRef.current && typeof p.sessionId === 'string' && p.sessionId !== sessionRef.current) return
      resetLocal()
      if (mountedRef.current) setNotice('The other person declined the screen share.')
    },
    [resetLocal],
  )

  // A late joiner asks to be let in; the sharer re-offers immediately instead
  // of waiting for the next keep-alive tick.
  const onJoin = useCallback(
    (raw: unknown) => {
      const p = raw as SignalPayload
      if (typeof p?.sessionId !== 'string' || typeof p.from !== 'string') return
      if (p.from !== peerRef.current || p.from === userRef.current) return
      if (sessionRef.current !== p.sessionId || !localRef.current) return
      const pc = pcRef.current
      if (!pc) return
      void (async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendSignal('offer', {
            sessionId: p.sessionId,
            from: userRef.current,
            fromName: nameRef.current,
            to: peerRef.current,
            sdp: offer,
          })
        } catch {
          /* the keep-alive interval will retry */
        }
      })()
    },
    [sendSignal],
  )

  useEffect(() => {
    if (!enabled || !conversationId || !userId || !peerId) {
      if (sessionRef.current) resetLocal()
      return
    }
    const channel = supabase.channel(`screen:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    channelRef.current = channel
    const bind = (event: string, handler: (raw: unknown) => void) => {
      channel.on('broadcast', { event }, ({ payload }: { payload: unknown }) => handler(payload))
    }
    bind('offer', onOffer)
    bind('answer', onAnswer)
    bind('ice', onIce)
    bind('stop', onStop)
    bind('decline', onDecline)
    bind('join', onJoin)
    channel.subscribe((status) => {
      if (!mountedRef.current) return
      if (status === 'SUBSCRIBED') setSignalStatus('ready')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSignalStatus('error')
    })

    return () => {
      channelRef.current = null
      const sid = sessionRef.current
      // Either role leaving (chat switch, navigation, unmount) ends the session
      // for both sides — otherwise the other person waits on a dead stream.
      if (sid) {
        sendTransient(conversationId, 'stop', { sessionId: sid, from: userRef.current, to: peerRef.current })
      }
      void supabase.removeChannel(channel)
      resetLocal()
    }
  }, [enabled, conversationId, userId, peerId, onOffer, onAnswer, onIce, onStop, onDecline, onJoin, resetLocal, sendTransient])

  // Best-effort "I left" when the tab/app is closed or backgrounded away.
  useEffect(() => {
    const onHide = () => {
      const sid = sessionRef.current
      if (!sid || !convRef.current) return
      sendTransient(convRef.current, 'stop', { sessionId: sid, from: userRef.current, to: peerRef.current })
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [sendTransient])

  const startShare = useCallback(async () => {
    if (!enabledRef.current || !convRef.current || !peerRef.current || !userRef.current) {
      if (mountedRef.current) setError('Open a one-to-one chat to share your screen.')
      return
    }
    if (sessionRef.current) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      if (mountedRef.current) setError('Screen sharing is not supported in this browser.')
      return
    }
    if (mountedRef.current) {
      setError(null)
      setNotice(null)
      setPhase('starting')
    }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: true,
      })
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      if (name === 'NotAllowedError') {
        if (mountedRef.current) {
          setError('Screen sharing was cancelled or permission was denied.')
          setPhase('idle')
        }
        return
      }
      // Some browsers reject an audio request for display capture — retry video-only.
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
      } catch {
        if (mountedRef.current) {
          setError(name === 'NotSupportedError' ? 'Screen sharing is not supported in this browser.' : 'Could not start screen sharing.')
          setPhase('idle')
        }
        return
      }
    }
    if (!stream) {
      if (mountedRef.current) setPhase('idle')
      return
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    const pc = new RTCPeerConnection({ iceServers: buildIceServers() })
    pcRef.current = pc
    const sessionId = crypto.randomUUID()
    sessionRef.current = sessionId
    setSessionId(sessionId)
    localRef.current = stream
    setLocalStream(stream)
    setRemoteStream(null)
    setRemoteHasAudio(stream.getAudioTracks().length > 0)
    setRole('sharer')
    wirePc(pc, sessionId)
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopShareRef.current?.())

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      setPhase('ringing')
      sendSignal('offer', {
        sessionId,
        from: userRef.current,
        fromName: nameRef.current,
        to: peerRef.current,
        sdp: offer,
      })
    } catch {
      setError('Could not start screen sharing.')
      resetLocal()
      return
    }

    // Persist an invite so members who are offline still receive it and can
    // open the chat to join once they are back online.
    const convId = convRef.current
    if (convId && userRef.current) {
      void supabase.from('messages').insert({
        conversation_id: convId,
        sender_id: userRef.current,
        type: 'text',
        body: buildScreenShareMessage(convId, sessionId),
      })
    }

    // Keep offering until the viewer connects (instead of cancelling after a
    // timeout), so a late or offline joiner still gets the prompt.
    reofferRef.current = window.setInterval(() => {
      const active = pcRef.current
      if (sessionRef.current !== sessionId || !active) return
      if (active.connectionState === 'connected') {
        if (reofferRef.current !== null) {
          window.clearInterval(reofferRef.current)
          reofferRef.current = null
        }
        return
      }
      void (async () => {
        try {
          const next = await active.createOffer()
          await active.setLocalDescription(next)
          sendSignal('offer', {
            sessionId,
            from: userRef.current,
            fromName: nameRef.current,
            to: peerRef.current,
            sdp: next,
          })
        } catch {
          /* retry on the next tick */
        }
      })()
    }, 6000)
  }, [resetLocal, sendSignal, wirePc])

  const stopShare = useCallback(() => {
    const sid = sessionRef.current
    if (sid) sendSignal('stop', { sessionId: sid, from: userRef.current, to: peerRef.current })
    resetLocal()
  }, [resetLocal, sendSignal])
  stopShareRef.current = stopShare

  const accept = useCallback(async () => {
    const inc = incomingRef.current
    if (!inc || sessionRef.current) return
    if (mountedRef.current) {
      setError(null)
      setNotice(null)
      setPhase('connecting')
    }
    const pc = new RTCPeerConnection({ iceServers: buildIceServers() })
    pcRef.current = pc
    sessionRef.current = inc.sessionId
    setSessionId(inc.sessionId)
    setRole('viewer')
    setIncoming(null)
    wirePc(pc, inc.sessionId)
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(inc.offer))
      await flushIce()
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal('answer', { sessionId: inc.sessionId, to: inc.from, from: userRef.current, sdp: answer })
    } catch {
      if (mountedRef.current) setError('Could not connect to the screen share.')
      resetLocal()
    }
  }, [flushIce, resetLocal, sendSignal, wirePc])

  const decline = useCallback(() => {
    const inc = incomingRef.current
    if (inc) sendSignal('decline', { sessionId: inc.sessionId, to: inc.from, from: userRef.current })
    if (mountedRef.current) {
      setIncoming(null)
      setPhase('idle')
    }
  }, [sendSignal])

  // When the user arrives through an invite link (?screen=<id>), accept the
  // matching offer automatically — they already chose to join, so there is no
  // second "accept" prompt.
  useEffect(() => {
    const pending = pendingJoinRef.current
    if (!pending || !incoming || incoming.sessionId !== pending) return
    pendingJoinRef.current = null
    void accept()
  }, [incoming, accept])

  const joinSession = useCallback(
    (targetSessionId: string) => {
      if (sessionRef.current) return
      pendingJoinRef.current = targetSessionId
      sendSignal('join', { sessionId: targetSessionId, from: userRef.current, to: peerRef.current })
    },
    [sendSignal],
  )

  const toggleMute = useCallback(() => {
    const stream = remoteRef.current
    if (!stream) return
    const next = !mutedRef.current
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next
    })
    mutedRef.current = next
    setMuted(next)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  const canShare = enabled && !!conversationId && !!peerId

  return {
    canShare,
    role,
    phase,
    error,
    notice,
    localStream,
    remoteStream,
    remoteHasAudio,
    incoming,
    muted,
    signalStatus,
    sessionId,
    startShare,
    stopShare,
    accept,
    decline,
    joinSession,
    toggleMute,
    clearError,
  }
}

export type UseScreenShare = ReturnType<typeof useScreenShare>
