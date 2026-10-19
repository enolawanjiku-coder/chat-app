import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { YT_STATE, fetchPlaylistItems, type YouTubeLink } from '../lib/youtube'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { useSharedMusic, type MusicTrack, type SharedMusicState, type SharedMusicStatus } from '../hooks/useSharedMusic'
import { useAuthStore } from '../store/authStore'

const DRIFT_SECONDS = 2.5

export type MusicSession = {
  enabled: boolean
  state: SharedMusicState
  status: SharedMusicStatus
  participants: string[]
  error: string | null
  needsTap: boolean
  startVideo: (videoId: string, title?: string) => void
  startPlaylist: (playlistId: string, tracks: MusicTrack[], startIndex?: number) => void
  startFromLink: (link: YouTubeLink) => Promise<void>
  play: (position?: number) => void
  pause: (position?: number) => void
  seek: (position: number) => void
  next: () => void
  prev: () => void
  addToQueue: (track: MusicTrack) => void
  removeFromQueue: (videoId: string) => void
  endSession: () => Promise<void>
  requestState: () => void
  clearNeedsTap: () => void
}

type PlayerApi = ReturnType<typeof useYouTubePlayer>

const MusicSessionContext = createContext<MusicSession | null>(null)
const MusicPlayerContext = createContext<PlayerApi | null>(null)

export function useMusic(): MusicSession {
  const ctx = useContext(MusicSessionContext)
  if (!ctx) throw new Error('useMusic must be used inside <MusicProvider>')
  return ctx
}

export function useMusicPlayer(): PlayerApi {
  const ctx = useContext(MusicPlayerContext)
  if (!ctx) throw new Error('useMusicPlayer must be used inside <MusicProvider>')
  return ctx
}

export function MusicProvider({ conversationId, children }: { conversationId: string | null; children: ReactNode }) {
  const userId = useAuthStore((s) => s.userId)
  const enabled = !!conversationId && !!userId

  const sessionRef = useRef<ReturnType<typeof useSharedMusic> | null>(null)
  const suppressUntil = useRef(0)
  const lastLocalAt = useRef(0)
  const lastApplied = useRef<SharedMusicState | null>(null)
  const [needsTap, setNeedsTap] = useState(false)

  const player = useYouTubePlayer({
    onLocalStateChange: (code, p) => {
      const s = sessionRef.current
      if (!s || !enabled) return
      if (Date.now() < suppressUntil.current) return
      if (Date.now() - lastLocalAt.current < 900) return
      const time = p.getCurrentTime?.() ?? 0
      if (code === YT_STATE.PLAYING) {
        lastLocalAt.current = Date.now()
        s.play(time)
      } else if (code === YT_STATE.PAUSED) {
        lastLocalAt.current = Date.now()
        s.pause(time)
      }
    },
    onEnded: () => {
      const s = sessionRef.current
      if (!s || !s.isController) return
      if (s.state.queue.length) s.next()
      else s.pause(0)
    },
  })

  const session = useSharedMusic(conversationId, enabled, () => player.getTime())
  sessionRef.current = session

  const expectedPosition = useCallback(
    (s: SharedMusicState) => Math.max(0, s.position + (s.isPlaying ? Math.max(0, Date.now() - s.at) / 1000 : 0)),
    [],
  )

  // Apply the shared state to the single player, with drift correction.
  useEffect(() => {
    if (!enabled) return
    const s = session.state
    if (!s.videoId) return
    if (Date.now() - lastLocalAt.current < 900) {
      lastApplied.current = s
      return
    }
    if (lastApplied.current === s) return
    const p = player.playerRef.current
    if (!p) return
    lastApplied.current = s
    const target = expectedPosition(s)
    let currentId: string | undefined
    try {
      currentId = p.getVideoData?.().video_id
    } catch {
      currentId = undefined
    }
    const loadingNewVideo = currentId !== s.videoId
    // Loading a new video buffers past a second; mute our own state echoes longer.
    suppressUntil.current = Date.now() + (loadingNewVideo ? 5000 : 1200)
    if (loadingNewVideo) {
      player.setError(null)
      if (s.isPlaying) p.loadVideoById({ videoId: s.videoId, startSeconds: target })
      else p.cueVideoById({ videoId: s.videoId, startSeconds: target })
    } else {
      let actual = 0
      try {
        actual = p.getCurrentTime?.() ?? 0
      } catch {
        actual = 0
      }
      if (Math.abs(actual - target) > DRIFT_SECONDS) p.seekTo(target, true)
      if (s.isPlaying) p.playVideo()
      else p.pauseVideo()
    }

    if (s.isPlaying) {
      window.setTimeout(() => {
        if (!player.isPlaying()) setNeedsTap(true)
      }, 1500)
    } else {
      setNeedsTap(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session.state, expectedPosition, player.phase])

  // Stop local audio whenever this conversation has no active shared track.
  useEffect(() => {
    if (session.state.videoId) return
    player.pause()
    setNeedsTap(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state.videoId, conversationId])

  const startFromLink = useCallback(
    async (link: YouTubeLink) => {
      if (link.playlistId) {
        const tracks = await fetchPlaylistItems(link.playlistId)
        if (tracks.length) {
          const idx = link.videoId ? tracks.findIndex((t) => t.videoId === link.videoId) : 0
          session.startPlaylist(link.playlistId, tracks.map((t) => ({ videoId: t.videoId, title: t.title })), idx < 0 ? 0 : idx)
          return
        }
      }
      if (link.videoId) {
        session.startVideo(link.videoId)
        return
      }
      throw new Error('No playable video found in that link.')
    },
    [session.startPlaylist, session.startVideo],
  )

  const clearNeedsTap = useCallback(() => setNeedsTap(false), [])

  const sessionValue = useMemo<MusicSession>(
    () => ({
      enabled,
      state: session.state,
      status: session.status,
      participants: session.participants,
      error: session.error,
      needsTap,
      startVideo: session.startVideo,
      startPlaylist: session.startPlaylist,
      startFromLink,
      play: session.play,
      pause: session.pause,
      seek: session.seek,
      next: session.next,
      prev: session.prev,
      addToQueue: session.addToQueue,
      removeFromQueue: session.removeFromQueue,
      endSession: session.endSession,
      requestState: session.requestState,
      clearNeedsTap,
    }),
    [
      enabled,
      session.state,
      session.status,
      session.participants,
      session.error,
      needsTap,
      session.startVideo,
      session.startPlaylist,
      startFromLink,
      session.play,
      session.pause,
      session.seek,
      session.next,
      session.prev,
      session.addToQueue,
      session.removeFromQueue,
      session.endSession,
      session.requestState,
      clearNeedsTap,
    ],
  )

  return (
    <MusicSessionContext.Provider value={sessionValue}>
      <MusicPlayerContext.Provider value={player}>{children}</MusicPlayerContext.Provider>
    </MusicSessionContext.Provider>
  )
}
