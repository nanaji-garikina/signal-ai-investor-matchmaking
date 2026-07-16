import { callGemini } from "../../../lib/gemini";
export const runtime = "nodejs";

/* ============================================================================
 * QUESTION CATEGORIES
 * ==========================================================================*/
// NOTE: category set and field mapping below are matched to the real data
// shapes in this project (lib/matching.js `emptyInvestor` / `emptyStartup`
// and `computeMatch`), not a generic guess. See answerFromInvestorData for
// the exact field names used.
const CATEGORY = {
  SECTOR: "SECTOR",
  STAGE: "STAGE",
  GEOGRAPHY: "GEOGRAPHY", // also covers location/country/city questions - this dataset only has one geography string
  WEBSITE: "WEBSITE",
  LINKEDIN: "LINKEDIN",
  EMAIL: "EMAIL",
  ORGANIZATION: "ORGANIZATION",
  TICKET_SIZE: "TICKET_SIZE",
  PORTFOLIO: "PORTFOLIO",
  THESIS: "THESIS", // also covers "investment philosophy" - same field in this dataset
  BUSINESS_MODEL: "BUSINESS_MODEL", // not a distinct investor field; routed to Gemini using thesis/sectors as context
  TECHNOLOGY: "TECHNOLOGY", // not a distinct investor field; routed to Gemini using thesis/sectors/portfolio as context
  STARTUP_FIT: "STARTUP_FIT",
  COMPARISON: "COMPARISON",
  GENERAL_KNOWLEDGE: "GENERAL_KNOWLEDGE",
  RECENT_NEWS: "RECENT_NEWS",
  HISTORY: "HISTORY", // not a distinct investor field; routed to Gemini using portfolio as context
  UNKNOWN: "UNKNOWN",
};

const SOURCE = {
  PROFILE: "Investor Profile",
  AI_ANALYSIS: "AI Analysis",
  GENERAL_KNOWLEDGE: "General Knowledge",
  PROFILE_PLUS_AI: "Investor Profile + AI Analysis",
};

/* ============================================================================
 * STEP 1 - QUESTION CLASSIFIER
 * Order matters: broader intents (comparison / news / general knowledge)
 * are checked before narrow field lookups so they aren't shadowed by a
 * stray keyword (e.g. "compare geography" should be a COMPARISON, not a
 * GEOGRAPHY lookup).
 * ==========================================================================*/
function classifyQuestion(question) {
  const q = (question || "").toLowerCase();

  const rules = [
    { category: CATEGORY.COMPARISON, pattern: /\b(compare|comparison|difference|differ|better than|versus|\bvs\.?\b)\b/ },
    { category: CATEGORY.RECENT_NEWS, pattern: /\b(recent|latest|current|up.to.date|these days|lately)\b[^.?!]{0,25}\b(invest\w*|portfolio|news|funding|deal|activity|doing)\b/ },
    { category: CATEGORY.GENERAL_KNOWLEDGE, pattern: /\b(what is|what's|define|explain|meaning of)\b.*\b(venture capital|\bvc\b|deep\s?tech|safe note|series [a-e]|seed round|cap table|term sheet|due diligence|valuation|convertible note|pre-?seed)\b/ },
    { category: CATEGORY.STAGE, pattern: /\bstage(s)?\b/ },
    { category: CATEGORY.SECTOR, pattern: /\bsector(s)?|industr(y|ies)|vertical(s)?\b/ },
    // This dataset has a single free-text `geography` field, no separate
    // country/city/location fields - route all of those here.
    { category: CATEGORY.GEOGRAPHY, pattern: /\bgeograph(y|ies)|region(s)?|location|countr(y|ies)|\bcit(y|ies)\b/ },
    { category: CATEGORY.WEBSITE, pattern: /\bwebsite|site url|homepage\b/ },
    { category: CATEGORY.LINKEDIN, pattern: /\blinkedin\b/ },
    { category: CATEGORY.EMAIL, pattern: /\bemail\b/ },
    { category: CATEGORY.ORGANIZATION, pattern: /\borgani[sz]ation|firm name|fund name|company name\b/ },
    { category: CATEGORY.TICKET_SIZE, pattern: /\bticket size|cheque size|check size|investment size|funding amount|how much (do|does|would).*(invest|write)\b/ },
    { category: CATEGORY.PORTFOLIO, pattern: /\bportfolio|invested in|portfolio compan(y|ies)\b/ },
    // `thesis` also serves "investment philosophy" questions - same field.
    { category: CATEGORY.THESIS, pattern: /\bthesis|investment philosophy|investing philosophy|approach to investing\b/ },
    { category: CATEGORY.BUSINESS_MODEL, pattern: /\bbusiness model\b/ },
    { category: CATEGORY.TECHNOLOGY, pattern: /\btechnology|tech stack|deep ?tech focus\b/ },
    { category: CATEGORY.HISTORY, pattern: /\bhistory|past investments|track record|previously invested|founder(s)?\b/ },
    { category: CATEGORY.STARTUP_FIT, pattern: /\bmatch score|good (match|fit)|why (is|does) this|startup fit|would you recommend|should (i|we) reach out|strength|weakness|risk|gap\b/ },
  ];

  const hit = rules.find((r) => r.pattern.test(q));
  return hit ? hit.category : CATEGORY.UNKNOWN;
}

/* ============================================================================
 * Small utilities for safely pulling data out of loosely-shaped objects
 * ==========================================================================*/
function firstNonEmpty(...values) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number") return v;
  }
  return null;
}

