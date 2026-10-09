import { create } from 'zustand'
import type { Profile } from '../lib/types'

type AuthState = {
  userId: string | null
  profile: Profile | null
  hydrated: boolean
  setAuth: (userId: string | null, profile: Profile | null) => void
  setHydrated: () => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  profile: null,
  hydrated: false,
  setAuth: (userId, profile) => set({ userId, profile }),
  setHydrated: () => set({ hydrated: true }),
  clear: () => set({ userId: null, profile: null }),
}))
