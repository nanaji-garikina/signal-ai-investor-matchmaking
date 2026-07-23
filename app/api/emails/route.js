import { callGemini, runThrottled } from "../../../lib/gemini";
import { callGroq } from "../../../lib/groq";

export const runtime = "nodejs";

function parseEmailJSON(raw, providerLabel) {
  if (!raw) {
    throw new Error(`${providerLabel} returned an empty response.`);
  }

  let cleaned = String(raw)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // First attempt: normal JSON
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    console.warn(
      `[Email Generation] ${providerLabel}: direct JSON.parse failed. Trying JSON extraction.`
    );
  }

  // Second attempt: find JSON object inside extra text
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end > start) {
    const jsonText = cleaned.slice(start, end + 1);
    return JSON.parse(jsonText);
  }

  throw new Error(
    `Could not find valid JSON in ${providerLabel} response: ${cleaned.slice(0, 500)}`
  );
}

// Builds a properly spaced, sign-off-complete fallback email so that if
// BOTH AI providers are unavailable, the founder still gets something
// well-formatted and ready to send rather than a broken draft.
function createFallbackDraft(startup, investor, rationale) {
  const startupName = startup?.name || "our startup";

  const founderName = startup?.founder || "";

  const recipientName =
    investor?.contactName ||
    investor?.name ||
    investor?.organization ||
    "there";

  const sector =
    startup?.sector ||
    startup?.industry ||
    startup?.category ||
    "";

  const subject = `Introduction: ${startupName}${sector ? ` (${sector})` : ""}`;

  const body = [
    `Hi ${recipientName},`,
    `I'm ${founderName ? `${founderName}, founder of ${startupName}` : `reaching out on behalf of ${startupName}`}${
      sector ? `, a startup building in ${sector}` : ""
    }.`,
    rationale
      ? `In particular, ${rationale}`
      : "Based on your public investment focus, I believe there could be a strong alignment between what we're building and your thesis.",
    "I've attached our pitch deck for a fuller picture of our progress and vision. I'd welcome the chance to share more in a brief call, at your convenience.",
    `Best regards,\n${founderName || startupName}`,
  ].join("\n\n");

  return {
    subject,
    body,
    status: "fallback",
  };
}

function buildEmailPrompt({ startup, inv, enr }) {
  return `
You are an expert startup fundraising communications assistant.

Your task is to write a genuinely personalized cold-introduction email from this specific startup founder to this specific investor.

Return ONLY one valid JSON object:

{
  "subject": "Personalized email subject",
  "body": "Complete personalized email body"
}

CRITICAL PERSONALIZATION RULES:

1. Carefully analyze ALL available startup data.
2. Carefully analyze ALL available investor data.
3. Identify the strongest genuine connection between this startup and this specific investor.
4. Personalize based on available evidence such as:
   - Investment sectors
   - Investment stage
   - Geography
   - Ticket size
   - Investment thesis
   - Portfolio companies
   - Climate focus
   - Technology focus
   - Business model
   - Market opportunity
   - Match rationale

5. The first paragraph must feel specifically written for this investor.
6. Explain WHY this startup could be relevant to this particular investor, grounded in at least one concrete detail from the investor data (e.g. a sector, stage, thesis phrase, or portfolio company) so the explanation reads as evidence-based, not generic flattery.
7. Do not use the same generic structure for every investor.
8. Vary the opening sentence, subject line, and value proposition depending on the investor.
9. Never invent facts that are not present in the supplied data.
10. If limited investor information is available, use only the genuine information available and avoid fake personalization.

REQUIRED EMAIL FORMAT (this is a hard formatting requirement, not a suggestion):

- Line 1: a short greeting on its own line, e.g. "Hi {recipient's first name},".
- Then 2-3 short paragraphs, each separated by a full blank line (use "\\n\\n" between paragraphs, never a single "\\n"):
  1. A one-to-two sentence introduction of the founder/startup, naturally tied to something specific about this investor.
  2. A short "why you" paragraph that explicitly states the strongest genuine reason(s) this investor and startup could be a fit, referencing the concrete evidence from rule 6.
  3. (Optional) A brief note on traction, market, or momentum if the startup data supports it.
- A short closing paragraph that naturally mentions the attached pitch deck and proposes a brief call as the call to action.
- A final sign-off on its own line, formatted as "Best regards,\\n{founder name}" (use the founder's name from the startup data if available; otherwise sign with the startup name). Never leave the sign-off without a name.
- No headers, no bullet points, no markdown formatting, no placeholders like "[Your Name]".

EMAIL STYLE:

- Professional but human.
- Warm and confident.
- Maximum 180 words (not counting the greeting and sign-off lines).
- No exaggerated claims.
- No generic phrases like "I hope this email finds you well."
- No placeholders.
- No Markdown.
- Mention the pitch deck naturally.
- End with a simple call to action for a brief conversation.

STARTUP DATA:
${JSON.stringify(startup, null, 2)}

SPECIFIC INVESTOR DATA:
${JSON.stringify(inv, null, 2)}

AI MATCH ANALYSIS:
${JSON.stringify(enr || {}, null, 2)}

Before writing, internally identify the top 2 strongest genuine reasons this investor and startup may be a fit. Then write the email based specifically on those reasons, following the REQUIRED EMAIL FORMAT exactly (real paragraph breaks, no run-on text).

Return JSON only.
`.trim();
}