function localAnswer(text) {
  return { answered: true, answer: text, source: SOURCE.PROFILE };
}

const NOT_FOUND = { answered: false };

/* ============================================================================
 * STEP 2 - ANSWER DIRECTLY FROM LOCAL DATA WHEN POSSIBLE
 * ==========================================================================*/
// Human-readable labels for the match sub-score keys used throughout
// lib/matching.js (`computeMatch`'s `subs`/`matched`/`gaps`).
const SUB_SCORE_LABELS = {
  stage: "Stage fit",
  sector: "Sector fit",
  geo: "Geography fit",
  funding: "Funding size fit",
  bizModel: "Business model fit",
  tech: "Technology fit",
};

function formatSubScores(subs) {
  return Object.entries(subs || {})
    .map(([key, value]) => `${SUB_SCORE_LABELS[key] || key}: ${value}/100`)
    .join(", ");
}

function formatDimensionList(keys) {
  return (keys || []).map((k) => SUB_SCORE_LABELS[k] || k).join(", ");
}

function answerFromInvestorData(investor, startup, match, enrichment, question, category) {
  const inv = investor || {};
  const m = match || {};
  const enr = enrichment || {};

  switch (category) {
    case CATEGORY.STAGE: {
      // investor field is `stages` (plural) in this dataset.
      const stages = firstNonEmpty(inv.stages);
      return stages ? localAnswer(`${inv.name} invests at the following stage(s): ${stages}.`) : NOT_FOUND;
    }

    case CATEGORY.SECTOR: {
      const sectors = firstNonEmpty(inv.sectors);
      return sectors ? localAnswer(`${inv.name} focuses on: ${sectors}.`) : NOT_FOUND;
    }

    case CATEGORY.GEOGRAPHY: {
      // Single free-text geography field also answers location/country/city questions.
      const geo = firstNonEmpty(inv.geography);
      return geo ? localAnswer(`${inv.name}'s geographic focus is ${geo}.`) : NOT_FOUND;
    }

    case CATEGORY.WEBSITE: {
      const site = firstNonEmpty(inv.website);
      return site ? localAnswer(`Website: ${site}`) : NOT_FOUND;
    }

    case CATEGORY.LINKEDIN: {
      const li = firstNonEmpty(inv.linkedin);
      return li ? localAnswer(`LinkedIn: ${li}`) : NOT_FOUND;
    }

    case CATEGORY.EMAIL: {
      const email = firstNonEmpty(inv.email);
      return email ? localAnswer(`Email: ${email}`) : NOT_FOUND;
    }

    case CATEGORY.ORGANIZATION: {
      const org = firstNonEmpty(inv.organization);
      return org ? localAnswer(`Organization / fund: ${org}`) : NOT_FOUND;
    }

    case CATEGORY.TICKET_SIZE: {
      const ticket = firstNonEmpty(inv.ticket);
      return ticket ? localAnswer(`Typical ticket size: ${ticket}.`) : NOT_FOUND;
    }

    case CATEGORY.THESIS: {
      // Also answers "investment philosophy" questions - same field here.
      const thesis = firstNonEmpty(inv.thesis);
      return thesis ? localAnswer(`Investment thesis: ${thesis}`) : NOT_FOUND;
    }

    case CATEGORY.PORTFOLIO: {
      const portfolio = firstNonEmpty(inv.portfolio);
      return portfolio ? localAnswer(`Known portfolio: ${portfolio}`) : NOT_FOUND;
    }

    // BUSINESS_MODEL, TECHNOLOGY, and HISTORY have no dedicated investor
    // field in this dataset (only the startup profile has businessModel /
    // technology, and there's no track-record field at all). Returning
    // NOT_FOUND routes these to Gemini, which still gets the full investor
    // object (thesis, sectors, portfolio) as grounding context.
    case CATEGORY.BUSINESS_MODEL:
    case CATEGORY.TECHNOLOGY:
    case CATEGORY.HISTORY:
      return NOT_FOUND;

    case CATEGORY.STARTUP_FIT: {
      const overall = m.overall;
      if (overall === undefined || overall === null) return NOT_FOUND;

      let text = `Match score for ${startup?.name || "your startup"} with ${inv.name}: ${overall}/100.`;
      if (m.subs) text += ` Sub-scores — ${formatSubScores(m.subs)}.`;
      if (m.matched?.length) text += ` Strong dimensions: ${formatDimensionList(m.matched)}.`;
      if (m.gaps?.length) text += ` Weak dimensions: ${formatDimensionList(m.gaps)}.`;
      if (enr.rationale) text += ` AI rationale: ${enr.rationale}`;
      if (enr.concerns?.length) text += ` Concerns: ${enr.concerns.join("; ")}.`;
      return localAnswer(text);
    }

    default:
      return NOT_FOUND;
  }
}

