import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ExternalLink,
  ListMusic,
  Maximize2,
  Music,
  Pause,
  Play,
  Plus,
  Radio,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { YT_STATE, isValidVideoId, parseYouTubeId, youTubeWatchUrl } from '../lib/youtube'
import { useYouTubePlayer } from '../hooks/useYouTubePlayer'
import { useGroupMusic, type GroupMusicState } from '../hooks/useGroupMusic'
import { useAuthStore } from '../store/authStore'

const SOLO_KEY = 'sc-music-solo'
const DRIFT_SECONDS = 2.5

type SoloState = { videoId: string | null; title: string | null; position: number }

function readSolo(): SoloState {
  try {
    const raw = localStorage.getItem(SOLO_KEY)
    if (!raw) return { videoId: null, title: null, position: 0 }
    const parsed = JSON.parse(raw) as Partial<SoloState>
    if (isValidVideoId(parsed.videoId)) {
      return { videoId: parsed.videoId, title: typeof parsed.title === 'string' ? parsed.title : null, position: Number(parsed.position) || 0 }
    }
  } catch {
    // ignore malformed storage
  }
  return { videoId: null, title: null, position: 0 }
}

function writeSolo(value: SoloState) {
  try {
    localStorage.setItem(SOLO_KEY, JSON.stringify(value))
  } catch {
    // storage may be blocked
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function MusicPanel({
  conversationId,
  conversationType,
  open,
  onClose,
}: {
  conversationId: string | null
  conversationType: 'direct' | 'group' | undefined
  open: boolean
  onClose: () => void
}) {
  const userId = useAuthStore((s) => s.userId)
  const [mode, setMode] = useState<'solo' | 'group'>('solo')
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [solo, setSolo] = useState<SoloState>(readSolo)
  const [needsTap, setNeedsTap] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)

  const soloRef = useRef(solo)
  soloRef.current = solo
  const suppressUntil = useRef(0)
  const lastLocalAt = useRef(0)
  const lastApplied = useRef<GroupMusicState | null>(null)

  const isGroup = conversationType === 'group'
  const groupEnabled = isGroup && !!conversationId && !!userId && mode === 'group'

  const group = useGroupMusic(conversationId, groupEnabled, () => player.getTime())
  const player = useYouTubePlayer({
    onLocalStateChange: (code, p) => {
      if (groupEnabled) {
        if (Date.now() < suppressUntil.current) return
        const time = p.getCurrentTime?.() ?? 0
        if (code === YT_STATE.PLAYING) {
          lastLocalAt.current = Date.now()
          group.play(time)
        } else if (code === YT_STATE.PAUSED) {
          lastLocalAt.current = Date.now()
          group.pause(time)
        }
        return
      }
      if (mode === 'solo' && soloRef.current.videoId && (code === YT_STATE.PAUSED || code === YT_STATE.PLAYING)) {
        const next = { ...soloRef.current, position: p.getCurrentTime?.() ?? 0 }
        soloRef.current = next
        setSolo(next)
        writeSolo(next)
      }
    },
    onEnded: () => {
      if (!groupEnabled || !group.isController) return
      const queue = group.state.queue
      if (queue.length) {
        const [next, ...rest] = queue
        group.startTrack(next.videoId, next.title)
        if (rest.length !== queue.length) group.removeFromQueue(next.videoId)
      } else {
        group.pause(0)
      }
    },
  })

  const hasTrack = mode === 'group' ? !!group.state.videoId : !!solo.videoId

  // Force solo when the selected chat cannot have a group session.
  useEffect(() => {
    if (!isGroup && mode === 'group') setMode('solo')
    if (!isGroup && !conversationId) setMode('solo')
  }, [isGroup, conversationId, mode])

  // Pause when the user deliberately switches mode; the relevant effect restarts playback.
  useEffect(() => {
    player.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const expectedPosition = useCallback((s: GroupMusicState) => s.position + (s.isPlaying ? Math.max(0, Date.now() - s.at) / 1000 : 0), [])

  // Apply remote group state to the shared player (with drift correction).
  useEffect(() => {
    if (!groupEnabled) return
    const s = group.state
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
    // Loading a new video usually buffers well past a second; mute our own
    // state-change echoes for longer so we don't rebroadcast remote events.
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

    // Detect browser autoplay blocking: if we asked to play but it never started.
    if (s.isPlaying) {
      window.setTimeout(() => {
        if (!player.isPlaying()) setNeedsTap(true)
      }, 1500)
    } else {
      setNeedsTap(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupEnabled, group.state, expectedPosition, player.phase])

  // Load the solo track when the player is ready (or after switching back to solo).
  useEffect(() => {
    if (mode !== 'solo' || !solo.videoId || !player.playerRef.current) return
    let currentId: string | undefined
    try {
      currentId = player.playerRef.current.getVideoData?.().video_id
    } catch {
      currentId = undefined
    }
    if (currentId !== solo.videoId) {
      suppressUntil.current = Date.now() + 800
      player.load(solo.videoId, solo.position, true)
      window.setTimeout(() => {
        if (!player.isPlaying()) setNeedsTap(true)
      }, 1500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, solo.videoId, player.phase])

  // Periodically remember the solo position.
  useEffect(() => {
    if (mode !== 'solo' || !solo.videoId) return
    const id = window.setInterval(() => {
      if (!soloRef.current.videoId) return
      const next = { ...soloRef.current, position: player.getTime() }
      soloRef.current = next
      writeSolo(next)
    }, 5000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, solo.videoId])

  // Re-request state when we come back online / refocus.
  const requestGroupState = group.requestState
  useEffect(() => {
    if (!groupEnabled) return
    const refresh = () => {
      if (!document.hidden) requestGroupState()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [groupEnabled, requestGroupState])

  const submitInput = (addToQueueOnly: boolean) => {
    setInputError(null)
    const videoId = parseYouTubeId(input)
    if (!videoId) {
      setInputError('Paste a valid YouTube link or 11-character video ID.')
      return
    }
    if (mode === 'group' && groupEnabled) {
      if (addToQueueOnly) {
        group.addToQueue({ videoId })
      } else {
        group.startTrack(videoId)
      }
      setInput('')
      return
    }
    const next = { videoId, title: null, position: 0 }
    soloRef.current = next
    setSolo(next)
    writeSolo(next)
    setNeedsTap(false)
    suppressUntil.current = Date.now() + 500
    player.load(videoId, 0, true)
    setInput('')
  }

  const togglePlay = () => {
    const playing = player.phase === 'playing'
    suppressUntil.current = Date.now() + 800
    const time = player.getTime()
    if (playing) {
      player.pause()
      if (groupEnabled) group.pause(time)
      if (mode === 'solo' && soloRef.current.videoId) {
        const next = { ...soloRef.current, position: time }
        soloRef.current = next
        setSolo(next)
        writeSolo(next)
      }
    } else {
      setNeedsTap(false)
      player.play()
      if (groupEnabled) group.play(time)
    }
    lastLocalAt.current = Date.now()
  }

  const commitSeek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return
    suppressUntil.current = Date.now() + 700
    player.seek(seconds)
    if (groupEnabled) group.seek(seconds)
    lastLocalAt.current = Date.now()
    setScrub(null)
  }

  const playQueueItem = (videoId: string, title?: string) => {
    if (groupEnabled) {
      group.startTrack(videoId, title)
    } else {
      const next = { videoId, title: title ?? null, position: 0 }
      soloRef.current = next
      setSolo(next)
      writeSolo(next)
      player.load(videoId, 0, true)
    }
  }

  const stop = () => {
    player.pause()
    setNeedsTap(false)
    if (groupEnabled) {
      group.pause(player.getTime())
      return
    }
    if (mode === 'solo') {
      const next = { videoId: null, title: null, position: 0 }
      soloRef.current = next
      setSolo(next)
      writeSolo(next)
    }
  }

  const listeners = group.participants.length
  const statusLabel = !groupEnabled
    ? null
    : group.status === 'connected'
      ? listeners > 1
        ? `${listeners} listening`
        : 'Only you here'
      : group.status === 'connecting'
        ? 'Connecting…'
        : group.status === 'error'
          ? 'Reconnecting…'
          : group.status === 'disconnected'
            ? 'Disconnected'
            : null

  const displayTime = scrub ?? player.currentTime
  const maxTime = Math.max(1, Math.floor(player.duration || 0))
  const rootClass = open
    ? 'fixed inset-x-0 bottom-0 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-96 max-h-[85vh] rounded-t-3xl sm:rounded-2xl shadow-2xl bg-white dark:bg-[#111b21] border border-black/5 dark:border-white/10 z-40 flex flex-col overflow-hidden'
    : hasTrack
      ? 'fixed left-1/2 -translate-x-1/2 top-14 w-[min(94vw,26rem)] rounded-2xl shadow-2xl bg-white dark:bg-[#111b21] border border-black/5 dark:border-white/10 z-40 flex items-center gap-2 p-2'
      : 'fixed bottom-0 right-0 w-px h-px overflow-hidden opacity-0 pointer-events-none z-[-1]'

  const hostClass = open
    ? 'relative w-full aspect-video bg-black shrink-0'
    : hasTrack
      ? 'relative w-24 h-14 rounded-lg overflow-hidden bg-black shrink-0'
      : 'w-px h-px overflow-hidden'

  return (
    <div className={rootClass}>
      <div className={hostClass}>
        <div ref={player.hostRef} className="w-full h-full" />
        {open && player.error && (
          <div className="absolute inset-0 bg-black/85 text-white flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="w-6 h-6 text-amber-400" />
            <p className="text-sm">{player.error}</p>
            <a
              className="flex items-center gap-1 text-xs text-brand-200 underline"
              href={mode === 'group' && group.state.videoId ? youTubeWatchUrl(group.state.videoId) : solo.videoId ? youTubeWatchUrl(solo.videoId) : 'https://www.youtube.com'}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open on YouTube <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
        {open && !player.error && needsTap && (
          <div className="absolute inset-0 bg-black/70 text-white flex flex-col items-center justify-center gap-2">
            <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-brand-500 flex items-center justify-center shadow-lg active:scale-95" aria-label="Tap to play">
              <Play className="w-7 h-7" />
            </button>
            <p className="text-xs text-white/90 px-4 text-center">Your browser blocked autoplay. Tap to join playback.</p>
          </div>
        )}
        {open && !player.error && !needsTap && player.phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-xs">Loading player…</div>
        )}
      </div>

      {open ? (
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 bg-brand-600 text-white shrink-0">
            <span className="flex items-center gap-2 font-bold">
              <Music className="w-4 h-4" /> Music
            </span>
            <div className="flex items-center gap-1">
              {isGroup && (
                <div className="flex rounded-full bg-black/15 p-0.5 text-xs">
                  {(['solo', 'group'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-3 py-1 rounded-full capitalize ${mode === m ? 'bg-white text-brand-700 font-semibold' : 'text-white/80'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={onClose} aria-label="Close music" className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto nice-scroll">
            {mode === 'group' && !groupEnabled && (
              <p className="m-3 text-xs text-gray-500 dark:text-zinc-400 bg-black/5 dark:bg-white/5 rounded-xl px-3 py-2">
                Open a group chat to start a shared listening session.
              </p>
            )}

            <div className="p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  className="flex-1 min-w-0 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-2 text-sm bg-transparent dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  placeholder="Paste a YouTube link…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitInput(false)
                  }}
                />
                <button onClick={() => submitInput(false)} disabled={!input.trim()} className="shrink-0 bg-brand-500 disabled:opacity-40 text-white rounded-full px-4 py-2 text-sm font-semibold">
                  Play
                </button>
              </div>
              {mode === 'group' && groupEnabled && (
                <button onClick={() => submitInput(true)} disabled={!input.trim()} className="flex items-center gap-1 text-xs text-brand-600 disabled:opacity-40">
                  <Plus className="w-3.5 h-3.5" /> Add to shared queue
                </button>
              )}
              {inputError && <p className="text-xs text-red-600">{inputError}</p>}
            </div>

            {hasTrack && (
              <div className="px-3 pb-2">
                <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-zinc-400 mb-1">
                  <span className="truncate font-medium text-gray-800 dark:text-zinc-200">
                    {player.title || (mode === 'group' ? group.state.queue.find((t) => t.videoId === group.state.videoId)?.title : solo.title) || 'YouTube track'}
                  </span>
                  <span className="shrink-0 font-mono">{formatTime(displayTime)} / {formatTime(player.duration)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxTime}
                  step={1}
                  value={Math.min(displayTime, maxTime)}
                  onChange={(e) => setScrub(Number(e.target.value))}
                  onPointerUp={() => { if (scrub !== null) commitSeek(scrub) }}
                  onKeyUp={() => { if (scrub !== null) commitSeek(scrub) }}
                  className="w-full accent-brand-500"
                  aria-label="Seek"
                />
                <div className="flex items-center justify-center gap-4 mt-1">
                  <button onClick={() => commitSeek(Math.max(0, player.getTime() - 10))} aria-label="Back 10 seconds" className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300 text-xs font-bold">−10</button>
                  <button onClick={togglePlay} aria-label={player.phase === 'playing' ? 'Pause' : 'Play'} className="w-12 h-12 rounded-full bg-brand-500 text-white flex items-center justify-center shadow active:scale-95">
                    {player.phase === 'playing' ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>
                  <button onClick={() => commitSeek(player.getTime() + 10)} aria-label="Forward 10 seconds" className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300 text-xs font-bold">+10</button>
                </div>
              </div>
            )}

            {mode === 'group' && groupEnabled && (
              <div className="mx-3 mb-2 rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300">
                  <Radio className={`w-3.5 h-3.5 ${group.status === 'connected' ? 'text-emerald-500' : group.status === 'error' ? 'text-amber-500' : 'text-gray-400'}`} />
                  <span>{statusLabel}</span>
                  <span className="ml-auto flex items-center gap-1 text-gray-400">
                    <Users className="w-3.5 h-3.5" /> {group.participants.length}
                  </span>
                </div>
                {group.error && <p className="text-[11px] text-amber-600">{group.error}</p>}
                {group.state.videoId && (
                  <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                    {group.isController ? 'You control playback' : group.state.updatedByName ? `${group.state.updatedByName} controls playback` : 'Someone controls playback'}
                    {' · '}positions are approximate
                  </p>
                )}
                <div className="flex gap-2 pt-0.5">
                  <button onClick={() => group.requestState()} className="text-[11px] text-brand-600">Sync now</button>
                  {group.state.videoId && <button onClick={() => { stop(); void group.endSession() }} className="text-[11px] text-red-600">End session</button>}
                </div>
              </div>
            )}

            <div className="px-3 pb-3">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">
                <ListMusic className="w-3.5 h-3.5" /> {mode === 'group' ? 'Shared queue' : 'Queue'}
              </p>
              {(() => {
                const queue = mode === 'group' ? group.state.queue : []
                if (queue.length === 0) {
                  return <p className="text-xs text-gray-400">{mode === 'group' ? 'Queue is empty. Add tracks for the group.' : 'Group queue is available in group chats.'}</p>
                }
                return (
                  <ul className="space-y-1">
                    {queue.map((track) => (
                      <li key={track.videoId} className="flex items-center gap-2 text-sm">
                        <button onClick={() => playQueueItem(track.videoId, track.title)} className="flex-1 min-w-0 text-left truncate text-gray-800 dark:text-zinc-200 hover:text-brand-600">
                          {track.title || track.videoId}
                          {track.byName ? <span className="text-gray-400 text-xs"> · {track.byName}</span> : null}
                        </button>
                        <button onClick={() => group.removeFromQueue(track.videoId)} aria-label="Remove from queue" className="text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
          </div>
          <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-zinc-500 border-t border-black/5 dark:border-white/5 shrink-0">
            Playback uses the official YouTube embedded player. Videos that disallow embedding won't play, and background audio depends on your browser.
          </p>
        </div>
      ) : hasTrack ? (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-gray-900 dark:text-zinc-100">
              {player.title || (mode === 'group' ? group.state.queue.find((t) => t.videoId === group.state.videoId)?.title : solo.title) || 'YouTube track'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
              {mode === 'group' ? `Group · ${statusLabel ?? 'music'}` : 'Solo'}
            </p>
          </div>
          <button onClick={togglePlay} aria-label={player.phase === 'playing' ? 'Pause' : 'Play'} className="w-9 h-9 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center">
            {player.phase === 'playing' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={onClose} aria-label="Expand music" className="w-9 h-9 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={stop} aria-label="Stop music" className="w-9 h-9 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
