import { useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ListMusic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react'
import { useMusic, useMusicPlayer } from './MusicProvider'
import { youTubeWatchUrl } from '../lib/youtube'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The shared "TV": a single player everyone in the conversation controls. */
export function SharedPlayerBar() {
  const music = useMusic()
  const player = useMusicPlayer()
  const [collapsed, setCollapsed] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)

  const hasTrack = !!music.state.videoId
  const playing = player.phase === 'playing'
  const displayTime = scrub ?? player.currentTime
  const maxTime = Math.max(1, Math.floor(player.duration || 0))

  const commitSeek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return
    player.seek(seconds)
    music.seek(seconds)
    setScrub(null)
  }

  return (
    <div className={hasTrack ? 'shrink-0 border-t border-black/10 dark:border-white/10 bg-[#f0f2f5] dark:bg-[#1f2c34]' : 'w-px h-px overflow-hidden pointer-events-none'} aria-hidden={!hasTrack}>
      <div className={hasTrack && !collapsed ? 'relative w-full aspect-video max-h-56 bg-black' : 'w-px h-px overflow-hidden'}>
        <div ref={player.hostRef} className="w-full h-full" />
        {hasTrack && !collapsed && player.error && (
          <div className="absolute inset-0 bg-black/85 text-white flex flex-col items-center justify-center gap-2 p-4 text-center">
            <AlertCircle className="w-6 h-6 text-amber-400" />
            <p className="text-sm">{player.error}</p>
            {music.state.videoId && (
              <a className="flex items-center gap-1 text-xs text-brand-200 underline" href={youTubeWatchUrl(music.state.videoId)} target="_blank" rel="noreferrer noopener">
                Open on YouTube <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
        {hasTrack && !collapsed && !player.error && music.needsTap && (
          <div className="absolute inset-0 bg-black/70 text-white flex flex-col items-center justify-center gap-2">
            <button
              onClick={() => {
                music.clearNeedsTap()
                player.play()
              }}
              className="w-14 h-14 rounded-full bg-brand-500 flex items-center justify-center shadow-lg active:scale-95"
              aria-label="Tap to play"
            >
              <Play className="w-7 h-7" />
            </button>
            <p className="text-xs text-white/90 px-4 text-center">Your browser blocked autoplay. Tap to join playback.</p>
          </div>
        )}
      </div>

      {hasTrack && (
        <div className="px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-gray-900 dark:text-zinc-100">{music.state.title || player.title || 'YouTube'}</p>
              <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
                Shared playback · {music.participants.length} here · anyone can play/pause
                {music.state.playlistId ? ' · playlist' : ''}
              </p>
            </div>
            <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand player' : 'Minimize player'} className="w-8 h-8 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300">
              {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button onClick={() => void music.endSession()} aria-label="End shared playback for everyone" title="End for everyone" className="w-8 h-8 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-gray-500 dark:text-zinc-400 w-9 text-right shrink-0">{formatTime(displayTime)}</span>
            <input
              type="range"
              min={0}
              max={maxTime}
              step={1}
              value={Math.min(displayTime, maxTime)}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => { if (scrub !== null) commitSeek(scrub) }}
              onKeyUp={() => { if (scrub !== null) commitSeek(scrub) }}
              className="flex-1 min-w-0 accent-brand-500"
              aria-label="Seek"
            />
            <span className="text-[10px] font-mono text-gray-500 dark:text-zinc-400 w-9 shrink-0">{formatTime(player.duration)}</span>
          </div>

          <div className="flex items-center justify-center gap-4">
            <button onClick={() => music.prev()} disabled={music.state.history.length === 0} aria-label="Previous" className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-gray-600 dark:text-zinc-300">
              <SkipBack className="w-5 h-5" />
            </button>
            <button onClick={() => (playing ? music.pause(player.getTime()) : music.play(player.getTime()))} aria-label={playing ? 'Pause' : 'Play'} className="w-12 h-12 rounded-full bg-brand-500 text-white flex items-center justify-center shadow active:scale-95">
              {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            <button onClick={() => music.next()} disabled={music.state.queue.length === 0} aria-label="Next" className="w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-gray-600 dark:text-zinc-300">
              <SkipForward className="w-5 h-5" />
            </button>
            <span className="ml-1 flex items-center gap-1 text-[11px] text-gray-400 shrink-0">
              <ListMusic className="w-3.5 h-3.5" /> {music.state.queue.length}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
