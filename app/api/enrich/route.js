import { callGemini, runThrottled } from "../../../lib/gemini";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const { startup, matches } = await req.json(); // matches: [{ inv, subs }]
    const top = matches.slice(0, 10);

    const results = await runThrottled(top, async ({ inv, subs }) => {
      const prompt = `You are helping a startup founder evaluate a potential investor match. Respond with ONLY minified JSON, no preamble, no markdown, in this exact shape: {"rationale":"2-3 sentence explanation of why this could be a good match","concerns":["short concern 1","short concern 2"]}.

Startup: ${JSON.stringify(startup)}
Investor: ${JSON.stringify(inv)}
Computed sub-scores (0-100): ${JSON.stringify(subs)}`;
      try {
        const raw = await callGemini(prompt);
        return [inv.id, JSON.parse(raw)];
      } catch {
        return [inv.id, { rationale: null, concerns: [] }];
      }
    });

    return Response.json({ enrichment: Object.fromEntries(results) });
  } catch (err) {
    return Response.json({ error: err.message || "Enrichment failed." }, { status: 500 });
  }
}
