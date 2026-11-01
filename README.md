# HappiXO — AI-Powered Event Planning Companion

HappiXO helps people turn an event idea into a practical plan. It combines an optional Gemini planning assistant with editable event details, budget tracking, preparation tasks, vendor notes, a theme studio and a scenario simulator. The cinematic landing page introduces weddings, birthdays, community gatherings and college events; the planner itself uses a calm warm-neutral palette.

## The problem

Planning a celebration means coordinating dates, guest counts, budgets, themes, vendors and many small tasks across different places. HappiXO brings those pieces into one editable workspace and makes suggested AI output reviewable before applying it.

## Features

- Create event plans for weddings, birthdays, college events, community gatherings and custom events.
- Generate a structured plan with Gemini when a server-side API key is configured; clearly labeled local demo mode is available without one.
- Track planned and actual spending by category, with budget totals and visual summaries.
- Edit timeline tasks and mark preparation work complete.
- Keep a vendor shortlist with estimate, contact, notes and booking status.
- Ask the HappiXO Copilot questions and review suggested changes before applying them.
- Explore budget, guest-count, venue and theme scenarios.
- Save clearly labeled browser demo plans in `localStorage`, or save guest plans and customer contact details in Supabase.
- Plan without passwords, sign-in, email verification or OTP; **My Events** is scoped to a secure HttpOnly guest-session cookie in that browser.
- Import an existing browser plan into a guest session without deleting the local copy.
- Download a professional, branded event-plan PDF with budgets, expenses, timeline, vendors and saved AI recommendations.
- Scroll through seven distinct locally hosted cinematic video scenes with per-section playback and poster fallbacks.

Event budgets, vendor costs and simulator assumptions are planning estimates, not quotes or verified vendor information. HappiXO does not contact or book vendors.

## Technology

- React 19, TypeScript 6, Vite 8
- Framer Motion, Lucide, Recharts
- Express 5 and Zod for validated API requests
- Google GenAI SDK with structured JSON responses
- Supabase PostgreSQL accessed by same-origin server endpoints for private guest details and saved plans; browser `localStorage` for the no-credentials demo

## Requirements and local setup

Use a Node.js release supported by the installed Vite version (Node.js 20.19+ or 22.12+).

```sh
npm install
npm run dev
```

The development command starts Vite and the Express API. Open the Vite URL printed in the terminal. Vite proxies `/api` to the local Express server at `http://127.0.0.1:8787`.

Useful commands:

```sh
npm run lint
npm run build
npm start
```

`npm start` serves the production build and the API from Express. Run `npm run build` first.

## Passwordless guest sessions and Supabase

The customer planning journey collects full name, email and mobile number, then saves them in the private `customer_leads` table through the server API. Supabase service-role access stays server-side; the browser receives only an unguessable, HttpOnly, SameSite cookie. The database stores a SHA-256 hash of that guest token. Each event, expense, task, vendor checklist and AI plan is linked to that lead and is read or changed only by the API after it validates the cookie. `profiles` remains linked to Supabase Auth users and is not used for passwordless guests. No passwords, anonymous fake Auth IDs, or public customer-data policies are used.

This is not an account or identity verification: a guest can access their saved plans only from the browser holding the session cookie. Clearing cookies, losing the browser, or ending the session means those records cannot be recovered through this interface. Email and mobile number are contact details only, not proof of identity. Existing Auth-owned records from the earlier app are left in the database; the passwordless UI does not sign in to or migrate those Auth accounts.

Without server Supabase credentials, requests fail with a visible service error; they do not report database success or silently substitute local storage. The separate demo workspace remains available and is labeled as browser-only.

