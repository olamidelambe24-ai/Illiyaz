# Illy Tracker — Personal Finance Tracker

A daily expense, budget, and investment tracker with private accounts — built with React + Vite + Supabase.

Each person who signs up gets their own private ledger. Nobody can see anyone else's data (enforced at the database level, not just in the app).

## 1. Create your free Supabase project

1. Go to https://supabase.com and sign up (no credit card needed for the free tier).
2. Click **New project**. Pick a name, a database password (save it somewhere), and a region close to your users.
3. Wait ~2 minutes for it to finish provisioning.

## 2. Set up the database

1. In your Supabase project, open **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-schema.sql` (included in this folder) and click **Run**.
   This creates the `expenses`, `investments`, and `user_settings` tables, and locks each one down with Row Level Security so a user can only ever read or write their own rows.

## 3. Get your API keys

1. In your Supabase project, go to **Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. In this project folder, copy `.env.example` to a new file named `.env`, and paste in your values:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

## 4. Email confirmation (optional, for easier testing)

By default, Supabase requires users to click a confirmation link in their email before they can sign in. For quick testing:
- Go to **Authentication → Providers → Email** and turn **Confirm email** off.
- Turn it back on before sharing the app publicly, so people can't sign up with someone else's email address.

## 5. Run it locally

```bash
npm install
npm run dev
```

Open the printed URL, click "New here? Create an account", and sign up. Each person who does this gets their own private data.

## 6. Deploy it as a real website

### Option A — Vercel (recommended — supports environment variables easily)
1. Push this folder to a GitHub repository.
2. Go to https://vercel.com/new and import the repository.
3. Vercel auto-detects Vite. Before deploying, add your two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the project settings.
4. Click Deploy. Every future push redeploys automatically.

### Option B — Netlify
1. Push this folder to a GitHub repository (or run `npm run build` and drag the `dist/` folder to https://app.netlify.com/drop for a quick one-off deploy — but note that drag-and-drop deploys can't use environment variables, so you'd need to hardcode your Supabase URL/key in `src/lib/supabaseClient.js` for that method only).
2. For the full setup with environment variables: connect your GitHub repo in Netlify, and add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` under Site settings → Environment variables.

## How the private accounts work

- Sign-up and login use Supabase Auth (email + password).
- Every expense, investment, and budget row is tagged with the signed-in user's ID.
- Postgres **Row Level Security** policies (set up by `supabase-schema.sql`) enforce that a user can only select, insert, update, or delete their own rows — this is enforced by the database itself, not just hidden in the app, so it holds even if someone inspects network requests.
- The Profile tab shows account info, usage stats, a sign-out button, and a "Clear all my data" option (only affects that user's own data).

## Installing it as an app on your phone

This project is set up as a **Progressive Web App (PWA)** — once deployed, anyone can install it to their phone's home screen like a real app, with its own icon and no browser address bar. No app store needed.

**On Android (Chrome):**
1. Open your deployed site (e.g. `https://illiyaz.vercel.app`)
2. Tap the **⋮** menu → **Install app** (or you may see an automatic "Install" banner)
3. It'll appear on the home screen and open full-screen like a native app

**On iPhone (Safari):**
1. Open your deployed site in **Safari** (must be Safari, not Chrome — iOS only supports this from Safari)
2. Tap the **Share** icon (square with an arrow) → **Add to Home Screen**
3. Tap **Add** — it now behaves like an installed app

Nothing extra needs deploying for this to work — it's already built into the project (see `vite.config.js`, the `public/icons/` folder, and the meta tags in `index.html`). Just push this code and redeploy on Vercel as usual.

## Tech stack
- React 18 + Vite
- Supabase (Postgres + Auth) for accounts and data
- vite-plugin-pwa (installable app support)
- Recharts (charts)
- lucide-react (icons)
