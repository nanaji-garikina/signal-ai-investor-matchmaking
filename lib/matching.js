export const STAGE_ORDER = [
  "pre-seed", "angel", "seed",
  "series a", "series b", "series c", "series d", "series e",
  "series f", "series g", "series h",
  "bridge", "growth", "late stage", "pre-ipo",
];

export const emptyStartup = {
  name: "", founder: "", industry: "", businessModel: "", stage: "seed",
  funding: "", geography: "", targetMarket: "", technology: "", traction: "",
  website: "", notes: "",
};


export const emptyInvestor = {
  name: "", organization: "", email: "", stages: "", sectors: "", geography: "",
  ticket: "", thesis: "", portfolio: "", website: "", linkedin: "",
  investorType: "", businessModels: "", investmentScore: "", deadpooled: "", recentDeals: "",
};

export const LABELS = {
  stage: "Investment stage",
  sector: "Sector",
  geo: "Geography",
  funding: "Funding size",
  bizModel: "Business model",
  tech: "Technology",
};

export function genId() {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ============================================================
// Stage normalization
// ============================================================
function normStage(s) {
  if (!s) return "";
  // Strip trailing counts like "(278)" before matching, e.g.
  // Tracxn-style "Series D (9)" -> "Series D (9)" -> "series d"
  const t = s.toLowerCase().replace(/\([^)]*\)/g, "").trim();
  if (t.includes("pre-seed") || t.includes("preseed")) return "pre-seed";
  if (t.includes("angel")) return "angel";
  if (t.includes("seed")) return "seed";
  if (t.includes("pre-ipo") || t.includes("pre ipo")) return "pre-ipo";
  if (t.includes("series a") || t === "a") return "series a";
  if (t.includes("series b") || t === "b") return "series b";
  if (t.includes("series c") || t === "c") return "series c";
  if (t.includes("series d") || t === "d") return "series d";
  if (t.includes("series e") || t === "e") return "series e";
  if (t.includes("series f") || t === "f") return "series f";
  if (t.includes("series g") || t === "g") return "series g";
  if (t.includes("series h") || t === "h") return "series h";
  if (t.includes("bridge")) return "bridge";
  if (t.includes("growth")) return "growth";
  if (t.includes("late")) return "late stage";
 
  return "";
}



const STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "of", "in", "on", "at", "for",
  "to", "with", "by", "is", "are", "as", "its", "our", "we",
  "that", "this", "into", "from",
]);

function stripCounts(str) {
  // Removes Tracxn-style "(633)" annotations so they never
  // become part of a token or block a match.
  return str.replace(/\(\s*[\d,]+\s*\)/g, " ");
}

