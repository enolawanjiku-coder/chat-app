import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { isValidVideoId } from '../lib/youtube'

export type MusicTrack = { videoId: string; title?: string; by?: string; byName?: string }

export type SharedMusicState = {
  videoId: string | null
  title: string | null
  playlistId: string | null
  isPlaying: boolean
  position: number
  at: number
  queue: MusicTrack[]
  history: MusicTrack[]
  updatedBy: string | null
  updatedByName: string | null
}

export type SharedMusicStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

const EMPTY: SharedMusicState = {
  videoId: null,
  title: null,
  playlistId: null,
  isPlaying: false,
  position: 0,
  at: 0,
  queue: [],
  history: [],
  updatedBy: null,
  updatedByName: null,
}

const HEARTBEAT_MS = 10000
const MAX_QUEUE = 100
const MAX_HISTORY = 100

type MusicSessionRow = {
  video_id: string | null
  title: string | null
  playlist_id: string | null
  is_playing: boolean
  position_s: number
  queue: unknown
  history: unknown
  updated_by: string | null
}

type SyncPayload = {
  videoId?: unknown
  title?: unknown
  playlistId?: unknown
  isPlaying?: unknown
  position?: unknown
  queue?: unknown
  history?: unknown
  by?: unknown
  byName?: unknown
  origin?: unknown
  rid?: unknown
}

function sanitizeTracks(value: unknown, limit: number): MusicTrack[] {
  if (!Array.isArray(value)) return []
  const out: MusicTrack[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as { videoId?: unknown; title?: unknown; by?: unknown; byName?: unknown }
    if (typeof t.videoId === 'string' && isValidVideoId(t.videoId)) {
      out.push({
        videoId: t.videoId,
        title: typeof t.title === 'string' ? t.title.slice(0, 200) : undefined,
        by: typeof t.by === 'string' ? t.by : undefined,
        byName: typeof t.byName === 'string' ? t.byName.slice(0, 80) : undefined,
      })
    }
    if (out.length >= limit) break
  }
  return out
}

/**
 * Shared listening for a conversation (direct or group), powered by a *private*
 * Supabase Realtime channel (`music:<conversation_id>`). Membership is enforced
 * by the `realtime.messages` policies from migration 0014. Playback is
 * broadcast as a single `sync` snapshot; a durable `music_sessions` row
 * bootstraps late joiners even when no one is online.
 */