1. Apply [`supabase/migrations/20261031000000_happixo_customer_data.sql`](./supabase/migrations/20261031000000_happixo_customer_data.sql) if the original schema/policies are not already present, then apply [`supabase/migrations/20261031200000_passwordless_guest_planning.sql`](./supabase/migrations/20261031200000_passwordless_guest_planning.sql) in the Supabase SQL Editor or through the Supabase CLI (`supabase db push`). The second migration adds private guest leads, guest ownership fields and constraints, and the service-role-only atomic plan-save function. It does not disable RLS.
2. Create `.env.local` from the example only if one does not already exist:

   ```powershell
   if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
   ```

   The server loads `.env.local` before `.env`; existing process/Vercel environment variables take precedence. Preserve any existing local environment file and add the required server-side values there.
3. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the local server. Add `GEMINI_API_KEY` only when real Gemini generation is desired. None of these variables have a `VITE_` prefix, and only the server reads them. Never put a service-role key or database password in frontend code or a Vite variable. `.env` is git-ignored.
4. Configure the same variables in Vercel under **Project Settings → Environment Variables** for the relevant deployment environments, then redeploy. Do not invent a production domain: use the actual deployed origin when testing. Supabase Auth redirect URLs are not used in the passwordless guest flow.
5. Run `npm run dev`, enter customer details, create an event and check the Supabase tables. To test isolation, create a second browser session (for example a private window) and verify it cannot retrieve the first session's records.

The migration assumes the original six-table schema and column names from the first migration. If those tables were created manually, compare their columns, constraints and RLS settings before applying; do not blindly rerun the original `CREATE TABLE` statements over manually created tables. The server endpoints use service-role credentials only after validating the browser's opaque session cookie; `customer_leads` has no `anon`/`authenticated` table access. In-memory request throttling is best-effort on Vercel serverless instances and is not a substitute for shared rate limiting at higher traffic.

Build success alone does not verify database connectivity. Verify customer inserts and guest-session isolation against the configured project before launch.

## Gemini integration

Gemini requests are made only by the Express API, never directly from the browser.

1. Copy `.env.example` to `.env.local` if it does not already exist.
2. Set `GEMINI_API_KEY` in `.env.local`.
3. Restart the dev server.

Keep the key server-side. Do not use a `VITE_` prefix, put the value in source control, or publish it in frontend configuration. `.gitignore` excludes environment files while explicitly allowing `.env.example`.

The API exposes:

- `GET /api/ai/status` — reports configuration state without returning the key.
- `POST /api/ai/plan` — validates event details and validates/normalizes the structured plan.
- `POST /api/ai/chat` — provides relevant saved event, expense and vendor context to Gemini; suggested changes remain subject to user approval.

Without a key, generation uses a clearly labeled local demo planner; those demo plans are not presented as Gemini-generated recommendations. API errors are surfaced in the interface. A real Gemini request requires a valid key, network access and a model available to the configured Google AI account; this repository's local demo configuration does not include credentials.

## Event-plan export

Choose **Download Event Plan** in the dashboard. A branded PDF downloads using the currently saved event's title and includes event details, budget allocations and expenses, remaining budget, timeline and task statuses, vendor checklist, and saved AI recommendations where available. Guest plans use the latest server-confirmed saved snapshot; browser demo plans must be saved locally. The illustrative sample cannot be exported as a real event. Empty sections are clearly labeled.

## Cinematic video assets

The landing page uses seven distinct local 360p MP4 clips and poster images. Only visible sections load/play their video; off-screen videos pause. Posters remain as visual fallbacks, and reduced-motion or mobile visitors get static imagery. The local MP4s total about 7.7 MB, with roughly 0.4 MB of posters.

The footage is representative stock imagery, not footage of specific HappiXO events. In particular, the wedding clip shows newlyweds rather than an Indian mandap, the community clip features lanterns in a garden, and the preparation clip shows a decorated table rather than invitation stationery. The available clips load locally; no broken or invented video URLs are used.

The clips and preview images were downloaded from Mixkit's free-stock-video pages. The asset pages identify each clip as downloadable for commercial or personal use under Mixkit's Stock Video Free License. Confirm current terms for your intended use and redistribution.

