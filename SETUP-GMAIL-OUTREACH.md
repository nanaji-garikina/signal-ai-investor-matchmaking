# MatchEngine – Gmail Review-First Outreach

## Environment
Create `.env.local` in the project root:

```env
GEMINI_API_KEY=your_actual_gemini_api_key
```

## Run
```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Outreach flow
1. Upload startup/pitch material.
2. Upload or load investors.
3. Use Gemini-powered analysis/matching/draft generation.
4. Review the personalized email.
5. Open it in Gmail with recipient, subject, and body pre-filled.
6. Attach the pitch deck manually and click Send.

Resend, Cloudflare DNS verification, and a sending domain are not required for this workflow.
