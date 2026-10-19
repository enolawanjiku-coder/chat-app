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

1. Apply `supabase/migrations/0014_music.sql` (after `0001`–`0013`).
2. To enforce Realtime authorization: Dashboard → Project Settings → Realtime → disable **Allow public access**. Do **not** run `alter table realtime.messages enable row level security`.
3. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL` (unchanged), plus `VITE_YOUTUBE_API_KEY` to enable music search (see below). Deploy on Vercel as usual.

## Media: YouTube music feature

Files: `src/lib/youtube.ts` (IFrame API loader + URL/ID parsing + Data API search), `src/hooks/useYouTubePlayer.ts` (player lifecycle), `src/hooks/useGroupMusic.ts` (Realtime sync), `src/components/MusicPanel.tsx` (UI), wired into `src/pages/ChatPage.tsx`.

- Official YouTube IFrame Player API only (`controls: 1`, branding preserved). No downloads, audio extraction, or proxying.
- Search uses the official **YouTube Data API v3** (`search.list`, `videoEmbeddable=true`) and needs `VITE_YOUTUBE_API_KEY` (a browser key restricted by HTTP referrer). Without it, the search box shows a hint and users can still paste a link/ID. Quota is ~100 searches/day on the free tier.
- Background audio is not supported by the IFrame API: playback pauses when the tab is backgrounded/hidden; show the poster/tap overlay and never promise background play.

### Manual test checklist

Search
- [ ] With `VITE_YOUTUBE_API_KEY` set, typing a song/artist and pressing Enter (or Search) shows results with thumbnails.
- [ ] Clicking a result plays it (solo) / starts it for the group; the `+` adds it to the shared queue.
- [ ] Without the key, the search box shows the config hint and link/ID paste still works.
- [ ] An invalid key / disabled Data API / quota-exceeded shows a clear error, not a crash.

Solo
- [ ] Paste a `watch`, `shorts`, `live`, `youtu.be`, and `music.youtube.com` link; each loads correctly.
- [ ] Invalid/garbage link and a non-11-char ID are rejected with a clear message.
- [ ] Play/pause, ±10s seek, and scrub bar all work and stay in sync with the video.
- [ ] A video that disallows embedding shows an error state with a link to watch on YouTube.
- [ ] Closing the panel while playing shows the mini bar; mini bar play/pause/stop works.

Group
- [ ] Only group conversations expose the Group tab / start session.
- [ ] Start a track in one client; other members receive it and play in sync.
- [ ] Play/pause/seek from any member propagate to everyone (no echo/duplicate toggles).
- [ ] A late joiner receives the current track, position, and queue within a few seconds, even if the starter is offline (DB snapshot).
- [ ] Queue add/remove syncs; a track ending advances to the next queued item once.
- [ ] Drift correction pulls a client back after it stalls (throttle the tab / pause locally).
- [ ] End session clears playback and the row for everyone.

Authorization / resilience
- [ ] Non-members cannot read or join a conversation's `music:*` channel after public access is disabled.
- [ ] Reconnect (toggle offline/online, background/foreground) rejoins and re-syncs.
- [ ] Autoplay-blocked clients show the "tap to enable sound" overlay and recover on tap.

Mobile
- [ ] Panel opens as a bottom sheet; controls are reachable and the video stays visible.
- [ ] Mini bar does not cover the composer or header controls; chat remains usable while music plays.
