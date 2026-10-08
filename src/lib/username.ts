// Real-email auth: Supabase Auth uses the user's actual email.
// Username is still required for chat identity and stored in profiles.username.
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(username)
}

export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}
