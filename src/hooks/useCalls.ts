import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { playConnected, startRing, stopRing } from '../lib/sounds'

export type IncomingCall = {
  callId: string
  from: string
  fromName: string
  conversationId: string
  video: boolean
  offer: RTCSessionDescriptionInit
  to?: string | null
}

export type ActiveCall = {
  callId: string
  conversationId: string
  peerName: string
  video: boolean
  startedAt: number
  localStream: MediaStream | null
  remoteStream: MediaStream | null
}

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }

export function useCalls() {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [active, setActive] = useState<ActiveCall | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const activeRef = useRef<ActiveCall | null>(null)
  const incomingRef = useRef<IncomingCall | null>(null)
  const userRef = useRef(userId)
  userRef.current = userId
  activeRef.current = active
  incomingRef.current = incoming

  const cleanup = useCallback(() => {
    stopRing()
    pcRef.current?.close()
    pcRef.current = null
    activeRef.current?.localStream?.getTracks().forEach((t) => t.stop())
    activeRef.current?.remoteStream?.getTracks().forEach((t) => t.stop())
    setActive(null)
    setIncoming(null)
  }, [])

  const send = useCallback((conversationId: string, event: string, payload: Record<string, unknown>) => {
    supabase.channel(`call:${conversationId}`).send({ type: 'broadcast', event, payload })
  }, [])

  const endCall = useCallback(
    (conversationId?: string, callId?: string) => {
      const a = activeRef.current
      if (a) send(a.conversationId, 'end', { callId: a.callId, from: userRef.current })
      else if (conversationId && callId) send(conversationId, 'end', { callId, from: userRef.current })
      cleanup()
    },
    [cleanup, send],
  )

  // subscribe to call channels of all my conversations
  useEffect(() => {
    if (!userId) return
    let channels: { unsubscribe: () => void }[] = []
    const setup = async () => {
      const { data: memberships } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', userId)
      const ids = [...new Set(((memberships ?? []) as { conversation_id: string }[]).map((m) => m.conversation_id))]
      channels = ids.map((convId) => {
        const ch = supabase.channel(`call:${convId}`, { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'ring' }, ({ payload }) => {
          const p = payload as unknown as IncomingCall
          if (p.from === userRef.current || activeRef.current || incomingRef.current) return
          if (p.to && (p as unknown as { to: string }).to !== userRef.current) return
          setIncoming(p)
          startRing(false)
        })
        ch.on('broadcast', { event: 'answer' }, ({ payload }) => {
          const p = payload as { callId: string; to: string; from: string; answer: RTCSessionDescriptionInit }
          const a = activeRef.current
          if (!a || p.callId !== a.callId || p.to !== userRef.current) return
          stopRing()
          playConnected()
          void pcRef.current?.setRemoteDescription(new RTCSessionDescription(p.answer))
        })
        ch.on('broadcast', { event: 'ice' }, ({ payload }) => {
          const p = payload as { callId: string; to: string; candidate: RTCIceCandidateInit }
          const a = activeRef.current ?? (incomingRef.current as unknown as ActiveCall | null)
          if (p.to !== userRef.current) return
          if (p.callId !== (a as ActiveCall | null)?.callId && p.callId !== incomingRef.current?.callId) return
          void pcRef.current?.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {})
        })
        ch.on('broadcast', { event: 'decline' }, ({ payload }) => {
          const p = payload as { callId: string; to: string }
          if (p.to !== userRef.current) return
          if (activeRef.current?.callId === p.callId) {
            setCallError('Call declined')
            setTimeout(() => setCallError(null), 3000)
            cleanup()
          }
        })
        ch.on('broadcast', { event: 'end' }, ({ payload }) => {
          const p = payload as { callId: string; from: string }
          if (p.from === userRef.current) return
          if (activeRef.current?.callId === p.callId || incomingRef.current?.callId === p.callId) cleanup()
        })
        ch.subscribe()
        return { unsubscribe: () => supabase.removeChannel(ch) }
      })
    }
    setup()
    return () => {
      channels.forEach((c) => c.unsubscribe())
    }
  }, [userId, cleanup])

  const startCall = useCallback(
    async (conversationId: string, peerName: string, video: boolean, to: string | null) => {
      setCallError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { width: 640 } : false })
        const pc = new RTCPeerConnection(ICE)
        pcRef.current = pc
        const callId = crypto.randomUUID()
        const remote = new MediaStream()
        pc.ontrack = (e) => {
          e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t))
          setActive((a) => (a ? { ...a, remoteStream: remote } : a))
        }
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        pc.onicecandidate = (e) => {
          if (e.candidate && to) send(conversationId, 'ice', { callId, to, from: userRef.current, candidate: e.candidate.toJSON() })
        }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        setActive({ callId, conversationId, peerName, video, startedAt: Date.now(), localStream: stream, remoteStream: remote })
        send(conversationId, 'ring', {
          callId,
          from: userRef.current,
          fromName: profile?.display_name || profile?.username || 'Someone',
          to,
          conversationId,
          video,
          offer,
        })
        startRing(true)
        // auto-cancel after 45s
        setTimeout(() => {
          if (activeRef.current?.callId === callId && pcRef.current?.connectionState !== 'connected') {
            endCall(conversationId, callId)
            setCallError('No answer')
            setTimeout(() => setCallError(null), 3000)
          }
        }, 45000)
      } catch {
        setCallError('Could not access microphone/camera. Check permissions.')
        setTimeout(() => setCallError(null), 4000)
      }
    },
    [endCall, send, profile],
  )

  const acceptCall = useCallback(
    async (withVideo: boolean) => {
      const inc = incomingRef.current
      if (!inc) return
      setCallError(null)
      try {
        stopRing()
        const video = inc.video && withVideo
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { width: 640 } : false })
        const pc = new RTCPeerConnection(ICE)
        pcRef.current = pc
        const remote = new MediaStream()
        pc.ontrack = (e) => {
          e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t))
          setActive((a) => (a ? { ...a, remoteStream: remote } : a))
        }
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        pc.onicecandidate = (e) => {
          if (e.candidate) send(inc.conversationId, 'ice', { callId: inc.callId, to: inc.from, from: userRef.current, candidate: e.candidate.toJSON() })
        }
        await pc.setRemoteDescription(new RTCSessionDescription(inc.offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        setActive({ callId: inc.callId, conversationId: inc.conversationId, peerName: inc.fromName, video, startedAt: Date.now(), localStream: stream, remoteStream: remote })
        setIncoming(null)
        playConnected()
        send(inc.conversationId, 'answer', { callId: inc.callId, to: inc.from, from: userRef.current, answer })
      } catch {
        setCallError('Could not access microphone/camera. Check permissions.')
        setTimeout(() => setCallError(null), 4000)
      }
    },
    [send],
  )

  const declineCall = useCallback(() => {
    const inc = incomingRef.current
    if (inc) send(inc.conversationId, 'decline', { callId: inc.callId, to: inc.from, from: userRef.current })
    cleanup()
  }, [cleanup, send])

  return { incoming, active, callError, startCall, acceptCall, declineCall, endCall }
}
