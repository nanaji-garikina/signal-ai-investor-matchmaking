export const STAGE_ORDER = ["pre-seed", "seed", "series a", "series b", "series c", "growth", "late stage"];

export const emptyStartup = {
  name: "", founder: "", industry: "", businessModel: "", stage: "seed",
  funding: "", geography: "", targetMarket: "", technology: "", traction: "",
  website: "", notes: "",
};

export const emptyInvestor = {
  name: "", organization: "", email: "", stages: "", sectors: "", geography: "",
  ticket: "", thesis: "", portfolio: "", website: "", linkedin: "",
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

function normStage(s) {
  if (!s) return "";
  const t = s.toLowerCase().trim();
  if (t.includes("pre-seed") || t.includes("preseed")) return "pre-seed";
  if (t.includes("seed")) return "seed";
  if (t.includes("series a") || t === "a") return "series a";
  if (t.includes("series b") || t === "b") return "series b";
  if (t.includes("series c") || t === "c") return "series c";
  if (t.includes("growth")) return "growth";
  if (t.includes("late")) return "late stage";
  return t;
}

function tokenize(str) {
  if (!str) return [];
  return str.toLowerCase().split(/[,\/&|]| and | with /g).map((s) => s.trim()).filter(Boolean);
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

function stageScore(startupStage, investorStages) {
  const s = normStage(startupStage);
  const invTokens = tokenize(investorStages).map(normStage);
  if (!s || !invTokens.length) return 50;
  if (invTokens.includes(s)) return 100;
  const si = STAGE_ORDER.indexOf(s);
  const close = invTokens.some((t) => Math.abs(STAGE_ORDER.indexOf(t) - si) === 1);
  return close ? 60 : 20;
}

function overlapScore(startupStr, investorStr) {
  const a = tokenize(startupStr);
  const b = tokenize(investorStr).join(" ");
  if (!a.length || !b) return 50;
  const matched = a.filter((tok) => tok.length > 2 && b.includes(tok));
  if (!matched.length) return 20;
  return Math.min(100, Math.round((matched.length / a.length) * 100));
}

function geoScore(startupGeo, investorGeo) {
  if (!startupGeo || !investorGeo) return 50;
  const g = investorGeo.toLowerCase();
  if (g.includes("global") || g.includes("worldwide") || g.includes("anywhere")) return 100;
  const s = tokenize(startupGeo);
  const hit = s.some((tok) => tok.length > 2 && g.includes(tok));
  return hit ? 100 : 30;
}

function fundingScore(startupAsk, investorTicket) {
  const ask = parseMoney(startupAsk);
  const range = parseMoney(investorTicket);
  if (!ask || !range) return 50;
  const askMid = (ask.min + ask.max) / 2;
  if (askMid >= range.min * 0.7 && askMid <= range.max * 1.3) return 100;
  const distance = Math.min(Math.abs(askMid - range.min), Math.abs(askMid - range.max));
  const scale = Math.max(range.max, askMid, 1);
  const ratio = distance / scale;
  if (ratio < 0.6) return 55;
  return 20;
}

export function computeMatch(startup, inv) {
  const stage = stageScore(startup.stage, inv.stages);
  const sector = overlapScore(startup.industry, inv.sectors);
  const geo = geoScore(startup.geography, inv.geography);
  const funding = fundingScore(startup.funding, inv.ticket);
  const bizModel = overlapScore(startup.businessModel, `${inv.thesis} ${inv.sectors}`);
  const tech = overlapScore(startup.technology, `${inv.thesis} ${inv.sectors} ${inv.portfolio || ""}`);
  const overall = Math.round(stage * 0.2 + sector * 0.25 + geo * 0.15 + funding * 0.2 + bizModel * 0.1 + tech * 0.1);
  const subs = { stage, sector, geo, funding, bizModel, tech };
  const matched = Object.entries(subs).filter(([, v]) => v >= 70).map(([k]) => k);
  const gaps = Object.entries(subs).filter(([, v]) => v < 40).map(([k]) => k);
  return { overall, subs, matched, gaps };
}

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
  const norm = headers.map((h) => h.toLowerCase().trim());
  const map = {};
  const used = new Set();
  const rules = [
    ["email", (h) => h.includes("email")],
    ["website", (h) => h.includes("website") || h.includes("url") || h.includes("domain")],
    ["linkedin", (h) => h.includes("linkedin")],
    ["organization", (h) => h.includes("firm") || h.includes("fund") || h.includes("organization") || h.includes("company")],
    ["stages", (h) => h.includes("stage")],
    ["sectors", (h) => h.includes("sector") || h.includes("industry") || h.includes("vertical")],
    ["geography", (h) => h.includes("geo") || h.includes("location") || h.includes("country") || h.includes("region")],
    ["ticket", (h) => h.includes("ticket") || h.includes("check size") || h.includes("investment size") || h.includes("avg") || h.includes("amount")],
    ["thesis", (h) => h.includes("thesis") || h.includes("focus") || h.includes("description") || h.includes("note")],
    ["portfolio", (h) => h.includes("portfolio")],
    ["name", (h) => h.includes("investor") || h.includes("name") || h.includes("contact")],
  ];
  norm.forEach((h, idx) => {
    for (const [key, test] of rules) {
      if (used.has(key)) continue;
      if (test(h)) { map[idx] = key; used.add(key); return; }
    }
  });
  return map;
}

export function rowsToInvestors(rowsText) {
  const rows = parseCSV(rowsText);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const map = mapHeaders(headers);
  return rows
    .slice(1)
    .map((r) => {
      const obj = { ...emptyInvestor, id: genId() };
      Object.entries(map).forEach(([idx, key]) => { obj[key] = r[idx] || ""; });
      return obj;
    })
    .filter((o) => o.name || o.organization);
}
