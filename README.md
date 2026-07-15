# Signal — Founder × Investor Matchmaking

AI-matched investor introductions for founders. Upload or manually enter a startup profile, upload or manually
enter an investor list (Tracxn/Crunchbase-style CSV or files), get instantly scored matches with AI rationale,
draft personalized outreach emails, and send them for real.

## Stack (all free tier)

- **Next.js 14** (App Router) — deploy free on Vercel
- **Google Gemini API** (free tier) — extraction, matching rationale, email drafts (server-side only, key never exposed to the browser)
- **Resend** — actual email sending, free tier: 100 emails/day, no credit card
- No database required for the MVP — all data lives in browser state for the session. Add Supabase later if you want persistence across visits.

## 1. Local setup

```bash
npm install
cp .env.example .env.local
# fill in GEMINI_API_KEY, RESEND_API_KEY, RESEND_FROM in .env.local
npm run dev
```

Open http://localhost:3000

### Getting free API keys

- **Google Gemini**: sign up at aistudio.google.com/apikey — free tier, no credit card, generous daily request limit for a project like this.
- **Resend**: sign up at resend.com (free, no card). Verify a sending domain or use their test sender for development, then add your API key and the "from" address to `.env.local`.

## 2. Deploy for free (Vercel)

```bash
npm install -g vercel
vercel
```

Or connect the GitHub repo at vercel.com — either way:

1. Import the project.
2. In **Project Settings → Environment Variables**, add `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`.
3. Deploy. You'll get a public `*.vercel.app` URL immediately (custom domains are also free to attach on Vercel's free plan).

## Project structure

```
app/
  page.js              — main UI, step orchestration
  layout.js / globals.css — design system
  api/extract/route.js — file upload → structured startup/investor JSON (server-side)
  api/enrich/route.js  — AI rationale for top matches
  api/emails/route.js  — AI-drafted outreach emails
  api/send/route.js    — real send via Resend
components/            — StartupForm, InvestorImport, MatchDashboard, Outreach, UI atoms
lib/matching.js        — local scoring engine, CSV parsing, header auto-mapping
```

## Notes & honest limitations

- **PPT/PPTX and legacy .DOC** aren't parsed directly — export to PDF first, then upload.
- **No database yet** — refreshing the page clears startup/investor/email data. If you want persistence
  (saved profiles, recurring use, multi-user), add Supabase (also free tier) and swap the `useState` calls
  in `app/page.js` for reads/writes against it — the data shapes in `lib/matching.js` are ready for that.
- CSV/XLSX investor files are parsed **locally on the server with plain code, no AI** — so there's no practical
  size limit and no per-row API cost, even for large Tracxn exports.
- PDFs, DOCX, and screenshots go through Gemini for extraction — fine for pitch decks and shorter lists, not
  meant for thousand-row databases (use CSV/XLSX for those).
