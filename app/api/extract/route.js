import { callGemini } from "../../../lib/gemini";
import { emptyInvestor, genId, rowsToInvestors } from "../../../lib/matching";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export const runtime = "nodejs";

const STARTUP_KEYS = [
  "name", "founder", "industry", "businessModel", "stage", "funding",
  "geography", "targetMarket", "technology", "traction", "website", "notes",
];

function ext(name) {
  const p = name.toLowerCase().split(".");
  return p[p.length - 1];
}

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const type = form.get("type"); // "startup" | "investor"
    if (!file) return Response.json({ error: "No file provided." }, { status: 400 });

    const e = ext(file.name);
    const buf = Buffer.from(await file.arrayBuffer());

    // Tabular files: parse locally, no AI needed — handles very large investor lists.
    if (type === "investor" && (e === "csv" || e === "txt")) {
      const text = buf.toString("utf-8");
      const rows = rowsToInvestors(text);
      return Response.json({ mode: "rows", rows });
    }
   
    if (type === "investor" && (e === "xlsx" || e === "xls")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      // Each sheet may have its own header row (e.g. "India", "US", "Climate" tabs) — parse every sheet, not just the first.
      const rows = wb.SheetNames.flatMap((sheetName) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        return rowsToInvestors(csv);
      });
      // De-dupe in case the same investor appears in more than one tab (match on name+organization+email).
      const seen = new Set();
      const deduped = rows.filter((r) => {
        const key = `${r.name}|${r.organization}|${r.email}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return Response.json({ mode: "rows", rows: deduped, sheets: wb.SheetNames.length });
    }
    // Everything else goes through Claude for structured extraction.
    let prompt, attachment, textContent;

    if (e === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      textContent = value;
    } else if (e === "csv" || e === "txt") {
      textContent = buf.toString("utf-8");
    } else if (e === "xlsx" || e === "xls") {
      const wb = XLSX.read(buf, { type: "buffer" });
      textContent = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    } else if (e === "pdf") {
      attachment = { kind: "document", mediaType: "application/pdf", data: buf.toString("base64") };
    } else if (["jpg", "jpeg", "png"].includes(e)) {
      attachment = { kind: "image", mediaType: e === "png" ? "image/png" : "image/jpeg", data: buf.toString("base64") };
    } else {
      return Response.json(
        { error: `.${e} isn't supported. Use CSV, XLSX, TXT, DOCX, PDF, JPG, or PNG (export PPT/PPTX/DOC to PDF first).` },
        { status: 400 }
      );
    }

    if (type === "startup") {
      prompt = `Extract structured startup information from the attached content and respond with ONLY minified JSON, no markdown, with exactly these keys: ${STARTUP_KEYS.join(
        ", "
      )}. Use an empty string for anything not found — never invent data.${
        textContent ? `\n\nContent:\n${textContent.slice(0, 12000)}` : ""
      }`;
      const raw = await callGemini(prompt, attachment);
      const parsed = JSON.parse(raw);
      return Response.json({ mode: "startup", data: parsed });
    } else {
      prompt = `Extract every investor or mentor mentioned in the attached content. Respond with ONLY minified JSON: an array of objects, each with exactly these keys: name, organization, email, stages, sectors, geography, ticket, thesis, portfolio, website, linkedin. Use an empty string for missing fields. If nothing is found, return [].${
        textContent ? `\n\nContent:\n${textContent.slice(0, 12000)}` : ""
      }`;
      const raw = await callGemini(prompt, attachment);
      const parsed = JSON.parse(raw);
      const rows = (Array.isArray(parsed) ? parsed : []).map((o) => ({ ...emptyInvestor, ...o, id: genId() }));
      return Response.json({ mode: "rows", rows });
    }
  } catch (err) {
    return Response.json({ error: err.message || "Extraction failed." }, { status: 500 });
  }
}
