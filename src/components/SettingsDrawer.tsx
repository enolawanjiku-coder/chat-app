import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Bell, ImageIcon, LogOut, Moon, Palette, Sun, User, Volume2, VolumeX, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { WALLPAPERS } from '../lib/wallpapers'

export function SettingsDrawer({
  open,
  onClose,
  dark,
  onToggleDark,
  muted,
  onToggleSound,
  notifOn,
  onEnableNotif,
  wallpaperId,
  onPickWallpaper,
  onLogout,
}: {
  open: boolean
  onClose: () => void
  dark: boolean
  onToggleDark: () => void
  muted: boolean
  onToggleSound: () => void
  notifOn: boolean
  onEnableNotif: () => void
  wallpaperId: string
  onPickWallpaper: (id: string) => void
  onLogout: () => void
}) {
  const userId = useAuthStore((s) => s.userId)
  const profile = useAuthStore((s) => s.profile)
  const [blocks, setBlocks] = useState<{ blocked_id: string; username?: string }[]>([])
  const [blockUser, setBlockUser] = useState('')

  const loadBlocks = async () => {
    if (!userId) return
    const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', userId)
    const rows = data ?? []
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', rows.length ? rows.map((r) => r.blocked_id) : ['00000000-0000-0000-0000-000000000000'])
    const pmap = new Map(((profiles ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]))
    setBlocks(rows.map((r) => ({ ...r, username: pmap.get(r.blocked_id) })))
  }

  useEffect(() => {
    if (open) loadBlocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId])

  const block = async () => {
    const q = blockUser.trim().toLowerCase()
    if (!q) return
    const { data: user } = await supabase.from('profiles').select('id').eq('username', q).maybeSingle()
    if (!user) return
    await supabase.from('blocks').insert({ blocker_id: userId, blocked_id: user.id })
    setBlockUser('')
    loadBlocks()
  }

  const unblock = async (bid: string) => {
    await supabase.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', bid)
    loadBlocks()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-white dark:bg-[#111b21] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-brand-600 text-white">
          <span className="font-bold">Settings</span>
          <button onClick={onClose} aria-label="Close settings" className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto nice-scroll">
          <Link to="/profile" onClick={onClose} className="flex items-center gap-3 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5">
            <span className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-lg">
              {(profile?.username ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-gray-900 dark:text-zinc-100 truncate">@{profile?.username}</span>
              <span className="flex items-center gap-1 text-xs text-gray-500"><User className="w-3.5 h-3.5" /> Profile & bio</span>
            </span>
          </Link>

          <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Appearance</p>
          <button onClick={onToggleDark} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 text-left">
            {dark ? <Sun className="w-5 h-5 text-gray-500" /> : <Moon className="w-5 h-5 text-gray-500" />}
            <span className="flex-1 text-sm text-gray-900 dark:text-zinc-100">Dark mode</span>
            <span className={`w-10 h-6 rounded-full p-0.5 transition ${dark ? 'bg-brand-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${dark ? 'ml-auto' : ''}`} />
            </span>
          </button>
          <div className="px-4 py-2">
            <p className="flex items-center gap-2 text-sm text-gray-900 dark:text-zinc-100 mb-2"><Palette className="w-4 h-4 text-gray-500" /> Chat wallpaper</p>
            <div className="grid grid-cols-4 gap-2">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => onPickWallpaper(w.id)}
                  className={`rounded-xl overflow-hidden border-2 ${wallpaperId === w.id ? 'border-brand-500' : 'border-black/10 dark:border-white/10'}`}
                >
                  {w.src ? <img src={w.src} alt={w.label} className="w-full h-12 object-cover" /> : <span className="block w-full h-12 chat-wallpaper" />}
                  <span className="block text-[9px] text-center text-gray-500 dark:text-zinc-400 py-0.5 truncate">{w.label}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Sounds & notifications</p>
          <button onClick={onToggleSound} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 text-left">
            {muted ? <VolumeX className="w-5 h-5 text-gray-500" /> : <Volume2 className="w-5 h-5 text-gray-500" />}
            <span className="flex-1 text-sm text-gray-900 dark:text-zinc-100">Message & call sounds</span>
            <span className={`w-10 h-6 rounded-full p-0.5 transition ${!muted ? 'bg-brand-500' : 'bg-gray-300'}`}>
              <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${!muted ? 'ml-auto' : ''}`} />
            </span>
          </button>
          <button onClick={onEnableNotif} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 text-left">
            <Bell className="w-5 h-5 text-gray-500" />
            <span className="flex-1 text-sm text-gray-900 dark:text-zinc-100">Browser notifications</span>
            <span className="text-xs text-gray-400">{notifOn ? 'On' : 'Off'}</span>
          </button>

          <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Privacy</p>
          <div className="px-4 py-2">
            <p className="flex items-center gap-2 text-sm text-gray-900 dark:text-zinc-100 mb-2"><Ban className="w-4 h-4 text-gray-500" /> Blocked users</p>
            <div className="flex gap-2 mb-2">
              <input className="flex-1 min-w-0 border border-black/10 dark:border-white/10 rounded-full px-3 py-1.5 text-sm bg-transparent dark:text-zinc-100" placeholder="username" value={blockUser} onChange={(e) => setBlockUser(e.target.value)} />
              <button onClick={block} className="text-sm bg-gray-900 dark:bg-zinc-700 text-white rounded-full px-3">Block</button>
            </div>
            {blocks.map((b) => (
              <div key={b.blocked_id} className="flex justify-between items-center text-sm py-1">
                <span className="dark:text-zinc-200">@{b.username ?? b.blocked_id.slice(0, 6)}</span>
                <button onClick={() => unblock(b.blocked_id)} className="text-brand-600 text-xs font-medium">Unblock</button>
              </div>
            ))}
            {blocks.length === 0 && <p className="text-xs text-gray-400">Nobody blocked.</p>}
          </div>

          <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Media</p>
          <div className="px-4 py-2 flex items-center gap-3 text-sm text-gray-900 dark:text-zinc-100">
            <ImageIcon className="w-5 h-5 text-gray-500" />
            <span>Photos compress before upload (max 5MB)</span>
          </div>
        </div>

        <button onClick={onLogout} className="m-3 flex items-center justify-center gap-2 bg-red-50 dark:bg-red-950 text-red-600 rounded-2xl py-2.5 text-sm font-semibold">
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </aside>
    </div>
  )
}