function tokenizePhrases(str) {
  if (!str) return [];
  return stripCounts(String(str))
    .toLowerCase()
    .split(/[,/&|;]| and | with /g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordsOf(phrase) {
  return phrase
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

// Kept for stage tokenizing (needs the same phrase splitting,
// but stage comparison works on whole normalized stage names).
function tokenize(str) {
  return tokenizePhrases(str);
}

function parseMoney(str) {
  if (!str) return null;
  const matches = [...String(str).matchAll(/\$?\s?([\d,.]+)\s?(k|m|b)?/gi)];
  const nums = matches
    .map((m) => {
      let n = parseFloat(m[1].replace(/,/g, ""));
      if (isNaN(n)) return null;
      const suf = (m[2] || "").toLowerCase();
      if (suf === "k") n *= 1_000;
      if (suf === "m") n *= 1_000_000;
      if (suf === "b") n *= 1_000_000_000;
      return n;
    })
    .filter((n) => n !== null && n > 0);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

// Every sub-scorer below returns { score, known }. `known` is false only
// when we genuinely have nothing to compare (one or both fields empty) -
// in that case `score` is a neutral placeholder (50) that is EXCLUDED from
// the weighted overall in computeMatch, instead of silently pulling the
// overall score toward the middle. When data IS present but there's no
// real overlap, the score is allowed to fall close to 0 rather than being
// floored at an artificially generous value.
function stageScore(startupStage, investorStages) {
  const s = normStage(startupStage);
  // Fix #3: drop anything we couldn't recognize instead of
  // letting it sit in the array as raw text.
  const invTokens = tokenize(investorStages).map(normStage).filter(Boolean);
  if (!s || !invTokens.length) return { score: 50, known: false };
  if (invTokens.includes(s)) return { score: 100, known: true };
  const si = STAGE_ORDER.indexOf(s);
  const close = invTokens.some((t) => {
    const ti = STAGE_ORDER.indexOf(t);
    return ti !== -1 && Math.abs(ti - si) === 1;
  });
  return { score: close ? 60 : 5, known: true };
}

// Fix #2 + #4: word-level, count-stripped overlap scoring.
// Tries a full-phrase match first (highest confidence), then
// falls back to individual-word overlap so short but meaningful
// terms like "AI" or "ML" are never silently excluded, and
// Tracxn-style "Category (count)" text no longer blocks every
// comparison just because the exact phrase never repeats.
function overlapScore(startupStr, investorStr) {
  const aPhrases = tokenizePhrases(startupStr);
  const bPhrases = tokenizePhrases(investorStr);
  if (!aPhrases.length || !bPhrases.length) return { score: 50, known: false };

  const bJoined = ` ${bPhrases.join(" | ")} `;
  const bWordSet = new Set(bPhrases.flatMap(wordsOf));

  let score = 0;
  aPhrases.forEach((aPhrase) => {
    if (aPhrase.length > 2 && bJoined.includes(aPhrase)) {
      score += 1; // full phrase hit
      return;
    }
    const aWords = wordsOf(aPhrase);
    if (!aWords.length) return;
    const hit = aWords.some((w) => bWordSet.has(w));
    if (hit) score += 0.6; // partial, word-level hit
  });

  if (score === 0) return { score: 5, known: true };
  return { score: Math.min(100, Math.round((score / aPhrases.length) * 100)), known: true };
}

function geoScore(startupGeo, investorGeo) {
  if (!startupGeo || !investorGeo) return { score: 50, known: false };
  const g = investorGeo.toLowerCase();
  if (g.includes("global") || g.includes("worldwide") || g.includes("anywhere")) return { score: 100, known: true };
  const s = tokenizePhrases(startupGeo).flatMap(wordsOf);
  const hit = s.some((tok) => tok.length > 2 && g.includes(tok));
  return { score: hit ? 100 : 5, known: true };
}

// Fix #5: real investor exports very rarely include a ticket-size
// column at all. Instead of silently defaulting to a neutral 50
// for every investor, fall back to a typical range inferred from
// the investor's own recognized stage(s), so funding fit still
// carries real signal instead of going dark for an entire file.
const DEFAULT_TICKET_BY_STAGE = {
  "pre-seed": [10_000, 250_000],
  angel: [10_000, 300_000],
  seed: [100_000, 1_500_000],
  "series a": [1_000_000, 8_000_000],
  "series b": [5_000_000, 20_000_000],
  "series c": [15_000_000, 50_000_000],
  "series d": [30_000_000, 100_000_000],
  "series e": [50_000_000, 150_000_000],
  "series f": [75_000_000, 200_000_000],
  "series g": [100_000_000, 250_000_000],
  "series h": [100_000_000, 300_000_000],
  bridge: [500_000, 5_000_000],
  growth: [20_000_000, 100_000_000],
  "late stage": [50_000_000, 300_000_000],
  "pre-ipo": [50_000_000, 300_000_000],
};

function inferTicketRangeFromStages(investorStages) {
  const tokens = tokenize(investorStages).map(normStage).filter(Boolean);
  if (!tokens.length) return null;
  // Use the widest span across every recognized stage the
  // investor is tagged with, so a multi-stage fund gets a
  // reasonably wide inferred range rather than just its first tag.
  let min = Infinity;
  let max = -Infinity;
  tokens.forEach((t) => {
    const range = DEFAULT_TICKET_BY_STAGE[t];
    if (!range) return;
    min = Math.min(min, range[0]);
    max = Math.max(max, range[1]);
  });
  if (min === Infinity) return null;
  return { min, max };
}

function fundingScore(startupAsk, investorTicket, investorStages) {
  const ask = parseMoney(startupAsk);
  let range = parseMoney(investorTicket);
  if (!range) {
    range = inferTicketRangeFromStages(investorStages);
  }
  if (!ask || !range) return { score: 50, known: false };
  const askMid = (ask.min + ask.max) / 2;
  if (askMid >= range.min * 0.7 && askMid <= range.max * 1.3) return { score: 100, known: true };
  const distance = Math.min(Math.abs(askMid - range.min), Math.abs(askMid - range.max));
  const scale = Math.max(range.max, askMid, 1);
  const ratio = distance / scale;
  if (ratio < 0.6) return { score: 55, known: true };
  return { score: 5, known: true };
}

// Fix #7: surface deadpooled (shut-down) funds so the app can
// warn about them or filter them out before outreach, instead of
// silently ranking them like any other active investor.
export function isDeadpooled(inv) {
  const v = (inv?.deadpooled || "").toString().trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "y";
}

const MATCH_WEIGHTS = { stage: 0.2, sector: 0.25, geo: 0.15, funding: 0.2, bizModel: 0.1, tech: 0.1 };

export function computeMatch(startup, inv) {
  const results = {
    stage: stageScore(startup.stage, inv.stages),
    sector: overlapScore(startup.industry, inv.sectors),
    geo: geoScore(startup.geography, inv.geography),
    funding: fundingScore(startup.funding, inv.ticket, inv.stages),
    bizModel: overlapScore(
      startup.businessModel,
      `${inv.thesis} ${inv.sectors} ${inv.businessModels || ""}`
    ),
    tech: overlapScore(
      startup.technology,
      `${inv.thesis} ${inv.sectors} ${inv.portfolio || ""} ${inv.businessModels || ""}`
    ),
  };

  // Only known dimensions (where we actually had data to compare) count
  // toward the overall score, and their weights are renormalized to sum
  // to 1 across just those dimensions. This avoids two failure modes of
  // the old flat weighting: missing data no longer drags the overall
  // score toward a fake neutral 50, and it never gets diluted just
  // because some fields were blank in the source CSV.
  let weightedSum = 0;
  let knownWeight = 0;
  Object.entries(results).forEach(([key, r]) => {
    if (r.known) {
      weightedSum += r.score * MATCH_WEIGHTS[key];
      knownWeight += MATCH_WEIGHTS[key];
    }
  });
  // If literally nothing was known (e.g. an almost-empty investor row),
  // there's no honest score to compute - fall back to a flat 50 rather
  // than dividing by zero.
  const overall = knownWeight > 0 ? Math.round(weightedSum / knownWeight) : 50;

  const subs = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.score]));
  const known = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.known]));
  // % of the total weight that was backed by real data, for surfacing a
  // "how confident is this score" signal in the UI.
  const dataCompleteness = Math.round(knownWeight * 100);

  const matched = Object.entries(subs).filter(([k, v]) => known[k] && v >= 70).map(([k]) => k);
  const gaps = Object.entries(subs).filter(([k, v]) => known[k] && v < 40).map(([k]) => k);

  return {
    overall,
    subs,
    known,
    dataCompleteness,
    matched,
    gaps,
    flags: { deadpooled: isDeadpooled(inv) },
  };
}

