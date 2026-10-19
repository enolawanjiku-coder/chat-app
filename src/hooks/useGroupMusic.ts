import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { isValidVideoId } from '../lib/youtube'

export type MusicTrack = { videoId: string; title?: string; by?: string; byName?: string }

export type GroupMusicState = {
  videoId: string | null
  isPlaying: boolean
  position: number
  at: number
  queue: MusicTrack[]
  updatedBy: string | null
  updatedByName: string | null
}

export type GroupMusicStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

const EMPTY: GroupMusicState = { videoId: null, isPlaying: false, position: 0, at: 0, queue: [], updatedBy: null, updatedByName: null }
const HEARTBEAT_MS = 10000
const MAX_QUEUE = 50

type MusicSessionRow = {
  conversation_id: string
  video_id: string | null
  is_playing: boolean
  position_s: number
  queue: unknown
  updated_by: string | null
}

type SyncPayload = {
  videoId?: unknown
  isPlaying?: unknown
  position?: unknown
  queue?: unknown
  by?: unknown
  byName?: unknown
  origin?: unknown
  rid?: unknown
  title?: unknown
}

function sanitizeQueue(value: unknown): MusicTrack[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((t): t is MusicTrack => !!t && typeof t === 'object' && isValidVideoId((t as MusicTrack).videoId))
    .slice(0, MAX_QUEUE)
    .map((t) => ({ videoId: t.videoId, title: typeof t.title === 'string' ? t.title.slice(0, 200) : undefined, by: typeof t.by === 'string' ? t.by : undefined, byName: typeof t.byName === 'string' ? t.byName.slice(0, 80) : undefined }))
}

/**
 * Group listening powered by a *private* Supabase Realtime channel
 * (`music:<conversation_id>`). Membership is enforced server-side by the
 * policies added in migration 0014. Playback events are broadcast; a durable
 * snapshot in `music_sessions` bootstraps late joiners even if no one is online.
 */
