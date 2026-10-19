import { useEffect, useRef, useState } from 'react'
import { ListMusic, Loader2, Music, Plus, Search, Trash2, Users, X } from 'lucide-react'
import { findYouTubeLink, searchEnabled, searchYouTube, type YouTubeSearchResult } from '../lib/youtube'
import { useMusic } from './MusicProvider'

export function MusicPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const music = useMusic()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<YouTubeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const searchAbort = useRef<AbortController | null>(null)

  useEffect(() => () => searchAbort.current?.abort(), [])

  if (!open) return null

  const runSearch = async () => {
    const q = query.trim()
    if (!q || searching) return
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setSearching(true)
    setSearchError(null)
    try {
      const found = await searchYouTube(q, controller.signal)
      if (controller.signal.aborted) return
      setResults(found)
      if (found.length === 0) setSearchError('No results. Try different words.')
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      setResults([])
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      if (searchAbort.current === controller) setSearching(false)
    }
  }

  const playLink = async () => {
    const parsed = findYouTubeLink(link) ?? null
    if (!parsed) {
      setLinkError('Paste a valid YouTube link or video ID.')
      return
    }
    setLinkBusy(true)
    setLinkError(null)
    try {
      await music.startFromLink(parsed)
      setLink('')
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not play that link.')
    } finally {
      setLinkBusy(false)
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-96 max-h-[85vh] rounded-t-3xl sm:rounded-2xl shadow-2xl bg-white dark:bg-[#111b21] border border-black/5 dark:border-white/10 z-40 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-brand-600 text-white shrink-0">
        <span className="flex items-center gap-2 font-bold">
          <Music className="w-4 h-4" /> Shared music
        </span>
        <button onClick={onClose} aria-label="Close music" className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll p-3 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              className="w-full border border-black/10 dark:border-white/10 rounded-full pl-9 pr-3 py-2 text-sm bg-transparent dark:text-zinc-100 dark:placeholder:text-zinc-500"
              placeholder="Search songs or artists…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runSearch()
                }
              }}
            />
          </div>
          <button onClick={() => void runSearch()} disabled={!query.trim() || searching} className="shrink-0 bg-brand-500 disabled:opacity-40 text-white rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Search
          </button>
        </div>

        {!searchEnabled && (
          <p className="text-[11px] text-gray-500 dark:text-zinc-400 bg-black/5 dark:bg-white/5 rounded-xl px-3 py-2">
            Search needs a YouTube Data API key. Add <code className="font-mono">VITE_YOUTUBE_API_KEY</code> to enable it. You can still paste a link below.
          </p>
        )}
        {searchError && <p className="text-xs text-red-600">{searchError}</p>}

        {results.length > 0 && (
          <ul className="max-h-64 overflow-y-auto nice-scroll rounded-xl border border-black/5 dark:border-white/10 divide-y divide-black/5 dark:divide-white/5">
            {results.map((r) => (
              <li key={r.videoId} className="flex items-center gap-2 p-2">
                {r.thumbnail ? (
                  <img src={r.thumbnail} alt="" loading="lazy" className="w-16 h-9 rounded object-cover shrink-0 bg-black/10" />
                ) : (
                  <div className="w-16 h-9 rounded shrink-0 bg-black/10" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 dark:text-zinc-200 truncate">{r.title}</p>
                  {r.channelTitle && <p className="text-[11px] text-gray-400 truncate">{r.channelTitle}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => music.startVideo(r.videoId, r.title)} className="text-[11px] font-semibold text-white bg-brand-500 rounded-full px-2.5 py-1">Play</button>
                  <button onClick={() => music.addToQueue({ videoId: r.videoId, title: r.title })} aria-label="Add to shared queue" className="text-brand-600 rounded-full p-1.5 hover:bg-black/5 dark:hover:bg-white/10">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="text-xs">
          <summary className="cursor-pointer text-gray-500 dark:text-zinc-400 select-none">Have a link or playlist?</summary>
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 border border-black/10 dark:border-white/10 rounded-full px-3.5 py-2 text-sm bg-transparent dark:text-zinc-100 dark:placeholder:text-zinc-500"
                placeholder="Paste a YouTube link or playlist…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void playLink()
                }}
              />
              <button onClick={() => void playLink()} disabled={!link.trim() || linkBusy} className="shrink-0 bg-brand-500 disabled:opacity-40 text-white rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                {linkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Play
              </button>
            </div>
            <button onClick={() => { const l = findYouTubeLink(link); if (l?.videoId) music.addToQueue({ videoId: l.videoId }) }} disabled={!link.trim()} className="flex items-center gap-1 text-xs text-brand-600 disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Add link to shared queue
            </button>
            {linkError && <p className="text-xs text-red-600">{linkError}</p>}
          </div>
        </details>

        {music.state.videoId && (
          <div className="rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300">
              <Music className="w-3.5 h-3.5 text-emerald-500" />
              <span className="truncate">{music.state.title || 'Now playing'}</span>
              <span className="ml-auto flex items-center gap-1 text-gray-400 shrink-0">
                <Users className="w-3.5 h-3.5" /> {music.participants.length}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => music.requestState()} className="text-[11px] text-brand-600">Sync now</button>
              {music.state.playlistId && <span className="text-[11px] text-gray-400">playlist</span>}
            </div>
          </div>
        )}

        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">
            <ListMusic className="w-3.5 h-3.5" /> Shared queue · {music.state.queue.length}
          </p>
          {music.state.queue.length === 0 ? (
            <p className="text-xs text-gray-400">Queue is empty. Search or paste a link, then add it for everyone.</p>
          ) : (
            <ul className="space-y-1">
              {music.state.queue.map((track) => (
                <li key={track.videoId} className="flex items-center gap-2 text-sm">
                  <button onClick={() => music.startVideo(track.videoId, track.title)} className="flex-1 min-w-0 text-left truncate text-gray-800 dark:text-zinc-200 hover:text-brand-600">
                    {track.title || track.videoId}
                    {track.byName ? <span className="text-gray-400 text-xs"> · {track.byName}</span> : null}
                  </button>
                  <button onClick={() => music.removeFromQueue(track.videoId)} aria-label="Remove from queue" className="text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-zinc-500 border-t border-black/5 dark:border-white/5 shrink-0">
        Playback uses the official YouTube embedded player. Anyone in this chat can control it. Videos that disallow embedding won't play.
      </p>
    </div>
  )
}
