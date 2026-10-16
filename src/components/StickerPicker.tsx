import { useEffect, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import imageCompression from 'browser-image-compression'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

const EMOJI_PACK = ['😂', '❤️', '👍', '🔥', '😮', '😢', '🙏', '👏', '😴', '🤔', '😎', '🥳', '😭', '💯', '👀', '✨', '🎉', '💔', '🤣', '😇', '🥺', '👋', '💪', '🙌']

export type StickerRow = { id: string; image_path: string }

export function StickerPicker({
  conversationId,
  onSent,
}: {
  conversationId: string
  onSent: () => void
}) {
  const userId = useAuthStore((s) => s.userId)
  const [tab, setTab] = useState<'emoji' | 'saved'>('emoji')
  const [saved, setSaved] = useState<StickerRow[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (tab !== 'saved' || !userId) return
    supabase.from('stickers').select('id, image_path').eq('user_id', userId).order('created_at', { ascending: false }).then(({ data }) => {
      setSaved((data ?? []) as StickerRow[])
    })
  }, [tab, userId])

  const sendEmoji = async (emoji: string) => {
    if (!userId) return
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      type: 'sticker',
      body: emoji,
    })
    if (!error) onSent()
  }

  const sendSaved = async (s: StickerRow) => {
    if (!userId) return
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      type: 'sticker',
      image_path: s.image_path,
    })
    if (!error) onSent()
  }

  const uploadCustom = async (file: File) => {
    if (!userId) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('Stickers must be png/jpg/webp (transparent PNG works best)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Max 2MB for stickers')
      return
    }
    setBusy(true)
    try {
      // keep transparency: never convert to jpeg
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 512,
        maxSizeMB: 0.5,
        useWebWorker: true,
        fileType: file.type === 'image/png' ? 'image/png' : undefined,
      })
      const ext = file.type === 'image/png' ? 'png' : 'jpg'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`
      const { error: upError } = await supabase.storage.from('stickers').upload(path, compressed)
      if (upError) throw upError
      const { error: dbError } = await supabase.from('stickers').insert({ user_id: userId, image_path: path })
      if (dbError) throw dbError
      setTab('saved')
      const { data } = await supabase.from('stickers').select('id, image_path').eq('user_id', userId).order('created_at', { ascending: false })
      setSaved((data ?? []) as StickerRow[])
      onSent()
      // send it straight away too
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userId,
        type: 'sticker',
        image_path: path,
      })
      onSent()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sticker upload failed')
    } finally {
      setBusy(false)
    }
  }

  const stickerUrl = (path: string) => supabase.storage.from('stickers').getPublicUrl(path).data.publicUrl

  return (
    <div className="bg-white dark:bg-[#1f2c34] rounded-t-3xl shadow-2xl border-t border-black/5 dark:border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-h-72 overflow-y-auto nice-scroll">
      <div className="flex items-center gap-2 mb-2">
        {(['emoji', 'saved'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-semibold capitalize rounded-full ${tab === t ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10 text-gray-600 dark:text-zinc-300'}`}
          >
            {t === 'emoji' ? 'Emoji' : 'Saved'}
          </button>
        ))}
        <label className="cursor-pointer flex items-center gap-1 text-xs font-semibold text-brand-600 px-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} New
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadCustom(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {tab === 'emoji' ? (
        <div className="grid grid-cols-8 gap-1">
          {EMOJI_PACK.map((e) => (
            <button key={e} onClick={() => sendEmoji(e)} className="text-3xl p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition">
              {e}
            </button>
          ))}
        </div>
      ) : saved.length === 0 ? (
        <p className="text-center text-xs text-gray-500 dark:text-zinc-400 py-6">
          No saved stickers yet.<br />Upload one with New, or long-press → save on any photo in chat.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {saved.map((s) => (
            <button key={s.id} onClick={() => sendSaved(s)} className="rounded-xl hover:bg-black/5 dark:hover:bg-white/10 p-1 active:scale-95 transition">
              <img src={stickerUrl(s.image_path)} alt="sticker" className="w-full h-20 object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