export function useGroupMusic(conversationId: string | null, enabled: boolean, getPosition?: () => number) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [state, setState] = useState<GroupMusicState>(EMPTY)
  const [status, setStatus] = useState<GroupMusicStatus>('idle')
  const [participants, setParticipants] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const profileNameRef = useRef<string | null>(profile?.display_name || profile?.username || null)
  profileNameRef.current = profile?.display_name || profile?.username || null
  const controllerRef = useRef<string | null>(null)
  const originRef = useRef<string>(crypto.randomUUID())
  const respondedRidRef = useRef<string>('')
  const getPositionRef = useRef<(() => number) | undefined>(getPosition)
  getPositionRef.current = getPosition

  const livePosition = useCallback((s: GroupMusicState): number => {
    if (s.isPlaying && getPositionRef.current) return Math.max(0, getPositionRef.current())
    return s.position
  }, [])

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload })
  }, [])

  const persist = useCallback(
    async (s: GroupMusicState) => {
      if (!conversationId || !userIdRef.current) return
      await supabase.from('music_sessions').upsert({
        conversation_id: conversationId,
        video_id: s.videoId,
        is_playing: s.isPlaying,
        position_s: s.position,
        queue: s.queue,
        updated_by: userIdRef.current,
        updated_at: new Date().toISOString(),
      })
    },
    [conversationId],
  )

  const applyPayload = useCallback((payload: SyncPayload) => {
    const videoId = typeof payload.videoId === 'string' && isValidVideoId(payload.videoId) ? payload.videoId : null
    if (!videoId) return
    if (typeof payload.rid === 'string') respondedRidRef.current = payload.rid
    if (typeof payload.origin === 'string') controllerRef.current = payload.origin
    setState((prev) => ({
      videoId,
      isPlaying: payload.isPlaying === true,
      position: typeof payload.position === 'number' && Number.isFinite(payload.position) ? Math.max(0, payload.position) : 0,
      at: Date.now(),
      queue: payload.queue !== undefined ? sanitizeQueue(payload.queue) : prev.queue,
      updatedBy: typeof payload.by === 'string' ? payload.by : null,
      updatedByName: typeof payload.byName === 'string' ? payload.byName : null,
    }))
  }, [])

  // Subscribe / resubscribe whenever the group session scope changes.
  useEffect(() => {
    if (!enabled || !conversationId || !userId) {
      setStatus('idle')
      setParticipants([])
      return
    }
    let cancelled = false

    // New scope: drop any state carried over from a previous conversation.
    setState(EMPTY)
    setParticipants([])

    // Durable snapshot first (covers the "nobody is online" late-join case).
    void (async () => {
      const { data } = await supabase.from('music_sessions').select('*').eq('conversation_id', conversationId).maybeSingle()
      if (cancelled || !data) return
      const row = data as MusicSessionRow
      if (row.video_id && isValidVideoId(row.video_id)) {
        setState({
          videoId: row.video_id,
          isPlaying: row.is_playing === true,
          position: Number(row.position_s) || 0,
          at: Date.now(),
          queue: sanitizeQueue(row.queue),
          updatedBy: row.updated_by,
          updatedByName: null,
        })
      } else if (Array.isArray(row.queue) && row.queue.length) {
        setState((prev) => ({ ...prev, queue: sanitizeQueue(row.queue) }))
      }
    })()

    setStatus('connecting')
    const channel = supabase.channel(`music:${conversationId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: userId } },
    })
    channelRef.current = channel

    const onSync = ({ payload }: { payload: SyncPayload }) => {
      if (!payload || typeof payload !== 'object') return
      applyPayload(payload)
    }

    const onRequest = ({ payload }: { payload: SyncPayload }) => {
      const rid = typeof payload?.rid === 'string' ? payload.rid : ''
      if (!rid || !stateRef.current.videoId) return
      const isController = controllerRef.current === userIdRef.current
      const delay = isController ? 0 : 120 + Math.random() * 300
      window.setTimeout(() => {
        if (respondedRidRef.current === rid) return
        const current = stateRef.current
        if (!current.videoId) return
        respondedRidRef.current = rid
        send('state', {
          videoId: current.videoId,
          isPlaying: current.isPlaying,
          position: livePosition(current),
          queue: current.queue,
          by: current.updatedBy,
          byName: current.updatedByName,
          origin: originRef.current,
          rid,
        })
      }, delay)
    }

    channel
      .on('broadcast', { event: 'state' }, onSync)
      .on('broadcast', { event: 'play' }, onSync)
      .on('broadcast', { event: 'pause' }, onSync)
      .on('broadcast', { event: 'seek' }, onSync)
      .on('broadcast', { event: 'track' }, onSync)
      .on('broadcast', { event: 'request' }, onRequest)
      .on('broadcast', { event: 'queue' }, ({ payload }: { payload: SyncPayload }) => {
        if (typeof payload?.origin === 'string') controllerRef.current = payload.origin
        setState((prev) => ({ ...prev, queue: sanitizeQueue(payload?.queue) }))
      })
      .on('broadcast', { event: 'end' }, () => {
        controllerRef.current = null
        setState(EMPTY)
      })
      .on('presence', { event: 'sync' }, () => {
        setParticipants(Object.keys(channel.presenceState()))
      })
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === 'SUBSCRIBED') {
          setStatus('connected')
          setError(null)
          void channel.track({ user_id: userId, username: profileNameRef.current, at: Date.now() })
          send('request', { rid: crypto.randomUUID(), by: userId })
        } else if (subscribeStatus === 'CHANNEL_ERROR') {
          setStatus('error')
          setError('Music sync could not connect. It will retry automatically.')
        } else if (subscribeStatus === 'TIMED_OUT') {
          setStatus('error')
          setError('Music sync timed out. Retrying…')
        } else if (subscribeStatus === 'CLOSED') {
          setStatus('disconnected')
        }
      })

    return () => {
      cancelled = true
      channelRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [enabled, conversationId, userId, applyPayload, send, livePosition])

  // Keep the group anchored: only the last actor (controller) emits heartbeats,
  // which lets everyone else correct drift.
  useEffect(() => {
    if (!enabled || status !== 'connected') return
    const id = window.setInterval(() => {
      const current = stateRef.current
      if (controllerRef.current !== userIdRef.current || !current.videoId) return
      send('state', {
        videoId: current.videoId,
        isPlaying: current.isPlaying,
        position: livePosition(current),
        origin: originRef.current,
      })
    }, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [enabled, status, send, livePosition])

  const emit = useCallback(
    (event: string, patch: Partial<GroupMusicState>, extra?: Record<string, unknown>) => {
      const next: GroupMusicState = { ...stateRef.current, ...patch }
      controllerRef.current = userIdRef.current
      setState(next)
      send(event, {
        videoId: next.videoId,
        isPlaying: next.isPlaying,
        position: next.position,
        queue: next.queue,
        by: userIdRef.current,
        byName: profileNameRef.current,
        origin: originRef.current,
        ...extra,
      })
      void persist(next)
    },
    [send, persist],
  )

  const startTrack = useCallback(
    (videoId: string, title?: string) => {
      if (!isValidVideoId(videoId)) return
      emit('track', { videoId, isPlaying: true, position: 0, updatedByName: profileNameRef.current }, { title })
    },
    [emit],
  )

  const setPlaying = useCallback(
    (isPlaying: boolean, position: number) => {
      if (!stateRef.current.videoId) return
      emit(isPlaying ? 'play' : 'pause', { isPlaying, position: Math.max(0, position) })
    },
    [emit],
  )

  const seek = useCallback(
    (position: number) => {
      if (!stateRef.current.videoId) return
      emit('seek', { position: Math.max(0, position) })
    },
    [emit],
  )

  const addToQueue = useCallback(
    (track: MusicTrack) => {
      if (!isValidVideoId(track.videoId)) return
      const current = stateRef.current.queue
      if (current.some((t) => t.videoId === track.videoId)) return
      const queue = [...current, { ...track, by: userIdRef.current ?? undefined, byName: profileNameRef.current ?? undefined }].slice(-MAX_QUEUE)
      controllerRef.current = userIdRef.current
      setState((prev) => ({ ...prev, queue }))
      send('queue', { queue, by: userIdRef.current, origin: originRef.current })
      void persist({ ...stateRef.current, queue })
    },
    [send, persist],
  )

  const removeFromQueue = useCallback(
    (videoId: string) => {
      const queue = stateRef.current.queue.filter((t) => t.videoId !== videoId)
      controllerRef.current = userIdRef.current
      setState((prev) => ({ ...prev, queue }))
      send('queue', { queue, by: userIdRef.current, origin: originRef.current })
      void persist({ ...stateRef.current, queue })
    },
    [send, persist],
  )

  const endSession = useCallback(async () => {
    send('end', { by: userIdRef.current, origin: originRef.current })
    controllerRef.current = null
    setState(EMPTY)
    if (conversationId) await supabase.from('music_sessions').delete().eq('conversation_id', conversationId)
  }, [send, conversationId])

  const requestState = useCallback(() => {
    send('request', { rid: crypto.randomUUID(), by: userIdRef.current })
  }, [send])

  return {
    state,
    status,
    participants,
    error,
    controller: controllerRef.current,
    isController: controllerRef.current === userId,
    startTrack,
    play: (position?: number) => setPlaying(true, position ?? livePosition(stateRef.current)),
    pause: (position?: number) => setPlaying(false, position ?? livePosition(stateRef.current)),
    seek,
    addToQueue,
    removeFromQueue,
    endSession,
    requestState,
  }
}
