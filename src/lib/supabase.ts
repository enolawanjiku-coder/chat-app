import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anon) {
  console.warn('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them to .env')
}

// Permanent sessions: localStorage (survives restarts) mirrored to a
// long-lived cookie as backup (helps installed PWAs / strict browsers).
// Only an explicit logout clears both.
const COOKIE_DAYS = 365

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(name: string, value: string): void {
  const exp = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`
}

const persistentStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key) ?? readCookie(key)
    } catch {
      return readCookie(key)
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // storage full/blocked — cookie still saves the session
    }
    try {
      writeCookie(key, value)
    } catch {
      // ignore
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
    deleteCookie(key)
  },
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    storage: persistentStorage,
    storageKey: 'sc-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
