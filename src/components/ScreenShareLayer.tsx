import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Scaling,
  ScreenShare,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useScreenShareCtx } from './ScreenShareProvider'

function StreamVideo({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted: boolean
  className: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play?.().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />
}

function statusText(role: 'sharer' | 'viewer', phase: string, remoteHasAudio: boolean): string {
  switch (phase) {
    case 'starting':
      return 'Starting…'
    case 'ringing':
      return role === 'sharer' ? 'Waiting for them to accept…' : 'Incoming…'
    case 'connecting':
      return 'Connecting…'
    case 'live':
      return role === 'sharer'
        ? remoteHasAudio
          ? 'Live · sharing with audio'
          : 'Live · no audio captured'
        : 'Live'
    case 'failed':
      return 'Connection failed'
    default:
      return ''
  }
}

type OrientationLockApi = {
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
}

/** Fullscreen + landscape. Orientation lock is Android/Chrome only and needs fullscreen. */
async function enterImmersive() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
  } catch {
    /* iOS Safari can't fullscreen arbitrary elements */
  }
  try {
    await (screen.orientation as unknown as OrientationLockApi)?.lock?.('landscape')
  } catch {
    /* unsupported (iOS/desktop) — the layout still works in portrait */
  }
}

function exitImmersive() {
  try {
    if (document.fullscreenElement) void document.exitFullscreen()
  } catch {
    /* ignore */
  }
  try {
    ;(screen.orientation as unknown as OrientationLockApi)?.unlock?.()
  } catch {
    /* ignore */
  }
}