/* ============================================================================
 * STEP 5 - CONVERSATION MEMORY
 * Keeps a longer, more useful window of context so follow-ups like
 * "what about geography?" or "explain more" still resolve correctly,
 * while avoiding unbounded prompt growth on very long threads.
 * ==========================================================================*/
function buildConversationContext(messages) {
  const clean = (messages || []).map(({ role, content }) => ({ role, content }));
  const MAX_TURNS = 20;

  if (clean.length <= MAX_TURNS) return clean;

  // Preserve the opening turns (they usually frame the conversation) plus
  // the most recent turns, and mark that older content was trimmed.
  const opening = clean.slice(0, 2);
  const recent = clean.slice(-(MAX_TURNS - 2));
  return [...opening, { role: "system", content: "[earlier conversation trimmed for length]" }, ...recent];
}

/* ============================================================================
 * STEP 4 / 6 / 7 / 8 - GEMINI PROMPT BUILDER
 * Builds one grounded prompt for every Gemini-routed case (supplemental
 * lookups, comparisons, general knowledge, recent-news requests).
 * ==========================================================================*/
function buildGeminiPrompt({ startup, investor, match, enrichment, conversation, question, category }) {
  const specialInstructions = {
    [CATEGORY.COMPARISON]: `This is a COMPARISON question. Compare ${investor?.name || "this investor"} against whatever else the user named, using the supplied investor/match/startup data for known facts and general knowledge for the other party. Clearly mark anything not backed by local data as general knowledge.`,
    [CATEGORY.GENERAL_KNOWLEDGE]: `This is a GENERAL KNOWLEDGE question unrelated to the specific investor record. Answer using general venture capital knowledge. Do not search the investor data for this.`,
    [CATEGORY.RECENT_NEWS]: `This asks about RECENT/LIVE information (news, latest investments, current portfolio). Begin the answer with: "This information is not available in the uploaded investor data." Then, clearly labeled as general knowledge, share relevant general context. Never claim to have performed live web research.`,
  };

  const extraInstruction = specialInstructions[category] || `Supplement the local investor profile with careful analysis. Do not contradict any local data field.`;

  return `
You are Signal's Investor Intelligence Agent. Help a startup founder understand ONE specific investor and make a better outreach decision.

GROUNDING RULES:
- Always prioritize the supplied startup profile, investor profile, match analysis, and AI enrichment as the source of truth.
- Never invent investments, portfolio companies, people, cheque sizes, fund size, thesis, news, or recent activity.
- If information is missing, say exactly: "That information is not available in the current investor data."
- Never contradict any local investor data field.
- Clearly distinguish three kinds of content in your answer when relevant: Investor Profile (verified local data), AI Analysis (your reasoning about the match), and General Knowledge (facts outside the local dataset).
- Match scores are indicators, not absolute truth.
- Be specific to this startup-investor pair; avoid generic fundraising advice.
- Do not claim web research was performed.

${extraInstruction}

STARTUP:
${JSON.stringify(startup, null, 2)}

INVESTOR:
${JSON.stringify(investor, null, 2)}

MATCH:
${JSON.stringify(match, null, 2)}

AI ENRICHMENT:
${JSON.stringify(enrichment || {}, null, 2)}

RECENT CONVERSATION:
${JSON.stringify(conversation, null, 2)}

USER QUESTION:
${question.trim()}

RESPONSE FORMAT:
- Respond as a professional conversational AI assistant.
- Use natural readable text, not JSON.
- Never output JSON objects, arrays, raw data structures, or code fences.
- Start by directly answering the user's question.
- Use short paragraphs and simple headings when useful.
- Use bullet points for strengths, risks, gaps, or recommendations.
- Highlight important scores naturally, for example: "Geography: 100/100".
- Do not repeat all available data unless it directly helps answer the question.
- Keep the response concise but useful.
- End with one practical recommendation when appropriate.

Answer directly, clearly, and practically.
`.trim();
}

