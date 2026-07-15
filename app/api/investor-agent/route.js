import { callGemini } from "../../../lib/gemini";
export const runtime = "nodejs";

export async function POST(req) {
  try {
    const { startup, investor, match, enrichment, messages = [], question } = await req.json();
    if (!startup || !investor || !question?.trim()) {
      return Response.json({ error: "Startup, investor, and question are required." }, { status: 400 });
    }
    const recentMessages = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    const prompt = `
You are Signal's Investor Intelligence Agent. Help a startup founder understand ONE specific investor and make a better outreach decision.

GROUNDING RULES:
- Use only the supplied startup profile, investor profile, match analysis, AI enrichment, and conversation history as factual evidence.
- Never invent investments, portfolio companies, people, cheque sizes, fund size, thesis, news, or recent activity.
- If information is missing, say exactly: "That information is not available in the current investor data."
- Clearly separate known facts from analysis.
- Match scores are indicators, not absolute truth.
- Be specific to this startup-investor pair; avoid generic fundraising advice.
- For "why match" questions, cite concrete dimensions and scores.
- For risks, identify missing data and weak dimensions.
- For outreach advice, recommend 2-4 specific angles grounded in actual alignment.
- Use concise headings and bullets where useful.
- Do not claim web research was performed.

STARTUP:
${JSON.stringify(startup, null, 2)}

INVESTOR:
${JSON.stringify(investor, null, 2)}

MATCH:
${JSON.stringify(match, null, 2)}

AI ENRICHMENT:
${JSON.stringify(enrichment || {}, null, 2)}

RECENT CONVERSATION:
${JSON.stringify(recentMessages, null, 2)}

USER QUESTION:
${question.trim()}

RESPONSE FORMAT:
- Respond as a professional conversational AI assistant.
- Use natural readable text, not JSON.
- Never output JSON objects, arrays, raw data structures, or code fences.
- Start by directly answering the user's question.
- Use short paragraphs.
- Use simple headings when useful.
- Use bullet points for strengths, risks, gaps, or recommendations.
- Highlight important scores naturally, for example: "Geography: 100/100".
- Do not repeat all available data unless it directly helps answer the question.
- Keep the response concise but useful.
- End with one practical recommendation when appropriate.

Answer directly, clearly, and practically.
`.trim();
    const answer = await callGemini(prompt, null, 4, "text");
    if (!answer?.trim()) throw new Error("Gemini returned an empty response.");
    return Response.json({ answer: answer.trim(), investorId: investor.id, investorName: investor.name });
  } catch (error) {
    console.error("Investor Agent API error:", error);
    return Response.json({ error: error.message || "Investor Intelligence Agent failed." }, { status: 500 });
  }
}
