# Passing Notes: conventions

Collaborative written role play. Mobile-first, no logins, trust-based, link-only scenes, max 10 players.

## Stack
- Static site on GitHub Pages. `index.html` + `styles.css` + `config.js` + built `app.js`.
- React 19 + JSX in `src/`, bundled by esbuild (`npm run build`). Commit `app.js` after every src change and bump `?v=` in index.html.
- Supabase: Postgres + Realtime + Storage (bucket `character-photos`). Schema in `supabase/migrations/`. Keep migrations idempotent.
- Supabase JS loads from jsDelivr at runtime (`@supabase/supabase-js@2`).

## Rules
- All data access goes through `src/api.js`. Keep the mock in `test/mock-server.mjs` in step with any new api function.
- Device identity and owned characters live only in localStorage (`src/store.js`). Character `owner_key` is never readable from the API; edits go through the `update_character` RPC.
- Edit permission: author device, or the post tags a character this device owns. UI-enforced (trust-based).
- Tags are stored as `@[Name](uuid)` and typed as `@Name`.
- Character colours as text always go through `readableColor()` for the current theme background.
- Copy: short, plain sentences. No em dashes.

## Test
`npm run mock` then `python3 test/e2e.py <dir>` (two simulated phones, screenshots in `<dir>`).