// ============================================================
// CSV parsing (unchanged)
// ============================================================
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || row.length) { row.push(field); rows.push(row); }
        row = []; field = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}


export function mapHeaders(headers) {
  const norm = headers.map((h) => (h || "").toLowerCase().trim());

  const rules = [
    ["email", (h) => h.includes("email")],
    ["linkedin", (h) => h.includes("linkedin")],
    ["website", (h) => h.includes("website") || h.includes("domain") || h.includes("url")],
    ["deadpooled", (h) => h.includes("deadpool")],
    ["investmentScore", (h) => h.includes("investment score") || h.includes("relevance score")],
    ["investorType", (h) => h.includes("investor type") || h.includes("entity type")],
    ["businessModels", (h) => h.includes("business model")],
    ["recentDeals", (h) => h.includes("recent deal") || h.includes("deals in last") || h.includes("rounds of investment")],
    ["organization", (h) => h.includes("firm") || h.includes("fund") || h.includes("organization") || h.includes("company name")],
    ["stages", (h) => h.includes("stage")],
    ["sectors", (h) =>
      h.includes("sector") ||
      h.includes("industry") ||
      h.includes("vertical") ||
      h.includes("practice area") ||
      h.includes("category") ||
      h.includes("focus area")
    ],
    ["geography", (h) => h.includes("geo") || h.includes("location") || h.includes("country") || h.includes("region")],
    ["ticket", (h) =>
      h.includes("ticket") ||
      h.includes("check size") ||
      h.includes("cheque size") ||
      h.includes("investment size") ||
      h.includes("avg") ||
      h.includes("amount")
    ],
    ["thesis", (h) => h.includes("thesis") || h.includes("focus") || h.includes("description") || h.includes("note") || h.includes("overview")],
    ["portfolio", (h) => h.includes("portfolio")],
    // Fix (regression guard): a bare ".includes('name')" catch-all
    // also grabs unrelated columns like Tracxn's "Feed Name",
    // corrupting the investor's actual name. Require a clearer
    // signal instead.
    ["name", (h) => h.includes("investor") || h.includes("contact") || h === "name" || h.includes("full name")],
  ];

  // Fields that should only ever hold ONE value (identity/contact
  // fields) — if multiple columns match, keep the first non-empty
  // one rather than concatenating them together.
  const SINGLE_VALUE_FIELDS = new Set([
    "name", "organization", "email", "website", "linkedin",
    "investorType", "investmentScore", "deadpooled",
  ]);

  // Returns an ARRAY of {idx, key} — a header maps to the first
  // rule it satisfies, but multiple different headers are now
  // allowed to map to the same key.
  const mapping = [];
  norm.forEach((h, idx) => {
    for (const [key, test] of rules) {
      if (test(h)) {
        mapping.push({ idx, key });
        break;
      }
    }
  });
  mapping.singleValueFields = SINGLE_VALUE_FIELDS;
  return mapping;
}

export function rowsToInvestors(rowsText) {
  const rows = parseCSV(rowsText);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const mapping = mapHeaders(headers);
  const singleValueFields = mapping.singleValueFields || new Set();

  return rows
    .slice(1)
    .map((r) => {
      const obj = { ...emptyInvestor, id: genId() };
      const collected = {};

      mapping.forEach(({ idx, key }) => {
        const val = (r[idx] || "").trim();
        if (!val) return;
        if (!collected[key]) collected[key] = [];
        collected[key].push(val);
      });

      Object.entries(collected).forEach(([key, vals]) => {
        if (singleValueFields.has(key)) {
          // Identity/contact fields: keep the first non-empty
          // value only. Concatenating these would corrupt them
          // (e.g. joining an internal "Feed Name" tag onto the
          // investor's actual name).
          obj[key] = vals[0];
          return;
        }
        // List-style fields (sectors, stages, geography, thesis,
        // portfolio, etc.): de-duplicate identical values and
        // join distinct ones together so no useful text from a
        // second matching column is thrown away.
        const unique = [...new Set(vals)];
        obj[key] = unique.join("; ");
      });

      return obj;
    })
    .filter((o) => o.name || o.organization);
}