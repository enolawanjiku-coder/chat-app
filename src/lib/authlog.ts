// Tiny persistent auth-event log. Survives redirects/reloads so a login loop
// leaves footprints we can read on the login screen.
const KEY = 'sc-authlog'
const MAX = 10

export function authLog(event: string): void {
  try {
    const raw = localStorage.getItem(KEY)
    const arr: string[] = raw ? JSON.parse(raw) : []
    arr.push(`${new Date().toLocaleTimeString()} ${event}`)
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX)))
  } catch {
    // ignore
  }
}

export function readAuthLog(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function clearAuthLog(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