| Scene | Clip | Source |
|---|---|---|
| Celebration hero | Friends lighting celebratory sparklers | [Mixkit 51541](https://mixkit.co/free-stock-video/a-group-of-friends-donned-with-elegant-dresses-and-suits-51541/) |
| Wedding | Happy newlyweds posing | [Mixkit 40601](https://mixkit.co/free-stock-video/happy-newlyweds-posing-40601/) |
| Birthday | Birthday cake with candies and balloons | [Mixkit 5111](https://mixkit.co/free-stock-video/birthday-cake-on-a-table-with-candies-and-balloons-5111/) |
| Community | Red lanterns in a garden at night | [Mixkit 100516](https://mixkit.co/free-stock-video/red-lanterns-hanging-in-a-lush-garden-at-night-100516/) |
| College | Audience at a music festival | [Mixkit 4185](https://mixkit.co/free-stock-video/audience-of-a-music-festival-4185/) |
| Event preparation | Decorated wedding table | [Mixkit 5224](https://mixkit.co/free-stock-video/sequence-of-a-decorated-wedding-table-5224/) |
| Closing celebration | Friends sharing a New Year's Eve toast | [Mixkit 51530](https://mixkit.co/free-stock-video/a-young-cheerful-woman-with-a-radiant-smile-is-surrounded-51530/) |
| License | Mixkit Stock Video license | [Mixkit license](https://mixkit.co/license/#videoFree) |

## Vercel deployment

The repository includes Vite build/output settings, SPA fallback routing and separate Vercel Node function entry points for the existing Express API routes. The local `npm start` process is not used as a Vercel server. Vercel deployment has not been performed or verified from this repository.

1. Import the project into Vercel or deploy it with the Vercel CLI.
2. Keep the framework preset as **Vite**; the checked-in `vercel.json` sets `npm run build` and `dist`.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under Vercel **Project Settings → Environment Variables**. These are server-only. Add `GEMINI_API_KEY` if Gemini generation is desired. Do not add a `VITE_` prefix to any of them.
4. Deploy and verify `/api/ai/status`, guest customer submission, event-plan persistence and deletion, and a client-side route/reload in the deployed preview. Use the actual deployment origin; no production URL is assumed.

The serverless API functions wrap the same validated Express routes. External Gemini connectivity and deployment behavior still need to be verified in the target Vercel project. Supabase Auth redirect URLs are not used in the passwordless guest flow.

## Demo walkthrough

1. Start locally with `npm run dev` and open the Vite URL.
2. Scroll the landing page to view the distinct event scenes and try a category-specific planning button.
3. Complete the wizard or open the demo workspace; explore Overview, Budget, Timeline, Checklist, Vendors, HappiXO Copilot, What-if and Theme studio.
4. With server-side Supabase credentials and migrations configured, submit guest details, create an event, edit a value, refresh in the same browser and verify the saved event. Open a separate browser session to confirm it cannot access the first session's records. Without server credentials, use only the clearly labeled local demo.
5. Use **Download Event Plan** and confirm that the branded PDF downloads with the event's saved data.

## Future scope

- Add automated guest-session, database and cross-session isolation regression coverage.
- Add genuine event-specific licensed footage (including Indian mandap and stationery preparation scenes).
- Add vendor discovery only with verified data and explicit user consent.
- Add automated API and browser regression coverage.
- Measure and improve production bundle loading and real-device video performance.

## Publish to GitHub

To publish without overwriting remote history:

1. Create a new **private** GitHub repository named `HappiXO` under `KEERC156`. Do not initialize it with a README, license or `.gitignore`.
2. From the project folder in PowerShell, review the staged files:

   ```powershell
   git status --short
   git diff --cached --stat
   ```

3. Confirm no `.env`, credentials, or other private files appear in `git status`. Then commit and push:

   ```powershell
   git remote add origin https://github.com/KEERC156/HappiXO.git
   git commit -m "Prepare HappiXO for submission"
   git push -u origin main
   ```

If GitHub suggests a different default branch, use the same branch name consistently for the push. These commands do not force-push. Keep the GitHub repository private unless you explicitly choose to make it public later.
