# Host Hearing Hope Staff PWA on Vercel

## 1. Create a new GitHub repository

On [github.com/new](https://github.com/new):

- **Repository name:** e.g. `hearing-hope-staff-pwa`
- **Private** or **Public** — your choice
- Do **not** add README / .gitignore / license (this folder already has them)

Then link and push from this directory:

```bash
cd hearing-hope-staff-pwa
git remote add origin https://github.com/YOUR_USER/hearing-hope-staff-pwa.git
git branch -M main
git push -u origin main
```

(Use SSH if you prefer: `git@github.com:YOUR_USER/hearing-hope-staff-pwa.git`.)

## 2. Import the project in Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. **Import** the `hearing-hope-staff-pwa` repository.
3. Vercel usually auto-detects **Vite**. Confirm:

   | Setting | Value |
   |---------|--------|
   | **Framework Preset** | Vite |
   | **Root Directory** | `./` (repo root) |
   | **Build Command** | `npm run build` |
   | **Output Directory** | `dist` |
   | **Install Command** | `npm install` |

4. Expand **Environment Variables** and add **every** variable from `.env.example` (same names, production values):

   | Name | Example |
   |------|---------|
   | `VITE_CRM_URL` | `https://your-crm.vercel.app` (must be **https** if the PWA is on https) |
   | `VITE_FIREBASE_API_KEY` | from Firebase console |
   | `VITE_FIREBASE_AUTH_DOMAIN` | e.g. `project.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | |
   | `VITE_FIREBASE_STORAGE_BUCKET` | |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | |
   | `VITE_FIREBASE_APP_ID` | |

   Apply them to **Production** (and **Preview** if you want preview deployments to work too).

5. Click **Deploy**.

## 3. After the first deploy

1. **Firebase Console** → Authentication → **Authorized domains** → add your Vercel domain, e.g. `hearing-hope-staff-pwa.vercel.app` (and your custom domain if you add one).
2. Open the live URL, log in, and confirm appointments load.
3. On **iPhone**: Safari → your URL → **Share** → **Add to Home Screen**.

## 4. Redeploy when env or CRM changes

Changing variables in Vercel requires a **redeploy** (Redeploy from the Vercel dashboard or push a new commit) so `vite build` bakes in the new `VITE_*` values.

---

`vercel.json` in this repo sends unknown paths to `index.html` so React Router routes like `/login` and `/app` work on refresh and deep links.
