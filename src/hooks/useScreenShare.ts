import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
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

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionRef = useRef<string | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const remoteRef = useRef<MediaStream | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const incomingRef = useRef<IncomingShare | null>(null)
  const mutedRef = useRef(false)
  const mountedRef = useRef(true)
  const stopShareRef = useRef<(() => void) | null>(null)

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

  // Fire-and-forget send on a throwaway channel (used when leaving the chat).
  const sendTransient = useCallback((convId: string, event: string, payload: Record<string, unknown>) => {
    void supabase.channel(`screen:${convId}`, { config: { private: true } }).send({ type: 'broadcast', event, payload })
  }, [])

  const resetLocal = useCallback(() => {
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
    if (!mountedRef.current) return
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
        const s = pc.connectionState
        if (s === 'connected') {
          if (mountedRef.current) {
            setPhase('live')
            setError(null)
          }
        } else if (s === 'disconnected') {
          if (mountedRef.current) setPhase('connecting')
        } else if (s === 'failed') {
          if (mountedRef.current) {
            setPhase('failed')
            setError('Screen share connection failed. A network may be blocking peer-to-peer video.')
          }
        }
      }
    },
    [sendSignal],
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
      resetLocal()
      if (mountedRef.current) setNotice('Screen sharing ended.')
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
    channel.subscribe((status) => {
      if (!mountedRef.current) return
      if (status === 'SUBSCRIBED') setSignalStatus('ready')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSignalStatus('error')
    })

    return () => {
      channelRef.current = null
      const sid = sessionRef.current
      const wasSharer = !!sid && !!localRef.current
      if (sid && wasSharer) {
        sendTransient(conversationId, 'stop', { sessionId: sid, from: userRef.current, to: peerRef.current })
      }
      void supabase.removeChannel(channel)
      resetLocal()
    }
  }, [enabled, conversationId, userId, peerId, onOffer, onAnswer, onIce, onStop, onDecline, resetLocal, sendTransient])

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

    window.setTimeout(() => {
      if (sessionRef.current === sessionId && pcRef.current?.connectionState !== 'connected') {
        if (mountedRef.current) setError('No response. The other person may be offline.')
        stopShareRef.current?.()
      }
    }, 30000)
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
    startShare,
    stopShare,
    accept,
    decline,
    toggleMute,
    clearError,
  }
}

export type UseScreenShare = ReturnType<typeof useScreenShare>
