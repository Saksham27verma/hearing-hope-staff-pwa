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

**Vercel (recommended):** step-by-step in **[VERCEL.md](./VERCEL.md)** (new GitHub repo + import + env vars).

Any static host:

```bash
npm run build
# Upload `dist/`, or connect CI with build `npm run build` and output directory `dist`.
```

Set the same **`VITE_*`** environment variables in the host’s dashboard; **redeploy** after changing them (values are inlined at build time).

**CORS:** The CRM route **`/api/mobile-login`** allows cross-origin `POST` from any origin (`Access-Control-Allow-Origin: *`). Your Firestore security rules still enforce data access.

**Optional same-origin deploy:** You can also serve this app under a path on the CRM domain (e.g. reverse proxy `/staff` → `dist`) to avoid cross-origin for login only; Firebase client still talks to Google directly.

## “Failed to fetch” on login

Usually means the browser never got a normal HTTP response from `/api/mobile-login`.

| Situation | What to do |
|-----------|------------|
| **Local `npm run dev`** | The app calls **`/api/mobile-login`** on the Vite server, which **proxies** to `VITE_CRM_URL`. Set `VITE_CRM_URL` in `.env`, **restart** the dev server, and make sure the CRM is reachable (e.g. `npm run dev` for `hearing-hope-crm` on port 3000 if you use `http://localhost:3000`). |
| **Deployed PWA (HTTPS)** | `VITE_CRM_URL` must be **`https://...`**. If it is `http://`, the browser blocks the request (**mixed content**) → “Failed to fetch”. Set the variable on your host and **rebuild** the PWA. |
| **CRM not redeployed** | The login route must send CORS headers for cross-origin browser calls. Deploy the latest `hearing-hope-crm` (includes `/api/mobile-login` CORS). |

After changing `.env`, restart `npm run dev`. After changing host env vars, trigger a new deploy.

---

## iPhone

1. Open the deployed HTTPS URL in **Safari**.
2. **Share** → **Add to Home Screen**.
3. Launch from the icon; it runs standalone like an app.

Use **iOS 16.4+** for the best PWA behavior.
