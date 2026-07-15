import { callGemini, runThrottled } from "../../../lib/gemini";

export const runtime = "nodejs";

function parseGeminiJSON(raw) {
  if (!raw) {
    throw new Error("Gemini returned an empty response.");
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
      "[Email Generation] Direct JSON.parse failed. Trying JSON extraction."
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
    `Could not find valid JSON in Gemini response: ${cleaned.slice(0, 500)}`
  );
}

function createFallbackDraft(startup, investor, rationale) {
  const startupName = startup?.name || "our startup";

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

  const subject = `Introduction: ${startupName}`;

  const body = `Hi ${recipientName},

I hope you're doing well.

I'm reaching out to introduce ${startupName}${
    sector ? `, a startup working in ${sector}` : ""
  }.

Based on your investment focus and interests, I believe there could be a strong alignment between what we're building and your investment thesis.

${
  rationale
    ? `In particular, ${rationale}`
    : "We believe our sector and growth stage may be relevant to your investment focus."
}

I'd be happy to share more about our progress, vision, and fundraising plans. I've included our pitch deck for your review.

If this aligns with your interests, I would appreciate the opportunity to schedule a brief conversation.

Best regards`;

  return {
    subject,
    body,
    status: "fallback",
  };
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

      const prompt = `
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

6. Explain WHY this startup could be relevant to this particular investor.

7. Do not use the same generic structure for every investor.

8. Vary the opening sentence, subject line, and value proposition depending on the investor.

9. Never invent facts that are not present in the supplied data.

10. If limited investor information is available, use only the genuine information available and avoid fake personalization.

EMAIL STYLE:

- Professional but human.
- Warm and confident.
- Maximum 180 words.
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

Before writing, internally identify the top 2 strongest genuine reasons this investor and startup may be a fit. Then write the email based specifically on those reasons.

Return JSON only.
`.trim();

        try {
          const raw = await callGemini(prompt);

          console.log(
            "Raw Gemini response:",
            raw?.slice(0, 1000)
          );

          const parsed = parseGeminiJSON(raw);

          if (!parsed.subject) {
            throw new Error(
              "Gemini response does not contain a subject."
            );
          }

          if (!parsed.body) {
            throw new Error(
              "Gemini response does not contain an email body."
            );
          }

          console.log(
            "SUCCESS: Email generated for",
            inv.name || inv.id
          );

          return [
            inv.id,
            {
              subject: String(parsed.subject).trim(),
              body: String(parsed.body).trim(),
              status: "draft",
            },
          ];
        } catch (error) {
          console.error(
            "\nEMAIL GENERATION FAILED FOR:",
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