/**
 * Calls Gemini first. If Gemini is unavailable for any reason (daily quota
 * exhausted, timeout, 5xx, invalid/empty response, unparsable JSON), this
 * automatically retries the exact same prompt against Groq - a different
 * vendor with a separate free-tier quota - before giving up. This is what
 * lets email generation keep working once the Gemini free-tier limit for
 * the day has been reached, instead of every investor silently falling
 * back to the generic template.
 */
async function generateEmailWithFallback({ startup, inv, enr }) {
  const prompt = buildEmailPrompt({ startup, inv, enr });

  try {
    const raw = await callGemini(prompt);
    const parsed = parseEmailJSON(raw, "Gemini");

    if (!parsed.subject || !parsed.body) {
      throw new Error("Gemini response is missing a subject or body.");
    }

    return {
      subject: String(parsed.subject).trim(),
      body: String(parsed.body).trim(),
      status: "draft",
      provider: "gemini",
    };
  } catch (geminiError) {
    console.error(
      "Gemini email generation failed for",
      inv.name || inv.organization || inv.id,
      "-",
      geminiError?.message || geminiError
    );
    console.warn("Falling back to Groq for this email...");

    try {
      const raw = await callGroq(prompt, { jsonMode: true });
      const parsed = parseEmailJSON(raw, "Groq");

      if (!parsed.subject || !parsed.body) {
        throw new Error("Groq response is missing a subject or body.");
      }

      console.log(
        "SUCCESS (via Groq fallback): email generated for",
        inv.name || inv.id
      );

      return {
        subject: String(parsed.subject).trim(),
        body: String(parsed.body).trim(),
        status: "draft",
        provider: "groq-fallback",
      };
    } catch (groqError) {
      console.error(
        "Groq fallback also failed for",
        inv.name || inv.organization || inv.id,
        "-",
        groqError?.message || groqError
      );
      throw groqError;
    }
  }
}

export async function POST(req) {
  try {
    const { startup, investors, enrichment } = await req.json();

    console.log("\n========== EMAIL GENERATION START ==========");
    console.log("Startup:", startup?.name);
    console.log("Number of investors:", investors?.length);

    if (!startup) {
      return Response.json(
        { error: "Startup data is required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(investors) || investors.length === 0) {
      return Response.json(
        { error: "No investors were provided." },
        { status: 400 }
      );
    }

    const results = await runThrottled(
      investors,
      async (inv) => {
        const enr = enrichment?.[inv.id];

        console.log("\n--------------------------------");
        console.log(
          "Generating email for:",
          inv.name || inv.organization || inv.id
        );

        try {
          const draft = await generateEmailWithFallback({ startup, inv, enr });

          console.log(
            `SUCCESS (via ${draft.provider}): email generated for`,
            inv.name || inv.id
          );

          return [inv.id, draft];
        } catch (error) {
          console.error(
            "\nEMAIL GENERATION FAILED FOR (both providers):",
            inv.name || inv.organization || inv.id
          );

          console.error("Error message:", error?.message);
          console.error("Full error:", error);

          const fallback = createFallbackDraft(
            startup,
            inv,
            enr?.rationale
          );

          return [inv.id, fallback];
        }
      },
      {
        // Safer for Gemini free-tier limits.
        concurrency: 1,
        spacingMs: 2500,
      }
    );

    console.log("\n========== EMAIL GENERATION COMPLETE ==========");

    return Response.json({
      emails: Object.fromEntries(results),
    });
  } catch (err) {
    console.error("\nEMAIL ROUTE FAILED:");
    console.error(err);

    return Response.json(
      {
        error: err?.message || "Email generation failed.",
      },
      {
        status: 500,
      }
    );
  }
}
