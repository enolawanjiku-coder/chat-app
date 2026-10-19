# Agent notes

## Commands

```bash
npm run lint    # oxlint
npm run build   # tsc -b && vite build
npm run dev     # vite dev server
```

Always run `npm run lint` and `npm run build` before finishing a change. There is no automated test suite; verification is lint + typecheck + build plus the manual checklist below.

## Stack / conventions

- React 19 + TypeScript + Vite, Tailwind v4, Zustand, TanStack Query, `@supabase/supabase-js`.
- `tsconfig.app.json` sets `noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly` — use `import type` for types and remove unused imports.
- Reuse the existing Supabase client (`src/lib/supabase.ts`) and the existing conversation/member tables. Do not add servers or new auth flows.
- Never trust client-supplied user IDs for authorization; rely on RLS.
- All Realtime channels are created with `private: true`; access is enforced by the `realtime.messages` policies in `supabase/migrations/0014_music.sql` (see deployment below).

## Database / deployment

1. Apply `supabase/migrations/0014_music.sql` and `0015_music_playlist.sql` (after `0001`–`0013`).
2. To enforce Realtime authorization: Dashboard → Project Settings → Realtime → disable **Allow public access**. Do **not** run `alter table realtime.messages enable row level security`.
3. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL` (unchanged), plus `VITE_YOUTUBE_API_KEY` to enable music search (see below). Deploy on Vercel as usual.

## Media: shared YouTube "TV" in the chat

A conversation-scoped shared player that works in **direct and group** chats. Anyone posting a YouTube video/playlist link produces an inline card; tapping it starts a shared session that every member can control.

Files:
- `src/lib/youtube.ts` — IFrame API loader, URL/playlist parsing (`parseYouTubeLink`, `findYouTubeLink`), Data API v3 `searchYouTube` + `fetchPlaylistItems`.
- `src/hooks/useYouTubePlayer.ts` — single official player lifecycle.
- `src/hooks/useSharedMusic.ts` — Realtime sync (private `music:<convId>` channel), one `sync` snapshot event, queue + history + next/prev, DB persistence.
- `src/components/MusicProvider.tsx` — owns the one player + session; exposes `useMusic()` (state/actions) and `useMusicPlayer()` (player). Wrap the chat pane with `<MusicProvider conversationId={activeId}>`.
- `src/components/SharedPlayerBar.tsx` — the docked player/controls (prev/next/seek/play), placed between the message list and composer.
- `src/components/MusicPanel.tsx` — search + link + queue overlay (header Music button).
- `src/components/MessageList.tsx` — `YouTubeCard` for links in text messages.

Rules:
- Official YouTube IFrame Player API only (`controls: 1`, branding preserved). No downloads, audio extraction, or proxying.
- Search/playlist loading use the official **YouTube Data API v3** and need `VITE_YOUTUBE_API_KEY` (browser key restricted by HTTP referrer). Without it, search/playlists show a hint; single-video links still play. Quota ~100 search calls/day.
- There is one player instance per conversation pane; never unmount the host div while audio should continue (it is always mounted, just visually collapsed when idle).
- Background audio is not supported by the IFrame API: playback pauses when the tab is backgrounded/hidden; keep the tap overlay and never promise background play.

### Manual test checklist

Search
- [ ] With `VITE_YOUTUBE_API_KEY` set, typing a song/artist and Enter/Search shows results with thumbnails.
- [ ] Play starts it for everyone; `+` adds it to the shared queue.
- [ ] Without the key, the search box shows the config hint and single-video links still play.
- [ ] Invalid key / disabled Data API / quota-exceeded shows a clear error, not a crash.

Links / playlists in chat
- [ ] Posting a `watch`, `shorts`, `live`, `youtu.be`, or `music.youtube.com` link shows an inline card in the bubble.
- [ ] Tapping the card starts shared playback for both direct and group chats.
- [ ] Posting a playlist (`list=`) link loads its items and next/prev move through them.
- [ ] An invalid/garbage link is rejected with a clear message; a non-embeddable video shows an error with a YouTube link.

Shared playback
- [ ] Starting a track in one client plays in sync on the others.
- [ ] Play/pause/seek/next/prev from any member propagate to everyone (no echo/duplicate toggles).
- [ ] A late joiner gets the current track, position, queue and history within a few seconds, even if the starter is offline (DB snapshot).
- [ ] Drift correction pulls a client back after it stalls (throttle the tab / pause locally).
- [ ] Ending the session clears playback and the row for everyone.

Authorization / resilience
- [ ] Non-members cannot read or join a conversation's `music:*` channel after public access is disabled.
- [ ] Reconnect (toggle offline/online, background/foreground) rejoins and re-syncs.
- [ ] Autoplay-blocked clients show the "tap to enable sound" overlay and recover on tap.

Mobile
- [ ] The player bar stays visible and usable; controls are reachable; chat scrolls behind it.
- [ ] Switching conversations stops the previous chat's audio.
