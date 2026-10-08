import { create } from 'zustand'
import type { Profile } from '../lib/types'

type AuthState = {
  userId: string | null
  profile: Profile | null
  setAuth: (userId: string | null, profile: Profile | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  profile: null,
  setAuth: (userId, profile) => set({ userId, profile }),
  clear: () => set({ userId: null, profile: null }),
}))
