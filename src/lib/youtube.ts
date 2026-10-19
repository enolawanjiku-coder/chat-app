// Official YouTube IFrame Player API loader + URL/ID helpers.
// Docs: https://developers.google.com/youtube/iframe_api_reference
// We only ever use the official embedded player (never download/proxy audio).

export type YouTubeVideoData = { title?: string; video_id?: string; author?: string }
export type YouTubePlayer = {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void
  cueVideoById: (opts: { videoId: string; startSeconds?: number }) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  getVideoData: () => YouTubeVideoData
  mute: () => void
  unMute: () => void
  isMuted: () => boolean
  setVolume: (volume: number) => void
  destroy: () => void
}

type YouTubePlayerCtor = new (
  element: HTMLElement | string,
  options: {
    videoId?: string
    width?: string | number
    height?: string | number
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: (event: { target: YouTubePlayer }) => void
      onStateChange?: (event: { target: YouTubePlayer; data: number }) => void
      onError?: (event: { target: YouTubePlayer; data: number }) => void
    }
  },
) => YouTubePlayer

type YouTubeApi = {
  Player: YouTubePlayerCtor
  PlayerState: {
    UNSTARTED: number
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

// Player state values, mirrored so we don't depend on window.YT timing.
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

let apiPromise: Promise<void> | null = null

/** Loads the official IFrame API exactly once; resolves when window.YT.Player is usable. */
export function loadYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube player requires a browser'))
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.dataset.ytIframeApi = 'true'
      script.onerror = () => reject(new Error('Could not load the YouTube player. Check your connection.'))
      document.head.appendChild(script)
    }
    // The API can already be halfway through when this is called; poll briefly.
    const started = Date.now()
    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll)
        resolve()
      } else if (Date.now() - started > 12000) {
        window.clearInterval(poll)
        reject(new Error('YouTube player timed out loading.'))
      }
    }, 200)
  })
  return apiPromise
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

export function isValidVideoId(id: string | null | undefined): id is string {
  return typeof id === 'string' && VIDEO_ID_RE.test(id)
}

/**
 * Extracts an 11-char video id from a raw id or any common YouTube URL form:
 * watch?v=, youtu.be/, /embed/, /shorts/, /live/, music.youtube.com.
 * Returns null for anything we cannot confidently validate.
 */
export function parseYouTubeId(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (VIDEO_ID_RE.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '')
  const v = url.searchParams.get('v')
  if (v && VIDEO_ID_RE.test(v)) return v

  const segments = url.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be' && segments[0] && VIDEO_ID_RE.test(segments[0])) return segments[0]

  if (['youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const marker = segments.findIndex((s) => s === 'embed' || s === 'shorts' || s === 'live' || s === 'v')
    if (marker >= 0) {
      const candidate = segments[marker + 1]
      if (candidate && VIDEO_ID_RE.test(candidate)) return candidate
    }
  }
  return null
}

export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** Human message for the IFrame API onError codes. */
export function youTubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'That video ID looks invalid.'
    case 5:
      return 'This video can\'t be played in the embedded player.'
    case 100:
      return 'This video was removed or made private.'
    case 101:
    case 150:
      return 'The owner doesn\'t allow this video to be embedded.'
    default:
      return 'This video can\'t be played here.'
  }
}
