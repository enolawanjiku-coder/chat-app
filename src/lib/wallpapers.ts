export type WallpaperOption = {
  id: string
  label: string
  src: string | null // null = default doodle
}

export const WALLPAPERS: WallpaperOption[] = [
  { id: 'default', label: 'Default', src: null },
  { id: 'bloom-corner', label: 'Bloom Corner', src: '/wallpapers/bloom-corner.jpg' },
  { id: 'bloom-bouquet', label: 'Bouquet', src: '/wallpapers/bloom-bouquet.jpg' },
  { id: 'bloom-burgundy', label: 'Burgundy', src: '/wallpapers/bloom-burgundy.jpg' },
]

const KEY = 'sc-wallpaper'

export function getWallpaper(): string {
  return localStorage.getItem(KEY) ?? 'default'
}

export function setWallpaper(id: string): void {
  localStorage.setItem(KEY, id)
}

export function wallpaperSrc(id: string): string | null {
  return WALLPAPERS.find((w) => w.id === id)?.src ?? null
}
