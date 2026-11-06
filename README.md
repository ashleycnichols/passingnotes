# Passing Notes

Written role play for LARPers. Start a scene, send the link, write together. No logins.

Live at **https://ashleycnichols.github.io/passingnotes/** once GitHub Pages is on.

## One-time setup

1. **Database.** In Supabase, open SQL Editor → New query. Paste all of `supabase/migrations/20261106110000_init.sql` and press Run. You should see "Success. No rows returned". Running it again is safe.
2. **Keys.** `config.js` holds the Supabase project URL and the publishable (anon) key. That key is meant to be public. Never put the secret / service_role key in this repo.
3. **Hosting.** On GitHub: Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`. Save. The site appears at the address above within a minute or two.

## How it is built

- Plain static site: `index.html`, `styles.css`, `config.js`, and `app.js` (built from `src/`).
- React, bundled with esbuild into `app.js`. Supabase's client loads from jsDelivr at runtime.
- Data lives in Supabase (Postgres, Realtime, Storage). Each browser keeps its own identity in localStorage: a device ID, the characters it owns (with their secret keys), and the scenes it has joined.

## Changing things

- Copy, colours, spacing: `styles.css` (no build needed).
- App name or keys: `config.js` (no build needed).
- Anything in `src/`: run `npm install` once, then `npm run build`, and commit the new `app.js`.
- Bump the `?v=` numbers in `index.html` when you change `app.js`, `styles.css` or `config.js`, so phones don't keep an old copy.

## Testing locally without Supabase

`npm run mock` starts a fake backend and serves the app at http://localhost:5174. Open it in two browser windows (one private) to play as two devices. `python3 test/e2e.py shots` runs the full two-device browser test (needs Playwright for Python).

## Keep-alive

Free Supabase projects pause after 7 days with no activity. `.github/workflows/keep-alive.yml` pings the database every 3 days so the group never finds it asleep.
