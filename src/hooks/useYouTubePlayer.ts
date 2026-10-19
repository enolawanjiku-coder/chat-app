import { useCallback, useEffect, useRef, useState } from 'react'
import { YT_STATE, loadYouTubeApi, youTubeErrorMessage, type YouTubePlayer } from '../lib/youtube'

export type PlayerPhase = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

function phaseFor(state: number): PlayerPhase {
  switch (state) {
    case YT_STATE.PLAYING:
      return 'playing'
    case YT_STATE.PAUSED:
      return 'paused'
    case YT_STATE.BUFFERING:
      return 'buffering'
    case YT_STATE.ENDED:
      return 'ended'
    case YT_STATE.CUED:
      return 'ready'
    default:
      return 'ready'
  }
}

/**
 * Owns a single official YouTube IFrame player.
 * The host div is rendered by the caller and must stay mounted for audio to
 * continue (the player is never re-parented).
 */
export function useYouTubePlayer(options: {
  onLocalStateChange?: (state: number, player: YouTubePlayer) => void
  onEnded?: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const [phase, setPhase] = useState<PlayerPhase>('idle')
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const callbacks = useRef(options)
  callbacks.current = options

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let player: YouTubePlayer | null = null
    setPhase('loading')

    loadYouTubeApi()
      .then(() => {
        if (disposed || !window.YT) return
        const inner = document.createElement('div')
        inner.style.width = '100%'
        inner.style.height = '100%'
        host.innerHTML = ''
        host.appendChild(inner)
        player = new window.YT.Player(inner, {
          width: '100%',
          height: '100%',
          playerVars: {
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
            controls: 1,
            fs: 1,
          },
          events: {
            onReady: () => {
              if (disposed) return
              setPhase('ready')
            },
            onStateChange: (event) => {
              if (disposed) return
              setPhase(phaseFor(event.data))
              callbacks.current.onLocalStateChange?.(event.data, event.target)
              if (event.data === YT_STATE.ENDED) callbacks.current.onEnded?.()
            },
            onError: (event) => {
              if (disposed) return
              setPhase('error')
              setError(youTubeErrorMessage(event.data))
            },
          },
        })
        playerRef.current = player
      })
      .catch((err: unknown) => {
        if (disposed) return
        setPhase('error')
        setError(err instanceof Error ? err.message : 'Could not load the YouTube player.')
      })

    return () => {
      disposed = true
      try {
        player?.destroy()
      } catch {
        // player may not have finished initialising
      }
      playerRef.current = null
      host.innerHTML = ''
    }
  }, [])

  // Lightweight polling for progress/title; the IFrame API has no timeupdate event.
  useEffect(() => {
    const id = window.setInterval(() => {
      const player = playerRef.current
      if (!player) return
      try {
        const time = player.getCurrentTime?.() ?? 0
        const total = player.getDuration?.() ?? 0
        setCurrentTime(time)
        setDuration(total)
        const data = player.getVideoData?.()
        if (data?.title) setTitle((prev) => (prev === data.title ? prev : (data.title as string)))
      } catch {
        // player not ready yet
      }
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  const play = useCallback(() => {
    try {
      playerRef.current?.playVideo()
    } catch {
      // not ready
    }
  }, [])

  const pause = useCallback(() => {
    try {
      playerRef.current?.pauseVideo()
    } catch {
      // not ready
    }
  }, [])

  const seek = useCallback((seconds: number) => {
    try {
      playerRef.current?.seekTo(Math.max(0, seconds), true)
    } catch {
      // not ready
    }
  }, [])

  const load = useCallback((videoId: string, startSeconds = 0, autoplay = true) => {
    setError(null)
    try {
      const player = playerRef.current
      if (!player) return
      if (autoplay) player.loadVideoById({ videoId, startSeconds })
      else player.cueVideoById({ videoId, startSeconds })
    } catch {
      // not ready
    }
  }, [])

  const getTime = useCallback((): number => {
    try {
      return playerRef.current?.getCurrentTime() ?? 0
    } catch {
      return 0
    }
  }, [])

  const isPlaying = useCallback((): boolean => {
    try {
      return playerRef.current?.getPlayerState() === YT_STATE.PLAYING
    } catch {
      return false
    }
  }, [])

  return { hostRef, playerRef, phase, title, duration, currentTime, error, setError, play, pause, seek, load, getTime, isPlaying }
}
