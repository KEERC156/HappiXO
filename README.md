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
- Choose a theme and keep the event plan in browser `localStorage`.
- Print or save a professional event-plan PDF through the browser's print dialog.
- Scroll through seven distinct locally hosted cinematic video scenes with per-section playback and poster fallbacks.

Event budgets, vendor costs and simulator assumptions are planning estimates, not quotes or verified vendor information. HappiXO does not contact or book vendors.

## Technology

- React 19, TypeScript 6, Vite 8
- Framer Motion, Lucide, Recharts
- Express 5 and Zod for validated API requests
- Google GenAI SDK with structured JSON responses
- Browser `localStorage` for the demo event workspace

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

`npm start` serves the production build and the API from Express. Run `npm run build` first. Event information is saved in this browser; clearing site storage removes the local demo data.

## Gemini integration

Gemini requests are made only by the Express API, never directly from the browser.

1. Copy `.env.example` to `.env`.
2. Set `GEMINI_API_KEY` in `.env`.
3. Restart the dev server.

Keep the key server-side. Do not use a `VITE_` prefix, put the value in source control, or publish it in frontend configuration. `.gitignore` excludes environment files while explicitly allowing the blank `.env.example`.

The API exposes:

- `GET /api/ai/status` — reports configuration state without returning the key.
- `POST /api/ai/plan` — validates event details and validates/normalizes the structured plan.
- `POST /api/ai/chat` — provides relevant saved event, expense and vendor context to Gemini; suggested changes remain subject to user approval.

Without a key, AI generation is unavailable and the app labels its local planning/demo behavior as such. API errors are surfaced in the interface. A real Gemini request requires a valid key, network access and a model available to the configured Google AI account; this repository's local demo configuration does not include credentials.

## Event-plan export

Choose **Download Event Plan** in the dashboard. The browser print dialog opens with event details, current budget breakdown, saved theme recommendations, timeline, vendor checklist and planning notes. Select **Save as PDF** in the dialog to create a PDF. This works without Gemini and exports current saved data; it is a print-to-PDF workflow rather than a silent automatic file download.

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
3. Add `GEMINI_API_KEY` under Vercel **Project Settings → Environment Variables** for the environments you intend to use. Do not add a `VITE_` prefix.
4. Deploy and verify `/api/ai/status`, event-plan generation (with a valid key), and a client-side route/reload in the deployed preview. Without the key, check the clear demo/unavailable behavior.

The serverless API functions wrap the same validated Express routes. External Gemini connectivity and deployment behavior still need to be verified in the target Vercel project.

## Demo walkthrough

1. Start locally with `npm run dev` and open the Vite URL.
2. Scroll the landing page to view the distinct event scenes and try a category-specific planning button.
3. Complete the wizard or open the demo workspace; explore Overview, Budget, Timeline, Checklist, Vendors, HappiXO Copilot, What-if and Theme studio.
4. Edit a value, refresh, and confirm the event remains in this browser.
5. Use **Download Event Plan** and choose **Save as PDF** in the print dialog.

## Future scope

- Add authenticated multi-event workspaces and secure cloud persistence.
- Add genuine event-specific licensed footage (including Indian mandap and stationery preparation scenes).
- Add vendor discovery only with verified data and explicit user consent.
- Add automated API and browser regression coverage.
- Measure and improve production bundle loading and real-device video performance.

## Publish to GitHub

The local Git repository is initialized on the `main` branch; no remote is configured. To publish it without overwriting remote history:

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