export function useSharedMusic(conversationId: string | null, enabled: boolean, getPosition?: () => number) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [state, setState] = useState<SharedMusicState>(EMPTY)
  const [status, setStatus] = useState<SharedMusicStatus>('idle')
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

  const livePosition = useCallback((s: SharedMusicState): number => {
    if (s.isPlaying && getPositionRef.current) return Math.max(0, getPositionRef.current())
    return Math.max(0, s.position)
  }, [])

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload })
  }, [])

  const persist = useCallback(
    async (s: SharedMusicState) => {
      if (!conversationId || !userIdRef.current) return
      await supabase.from('music_sessions').upsert({
        conversation_id: conversationId,
        video_id: s.videoId,
        title: s.title,
        playlist_id: s.playlistId,
        is_playing: s.isPlaying,
        position_s: s.position,
        queue: s.queue,
        history: s.history,
        updated_by: userIdRef.current,
        updated_at: new Date().toISOString(),
      })
    },
    [conversationId],
  )

  const applyPayload = useCallback((payload: SyncPayload) => {
    const videoId = typeof payload.videoId === 'string' && isValidVideoId(payload.videoId) ? payload.videoId : null
    if (!videoId) {
      setState(EMPTY)
      return
    }
    if (typeof payload.rid === 'string') respondedRidRef.current = payload.rid
    if (typeof payload.origin === 'string') controllerRef.current = payload.origin
    setState({
      videoId,
      title: typeof payload.title === 'string' ? payload.title : null,
      playlistId: typeof payload.playlistId === 'string' ? payload.playlistId : null,
      isPlaying: payload.isPlaying === true,
      position: typeof payload.position === 'number' && Number.isFinite(payload.position) ? Math.max(0, payload.position) : 0,
      at: Date.now(),
      queue: sanitizeTracks(payload.queue, MAX_QUEUE),
      history: sanitizeTracks(payload.history, MAX_HISTORY),
      updatedBy: typeof payload.by === 'string' ? payload.by : null,
      updatedByName: typeof payload.byName === 'string' ? payload.byName : null,
    })
  }, [])

  // Subscribe / resubscribe whenever the conversation scope changes.
  useEffect(() => {
    if (!enabled || !conversationId || !userId) {
      setStatus('idle')
      setParticipants([])
      setState(EMPTY)
      return
    }
    let cancelled = false

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
          title: row.title ?? null,
          playlistId: row.playlist_id ?? null,
          isPlaying: row.is_playing === true,
          position: Number(row.position_s) || 0,
          at: Date.now(),
          queue: sanitizeTracks(row.queue, MAX_QUEUE),
          history: sanitizeTracks(row.history, MAX_HISTORY),
          updatedBy: row.updated_by,
          updatedByName: null,
        })
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
        send('sync', {
          videoId: current.videoId,
          title: current.title,
          playlistId: current.playlistId,
          isPlaying: current.isPlaying,
          position: livePosition(current),
          queue: current.queue,
          history: current.history,
          by: current.updatedBy,
          byName: current.updatedByName,
          origin: originRef.current,
          rid,
        })
      }, delay)
    }

    channel
      .on('broadcast', { event: 'sync' }, onSync)
      .on('broadcast', { event: 'request' }, onRequest)
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

  // Only the last actor (controller) emits heartbeats, letting others correct drift.
  useEffect(() => {
    if (!enabled || status !== 'connected') return
    const id = window.setInterval(() => {
      const current = stateRef.current
      if (controllerRef.current !== userIdRef.current || !current.videoId) return
      send('sync', {
        videoId: current.videoId,
        title: current.title,
        playlistId: current.playlistId,
        isPlaying: current.isPlaying,
        position: livePosition(current),
        queue: current.queue,
        history: current.history,
        origin: originRef.current,
      })
    }, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [enabled, status, send, livePosition])

  const emit = useCallback(
    (next: SharedMusicState, extra?: Record<string, unknown>) => {
      controllerRef.current = userIdRef.current
      setState(next)
      send('sync', {
        videoId: next.videoId,
        title: next.title,
        playlistId: next.playlistId,
        isPlaying: next.isPlaying,
        position: next.position,
        queue: next.queue,
        history: next.history,
        by: userIdRef.current,
        byName: profileNameRef.current,
        origin: originRef.current,
        ...extra,
      })
      void persist(next)
    },
    [send, persist],
  )

  const currentTrack = useCallback((s: SharedMusicState): MusicTrack => ({
    videoId: s.videoId as string,
    title: s.title ?? undefined,
    by: s.updatedBy ?? undefined,
    byName: s.updatedByName ?? undefined,
  }), [])

  const startVideo = useCallback(
    (videoId: string, title?: string) => {
      if (!isValidVideoId(videoId)) return
      emit({ ...EMPTY, videoId, title: title ?? null, isPlaying: true, position: 0, at: Date.now(), updatedBy: userIdRef.current, updatedByName: profileNameRef.current })
    },
    [emit],
  )

  const startPlaylist = useCallback(
    (playlistId: string, tracks: MusicTrack[], startIndex = 0) => {
      const list = sanitizeTracks(tracks, MAX_QUEUE)
      if (list.length === 0) return
      const i = Math.min(Math.max(0, startIndex), list.length - 1)
      const current = list[i]
      emit({
        ...EMPTY,
        videoId: current.videoId,
        title: current.title ?? null,
        playlistId,
        isPlaying: true,
        position: 0,
        at: Date.now(),
        queue: list.slice(i + 1),
        history: list.slice(0, i),
        updatedBy: userIdRef.current,
        updatedByName: profileNameRef.current,
      })
    },
    [emit],
  )

  const setPlaying = useCallback(
    (isPlaying: boolean, position: number) => {
      const s = stateRef.current
      if (!s.videoId) return
      emit({ ...s, isPlaying, position: Math.max(0, position), at: Date.now() })
    },
    [emit],
  )

  const seek = useCallback(
    (position: number) => {
      const s = stateRef.current
      if (!s.videoId) return
      emit({ ...s, position: Math.max(0, position), at: Date.now() })
    },
    [emit],
  )

  const next = useCallback(() => {
    const s = stateRef.current
    if (!s.videoId) return
    if (s.queue.length === 0) {
      emit({ ...s, isPlaying: false, position: 0, at: Date.now() })
      return
    }
    const cur = currentTrack(s)
    const [head, ...rest] = s.queue
    emit({
      ...s,
      videoId: head.videoId,
      title: head.title ?? null,
      queue: rest,
      history: [...s.history, cur].slice(-MAX_HISTORY),
      isPlaying: true,
      position: 0,
      at: Date.now(),
    })
  }, [emit, currentTrack])

  const prev = useCallback(() => {
    const s = stateRef.current
    if (!s.videoId || s.history.length === 0) return
    const cur = currentTrack(s)
    const back = s.history[s.history.length - 1]
    emit({
      ...s,
      videoId: back.videoId,
      title: back.title ?? null,
      history: s.history.slice(0, -1),
      queue: [cur, ...s.queue].slice(0, MAX_QUEUE),
      isPlaying: true,
      position: 0,
      at: Date.now(),
    })
  }, [emit, currentTrack])

  const addToQueue = useCallback(
    (track: MusicTrack) => {
      if (!isValidVideoId(track.videoId)) return
      const s = stateRef.current
      if (s.queue.some((t) => t.videoId === track.videoId) || s.videoId === track.videoId) return
      const queue = [...s.queue, { ...track, by: track.by ?? userIdRef.current ?? undefined, byName: track.byName ?? profileNameRef.current ?? undefined }].slice(-MAX_QUEUE)
      emit({ ...s, queue })
    },
    [emit],
  )

  const removeFromQueue = useCallback(
    (videoId: string) => {
      const s = stateRef.current
      emit({ ...s, queue: s.queue.filter((t) => t.videoId !== videoId) })
    },
    [emit],
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

  const play = useCallback((position?: number) => setPlaying(true, position ?? livePosition(stateRef.current)), [setPlaying, livePosition])
  const pause = useCallback((position?: number) => setPlaying(false, position ?? livePosition(stateRef.current)), [setPlaying, livePosition])

  return {
    state,
    status,
    participants,
    error,
    controller: controllerRef.current,
    isController: controllerRef.current === userId,
    startVideo,
    startPlaylist,
    play,
    pause,
    seek,
    next,
    prev,
    addToQueue,
    removeFromQueue,
    endSession,
    requestState,
  }
}