/** Header toggle for starting/stopping a screen share (1:1 chats only). */
export function ScreenShareButton() {
  const s = useScreenShareCtx()
  if (!s.canShare && !s.role) return null
  const sharing = s.role === 'sharer'
  return (
    <button
      onClick={() => (sharing ? s.stopShare() : void s.startShare())}
      title={sharing ? 'Stop sharing' : 'Share screen'}
      aria-label={sharing ? 'Stop sharing screen' : 'Share screen'}
      className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center ${sharing ? 'bg-red-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10 text-gray-600 dark:text-zinc-300'}`}
    >
      <ScreenShare className="w-5 h-5" />
    </button>
  )
}

/** Incoming picker, docked bar and fullscreen viewer for 1:1 screen sharing. */
export function ScreenShareLayer() {
  const s = useScreenShareCtx()
  const [expanded, setExpanded] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fill, setFill] = useState(false)
  const isSharer = s.role === 'sharer'
  const stream = isSharer ? s.localStream : s.remoteStream

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Leaving a session resets the expanded viewer.
  useEffect(() => {
    if (!s.role) {
      setExpanded(false)
      exitImmersive()
    }
  }, [s.role])

  // ── Incoming share request (viewer hasn't accepted yet) ───────────────────
  if (s.incoming && !s.role) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-zinc-800 rounded-3xl p-6 w-full max-w-xs text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-full bg-brand-100 text-brand-700 flex items-center justify-center">
            <ScreenShare className="w-7 h-7" />
          </div>
          <div>
            <p className="font-bold text-lg dark:text-white">{s.incoming.fromName} is sharing their screen</p>
            <p className="text-xs text-gray-500 mt-1">You can watch, but you can’t control their device.</p>
          </div>
          <div className="flex justify-center gap-4">
            <button
              onClick={s.decline}
              className="w-14 h-14 rounded-full bg-red-500 text-white shadow active:scale-95 flex items-center justify-center"
              aria-label="Decline screen share"
            >
              <X className="w-6 h-6" />
            </button>
            <button
              onClick={() => void s.accept()}
              className="w-14 h-14 rounded-full bg-green-500 text-white shadow active:scale-95 flex items-center justify-center"
              aria-label="Watch screen share"
            >
              <ScreenShare className="w-6 h-6" />
            </button>
          </div>
          <p className="text-[11px] text-gray-400">Netflix and other protected video may appear black — this is a browser/DRM restriction, not a bug.</p>
        </div>
      </div>
    )
  }

  // ── Idle error/notice toast (e.g. permission denied while starting) ───────
  if (!s.role) {
    const message = s.error ?? s.notice
    if (!message) return null
    return (
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 max-w-[90vw] bg-gray-900 text-white text-sm rounded-2xl px-4 py-2 shadow-lg flex items-center gap-2">
        {s.error ? <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" /> : <Info className="w-4 h-4 text-sky-400 shrink-0" />}
        <span className="min-w-0">{message}</span>
        <button onClick={s.clearError} aria-label="Dismiss" className="ml-1 opacity-70 hover:opacity-100 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const label = isSharer ? 'Sharing your screen' : `${s.peerName} is sharing`
  const sub =
    s.signalStatus === 'error'
      ? 'Signaling disconnected — check Realtime permissions (migration 0016).'
      : s.phase === 'failed' && s.error
        ? s.error
        : statusText(isSharer ? 'sharer' : 'viewer', s.phase, s.remoteHasAudio)

  return (
    <>
      <div className="shrink-0 border-t border-black/10 dark:border-white/10 bg-[#f0f2f5] dark:bg-[#1f2c34]">
        <div className={expanded ? 'hidden' : 'relative w-full max-h-48 bg-black flex items-center justify-center'}>
          {stream ? (
            <StreamVideo stream={stream} muted={isSharer} className="w-full max-h-48 object-contain bg-black" />
          ) : (
            <div className="py-10 flex flex-col items-center gap-2 text-white/70 text-sm">
              <Loader2 className="w-6 h-6 animate-spin" />
              {statusText(isSharer ? 'sharer' : 'viewer', s.phase, s.remoteHasAudio)}
            </div>
          )}
        </div>
        <div className="px-3 py-2 flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.phase === 'live' ? 'bg-red-500 animate-pulse' : s.phase === 'failed' ? 'bg-amber-400' : 'bg-gray-400'}`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-gray-900 dark:text-zinc-100">{label}</p>
            <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate">{sub}</p>
          </div>
          {!isSharer && (
            <button
              onClick={s.toggleMute}
              aria-label={s.muted ? 'Unmute screen audio' : 'Mute screen audio'}
              title={s.remoteHasAudio ? (s.muted ? 'Unmute' : 'Mute') : 'No audio shared'}
              className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 ${s.muted ? 'text-red-600' : 'text-gray-600 dark:text-zinc-300'} ${s.remoteHasAudio ? '' : 'opacity-40'}`}
            >
              {s.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={() => { setExpanded(true); void enterImmersive() }}
            aria-label="Expand screen share"
            className="w-9 h-9 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-gray-600 dark:text-zinc-300"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          <button
            onClick={s.stopShare}
            className="shrink-0 flex items-center gap-1.5 bg-red-600 text-white rounded-full px-3 h-9 text-sm font-semibold"
          >
            <Square className="w-4 h-4" /> {isSharer ? 'Stop' : 'Leave'}
          </button>
        </div>
        <p className="px-3 pb-2 text-[10px] text-gray-400 dark:text-zinc-500">
          {isSharer
            ? 'Your screen (or chosen tab/window) is being shared. Stop any time — nothing is recorded.'
            : 'Protected content (Netflix) may show black. This is enforced by the browser and can’t be bypassed.'}
        </p>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black">
          {stream ? (
            <StreamVideo stream={stream} muted={isSharer} className={`absolute inset-0 w-full h-full ${fill ? 'object-cover' : 'object-contain'}`} />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 text-sm">
              <Loader2 className="w-7 h-7 animate-spin" />
              {statusText(isSharer ? 'sharer' : 'viewer', s.phase, s.remoteHasAudio)}
            </div>
          )}

          <div className="absolute top-0 inset-x-0 flex items-center justify-between gap-2 px-3 py-2 text-white bg-gradient-to-b from-black/70 to-transparent">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.phase === 'live' ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-sm truncate">{label}</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setFill((f) => !f)}
                aria-label={fill ? 'Fit to screen' : 'Fill screen'}
                title={fill ? 'Fit to screen' : 'Fill screen'}
                className={`w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center ${fill ? 'text-brand-300' : ''}`}
              >
                <Scaling className="w-5 h-5" />
              </button>
              {!isSharer && (
                <button
                  onClick={s.toggleMute}
                  aria-label={s.muted ? 'Unmute screen audio' : 'Mute screen audio'}
                  disabled={!s.remoteHasAudio}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center disabled:opacity-40"
                >
                  {s.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              )}
              <button
                onClick={() => (isFullscreen ? exitImmersive() : void enterImmersive())}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen landscape'}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen (landscape)'}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center"
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
              <button
                onClick={() => { setExpanded(false); exitImmersive() }}
                aria-label="Close fullscreen viewer"
                title="Close"
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="absolute bottom-0 inset-x-0 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/70 to-transparent">
            <button onClick={s.stopShare} className="flex items-center gap-2 bg-red-600 text-white rounded-full px-6 py-3 font-semibold active:scale-95">
              <Square className="w-5 h-5" /> {isSharer ? 'Stop sharing' : 'Leave'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
