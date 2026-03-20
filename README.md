# Hearing Hope Staff (PWA)

Progressive Web App for iPhone and desktop: same staff login and appointments experience as **`hearing-hope-mobile`** (phone + password → Firebase custom token, Firestore appointments, offline cache + sync queue for complete/cancel).

## Features (parity with native app)

- Login via CRM **`/api/mobile-login`** (staff must have **mobile app** access enabled).
- List appointments (home + center assigned to you) with **Today / All / Upcoming / Completed / Cancelled** filters, daily progress, **tel:** and **Maps** shortcuts.
- Detail: **Call patient**, mark **completed** (optional feedback) or **cancelled**; offline actions queue and sync when back online.
- **Install to Home Screen** (Safari → Share → Add to Home Screen). Service worker caches the shell for faster reloads.

**Not included vs native:** Expo push notifications are not replicated on web (would need FCM Web + VAPID). Staff who need push alerts should use the Android app.

## Setup

```bash
cd hearing-hope-staff-pwa
cp .env.example .env
# Fill VITE_* values (mirror EXPO_PUBLIC_* from the mobile app / CRM).
npm install
npm run dev
```

Open the URL shown (e.g. `http://localhost:5173`). Use the same credentials as the mobile app.

## Deploy

**Vercel (recommended):** **[VERCEL.md](./VERCEL.md)** (import + env vars) and **[DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md)** (copy-paste checklist).

Any static host:

```bash
npm run build
# Upload `dist/`, or connect CI with build `npm run build` and output directory `dist`.
```

Set the same **`VITE_*`** environment variables in the host’s dashboard; **redeploy** after changing them (values are inlined at build time).

**CORS:** The CRM route **`/api/mobile-login`** allows cross-origin `POST` from any origin (`Access-Control-Allow-Origin: *`). Your Firestore security rules still enforce data access.

**Optional same-origin deploy:** You can also serve this app under a path on the CRM domain (e.g. reverse proxy `/staff` → `dist`) to avoid cross-origin for login only; Firebase client still talks to Google directly.

## “Failed to fetch” on login

The app posts to **same-origin** `/api/mobile-login`. That route is **proxied** to your CRM (no cross-origin login from the browser).

| Where | What to do |
|--------|------------|
| **Local `npm run dev`** | Set `VITE_CRM_URL` in `.env`, restart Vite. The dev server proxies `/api/mobile-login` → CRM. |
| **Vercel** | Set **`CRM_BACKEND_URL`** to your CRM origin (e.g. `https://hearing-hope-crm.vercel.app`) in the PWA project’s env vars, then **redeploy**. Optional fallback: `VITE_CRM_URL` (server reads it if `CRM_BACKEND_URL` is empty). |
| **`vite preview`** | There is no proxy or serverless — `/api/mobile-login` will not work. Use `npm run dev` locally or test on Vercel. |

If login returns HTML or 404, confirm **`vercel.json`** excludes `/api/` from the SPA rewrite and that **`api/mobile-login.ts`** is in the repo root.

---

## iPhone

1. Open the deployed HTTPS URL in **Safari**.
2. **Share** → **Add to Home Screen**.
3. Launch from the icon; it runs standalone like an app.

Use **iOS 16.4+** for the best PWA behavior.