/* ============================================================================
 * STEP 9 - SOURCE LABEL FOR GEMINI-ROUTED ANSWERS
 * ==========================================================================*/
function sourceForCategory(category) {
  if (category === CATEGORY.GENERAL_KNOWLEDGE) return SOURCE.GENERAL_KNOWLEDGE;
  if (category === CATEGORY.RECENT_NEWS) return SOURCE.GENERAL_KNOWLEDGE;
  if (category === CATEGORY.COMPARISON) return SOURCE.PROFILE_PLUS_AI;
  return SOURCE.PROFILE_PLUS_AI;
}

/* ============================================================================
 * STEP 10 - GRACEFUL GEMINI FALLBACK
 * Builds a useful answer purely from local data when Gemini is unavailable.
 * ==========================================================================*/
function buildFallbackAnswer(investor, startup, match) {
  const inv = investor || {};
  const m = match || {};
  const parts = ["I couldn't retrieve additional AI insights at the moment. Here is what is available from the investor profile:"];

  if (inv.sectors) parts.push(`- Sectors: ${inv.sectors}`);
  if (inv.stages) parts.push(`- Stage(s): ${inv.stages}`);
  if (inv.geography) parts.push(`- Geography: ${inv.geography}`);
  if (inv.ticket) parts.push(`- Ticket size: ${inv.ticket}`);
  if (inv.thesis) parts.push(`- Thesis: ${inv.thesis}`);
  if (m.overall !== undefined && m.overall !== null) {
    parts.push(`- Match score with ${startup?.name || "your startup"}: ${m.overall}/100`);
  }

  if (parts.length === 1) parts.push("- No additional profile details are available right now.");

  return parts.join("\n");
}

async function callGeminiSafely(prompt) {
  try {
    const result = await callGemini(prompt, null, 4, "text");
    if (!result?.trim()) {
      throw new Error("Gemini returned an empty response.");
    }
    return { ok: true, text: result.trim() };
  } catch (error) {
    // Covers timeouts, 429/503, invalid API responses, and empty content.
    console.error("Gemini call failed:", error?.message || error);
    return { ok: false, error };
  }
}

/* ============================================================================
 * ROUTE HANDLER
 * ==========================================================================*/
export async function POST(req) {
  try {
    const { startup, investor, match, enrichment, messages = [], question } = await req.json();

    if (!startup || !investor || !question?.trim()) {
      return Response.json({ error: "Startup, investor, and question are required." }, { status: 400 });
    }

    // STEP 1 - classify the question
    const category = classifyQuestion(question);

    // STEP 2 - try to answer from local data first
    const localResult = answerFromInvestorData(investor, startup, match, enrichment, question, category);

    // STEP 3 - short-circuit if local data was enough
    if (localResult.answered) {
      return Response.json({
        answer: localResult.answer,
        source: localResult.source,
        investorId: investor.id,
        investorName: investor.name,
      });
    }

    // STEP 5 - build conversation context for follow-up questions
    const conversation = buildConversationContext(messages);

    // STEP 4/6/7/8 - build the grounded Gemini prompt for this category
    const prompt = buildGeminiPrompt({ startup, investor, match, enrichment, conversation, question, category });

    // STEP 10 - call Gemini with graceful degradation
    const geminiResult = await callGeminiSafely(prompt);

    if (!geminiResult.ok) {
      return Response.json({
        answer: buildFallbackAnswer(investor, startup, match),
        source: SOURCE.PROFILE,
        investorId: investor.id,
        investorName: investor.name,
      });
    }

    return Response.json({
      answer: geminiResult.text,
      source: sourceForCategory(category),
      investorId: investor.id,
      investorName: investor.name,
    });
  } catch (error) {
    console.error("Investor Agent API error:", error);
    return Response.json({ error: error.message || "Investor Intelligence Agent failed." }, { status: 500 });
  }
}