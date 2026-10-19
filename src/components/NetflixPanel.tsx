import { ExternalLink, Info, Loader2, ShieldCheck, Square, Tv2, X } from 'lucide-react'
import { useScreenShareCtx } from './ScreenShareProvider'

const NETFLIX_URL = 'https://www.netflix.com/browse'

/**
 * Netflix watch & share entry point. We never handle Netflix credentials — the
 * user signs in on netflix.com in their own tab and shares that tab/window with
 * the browser's own screen picker.
 */
export function NetflixPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useScreenShareCtx()
  if (!open) return null

  const openNetflix = () => {
    window.open(NETFLIX_URL, '_blank', 'noopener,noreferrer')
  }

  const sharing = s.role === 'sharer'

  return (
    <div className="fixed inset-x-0 bottom-0 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-96 max-h-[85vh] rounded-t-3xl sm:rounded-2xl shadow-2xl bg-white dark:bg-[#111b21] border border-black/5 dark:border-white/10 z-40 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-brand-600 text-white shrink-0">
        <span className="flex items-center gap-2 font-bold">
          <Tv2 className="w-4 h-4" /> Netflix · watch together
        </span>
        <button onClick={onClose} aria-label="Close Netflix" className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll p-3 space-y-3">
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Sign in to your own Netflix account, then share your screen so the person you’re chatting with can watch along.
        </p>

        <button
          onClick={openNetflix}
          className="w-full flex items-center justify-center gap-2 bg-brand-500 text-white rounded-2xl py-3 font-semibold active:scale-[.99]"
        >
          <ExternalLink className="w-5 h-5" /> Open Netflix
        </button>

        {sharing ? (
          <button
            onClick={s.stopShare}
            className="w-full flex items-center justify-center gap-2 bg-red-600 text-white rounded-2xl py-3 font-semibold active:scale-[.99]"
          >
            <Square className="w-5 h-5" /> Stop sharing
          </button>
        ) : (
          <button
            onClick={() => void s.startShare()}
            disabled={!s.canShare || s.phase === 'starting'}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 dark:bg-zinc-700 disabled:opacity-40 text-white rounded-2xl py-3 font-semibold active:scale-[.99]"
          >
            {s.phase === 'starting' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Tv2 className="w-5 h-5" />} Share my screen
          </button>
        )}

        {!s.canShare && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-xl px-3 py-2">
            Screen sharing works in a one-to-one chat. Open a direct conversation to share with someone.
          </p>
        )}

        {(s.error || s.notice) && (
          <p className="text-xs text-red-600 dark:text-red-400">{s.error ?? s.notice}</p>
        )}

        {sharing && s.phase !== 'idle' && (
          <p className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {s.phase === 'live' ? 'Sharing now' : s.phase === 'ringing' ? 'Waiting for them to accept…' : 'Connecting…'}
          </p>
        )}

        <div className="rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2 space-y-1.5 text-[11px] text-gray-500 dark:text-zinc-400">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
            You use your own Netflix account and subscription. You are responsible for it.
          </p>
          <p className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            We never ask for and never store your Netflix password, cookies or session. You sign in only on netflix.com.
          </p>
          <p className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Netflix video may appear black while sharing because of content protection (DRM). This is enforced by the browser and Netflix — it can’t be bypassed.
          </p>
          <p className="flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Netflix doesn’t offer an official account-linking/SSO integration for apps like this, so there is no “connect account” button.
          </p>
        </div>
      </div>

      <p className="px-3 py-2 text-[10px] text-gray-400 dark:text-zinc-500 border-t border-black/5 dark:border-white/5 shrink-0">
        Screen video travels directly between the two people over WebRTC and is never recorded or stored.
      </p>
    </div>
  )
}
