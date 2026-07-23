import { callGemini } from "../../../lib/gemini";
import { callGroq } from "../../../lib/groq";
import {
  emptyInvestor,
  genId,
  rowsToInvestors,
} from "../../../lib/matching";

import { get } from "@vercel/blob";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
// IMPORTANT: this import must come before `import { PDFParse } from "pdf-parse"`.
// pdf-parse wraps pdfjs-dist, which tries to access DOMMatrix/ImageData/Path2D
// (browser globals) the moment its module evaluates - not when a function is
// called. pdf-parse/worker sets up @napi-rs/canvas's polyfills for those
// globals first. Skipping this (or importing it after pdf-parse) is what
// causes "DOMMatrix is not defined" crashes at module-load time - this can
// pass in local dev depending on Node version/module cache order, then still
// fail once deployed to Vercel's serverless runtime.
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

// Inline binary attachments (PDF/image sent to Gemini for native vision
// reading) are base64-encoded, which inflates size by ~33%. Gemini's
// inline-data request limit is ~20MB, so we cap the raw file size well
// under that to fail fast with a clear message instead of a slow timeout.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB

// If local PDF text extraction pulls out fewer characters than this, the
// PDF is probably scanned/image-based (no real text layer) rather than
// something extraction just failed on - falls back to sending it to
// Gemini as a binary attachment for vision-based reading instead.
const MIN_EXTRACTED_PDF_CHARS = 150;

/*
 * Try to pull text out of a PDF locally (fast, reliable, works
 * regardless of file size) before ever involving an AI call. This is
 * what actually fixes large pitch decks failing/timing out - previously
 * every PDF, regardless of size, was base64-encoded and sent to Gemini
 * to read visually, which is slow and prone to timing out on bigger
 * files. Most pitch decks (even PDFs exported from Keynote/PPT/Canva)
 * have a real text layer, so this now handles the vast majority of
 * uploads without an AI call being involved in "reading" the file at all.
 */
async function extractPdfTextLocally(buf) {
  let parser;

  try {
    parser = new PDFParse({ data: buf, CanvasFactory });
    const result = await parser.getText();
    return (result?.text || "").trim();
  } catch (error) {
    console.error("Local PDF text extraction failed:", error?.message || error);
    return "";
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

/*
 * Calls Gemini first, then falls back to Groq if Gemini fails - same
 * pattern used by the Investor Agent. Only usable when there's no binary
 * attachment (Groq's free-tier model here is text-only), which covers
 * the PDF-with-text-layer path above plus DOCX/XLSX/CSV/TXT.
 */
async function callAIWithFallback(prompt, attachment, responseType) {
  try {
    const result = await callGemini(prompt, attachment, 4, responseType);
    if (!result?.trim()) {
      throw new Error("Gemini returned an empty response.");
    }
    return result.trim();
  } catch (geminiError) {
    console.error("Gemini call failed:", geminiError?.message || geminiError);

    if (attachment) {
      // Groq can't read binary attachments - nothing to fall back to.
      throw geminiError;
    }

    console.warn("Falling back to Groq...");
    return await callGroq(prompt, { jsonMode: responseType === "json" });
  }
}

const STARTUP_KEYS = [
  "name",
  "founder",
  "industry",
  "businessModel",
  "stage",
  "funding",
  "geography",
  "targetMarket",
  "technology",
  "traction",
  "website",
  "notes",
];

function ext(name = "") {
  const parts = name.toLowerCase().split(".");
  return parts[parts.length - 1];
}

/*
 * Convert a Blob stream into a Node.js Buffer.
 */
async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

/*
 * Read a file from the private Vercel Blob Store.
 */
async function readPrivateBlob(pathname) {
  if (!pathname) {
    throw new Error("Missing Blob pathname.");
  }

  const result = await get(pathname, {
    access: "private",
  });

  if (!result) {
    throw new Error(
      "The uploaded file could not be found in Blob storage."
    );
  }

  if (result.statusCode !== 200) {
    throw new Error(
      `Unable to read uploaded file. Blob status: ${result.statusCode}`
    );
  }

  if (!result.stream) {
    throw new Error(
      "The Blob Store did not return a readable file stream."
    );
  }

  return streamToBuffer(result.stream);
}

export async function POST(req) {
  try {
    let fileName;
    let type;
    let contentType;
    let buf;

    /*
     * =========================================================
     * STEP 1: Detect request type
     * =========================================================
     *
     * New large-file flow:
     *   application/json
     *   Browser → Vercel Blob → /api/extract
     *
     * Old/local flow:
     *   multipart/form-data
     *   Browser → /api/extract
     */

    const requestContentType =
      req.headers.get("content-type") || "";

    if (
      requestContentType.includes("application/json")
    ) {
      /*
       * NEW BLOB FLOW
       */
      const body = await req.json();

      const {
        pathname,
        fileName: incomingFileName,
        contentType: incomingContentType,
        type: incomingType,
      } = body;

      if (!pathname) {
        return Response.json(
          {
            error:
              "No Blob pathname was provided for extraction.",
          },
          {
            status: 400,
          }
        );
      }

      fileName = incomingFileName || pathname;
      contentType =
        incomingContentType ||
        "application/octet-stream";
      type = incomingType || "startup";

      console.log("Reading private Blob:", {
        pathname,
        fileName,
        contentType,
        type,
      });

      buf = await readPrivateBlob(pathname);
    } else {
      /*
       * OLD DIRECT FILE FLOW
       *
       * This keeps compatibility with any existing component
       * that still sends FormData directly.
       */
      const form = await req.formData();

      const file = form.get("file");
      type = form.get("type");

      if (!file) {
        return Response.json(
          {
            error: "No file provided.",
          },
          {
            status: 400,
          }
        );
      }

      fileName = file.name;
      contentType =
        file.type || "application/octet-stream";

      buf = Buffer.from(
        await file.arrayBuffer()
      );
    }

    const e = ext(fileName);

    if (!e) {
      return Response.json(
        {
          error:
            "Unable to determine the uploaded file type.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =========================================================
     * STEP 2: Investor CSV / TXT
     * =========================================================
     *
     * Parse locally. No Gemini call required.
     */

    if (
      type === "investor" &&
      (e === "csv" || e === "txt")
    ) {
      const text = buf.toString("utf-8");

      const rows = rowsToInvestors(text);

      return Response.json({
        mode: "rows",
        rows,
      });
    }

    /*
     * =========================================================
     * STEP 3: Investor Excel
     * =========================================================
     *
     * Parse every sheet and remove duplicates.
     */

    if (
      type === "investor" &&
      (e === "xlsx" || e === "xls")
    ) {
      const wb = XLSX.read(buf, {
        type: "buffer",
      });

      const rows = wb.SheetNames.flatMap(
        (sheetName) => {
          const csv = XLSX.utils.sheet_to_csv(
            wb.Sheets[sheetName]
          );

          return rowsToInvestors(csv);
        }
      );

      const seen = new Set();

      const deduped = rows.filter((row) => {
        const key = `${row.name}|${row.organization}|${row.email}`.toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

      return Response.json({
        mode: "rows",
        rows: deduped,
        sheets: wb.SheetNames.length,
      });
    }

    /*
     * =========================================================
     * STEP 4: Prepare content for Gemini
     * =========================================================
     */

    let attachment;
    let textContent;

    if (e === "docx") {
      const { value } =
        await mammoth.extractRawText({
          buffer: buf,
        });

      textContent = value;
    } else if (
      e === "csv" ||
      e === "txt"
    ) {
      textContent = buf.toString("utf-8");
    } else if (
      e === "xlsx" ||
      e === "xls"
    ) {
      const wb = XLSX.read(buf, {
        type: "buffer",
      });

      textContent =
        XLSX.utils.sheet_to_csv(
          wb.Sheets[wb.SheetNames[0]]
        );
    } else if (e === "pdf") {
      const localText = await extractPdfTextLocally(buf);

      if (localText.length >= MIN_EXTRACTED_PDF_CHARS) {
        // Normal case: PDF has a real text layer (true for the vast
        // majority of pitch decks, including ones exported from
        // Keynote/PowerPoint/Canva/Google Slides). No AI call is
        // involved in "reading" the file, so file size and Gemini
        // demand/timeouts stop being a factor for extraction quality.
        textContent = localText;
      } else if (buf.length > MAX_ATTACHMENT_BYTES) {
        // No usable text layer AND too large to safely send as a binary
        // attachment. Fail fast with a clear message instead of a slow
        // timeout.
        return Response.json(
          {
            error:
              "This PDF appears to be scanned/image-based (no selectable text) and is too large to process. " +
              "Try exporting a smaller version, or use a PDF with selectable text.",
          },
          { status: 400 }
        );
      } else {
        // Likely a scanned/image-only deck with no text layer - fall
        // back to sending it to Gemini for native vision reading, same
        // as before, but now only for the smaller minority of files
        // that actually need it.
        attachment = {
          kind: "document",
          mediaType: "application/pdf",
          data: buf.toString("base64"),
        };
      }
    } else if (
      ["jpg", "jpeg", "png"].includes(e)
    ) {
      if (buf.length > MAX_ATTACHMENT_BYTES) {
        return Response.json(
          {
            error: "This image is too large to process. Please upload a smaller file (under 15MB).",
          },
          { status: 400 }
        );
      }

      attachment = {
        kind: "image",
        mediaType:
          e === "png"
            ? "image/png"
            : "image/jpeg",
        data: buf.toString("base64"),
      };
    } else {
      return Response.json(
        {
          error:
            `.${e} isn't supported. ` +
            "Use CSV, XLSX, TXT, DOCX, PDF, JPG, or PNG " +
            "(export PPT/PPTX/DOC to PDF first).",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =========================================================
     * STEP 5: Startup extraction
     * =========================================================
     */

    if (type === "startup") {
      const prompt = `
Extract structured startup information from the attached content.

Respond with ONLY valid minified JSON.
Do not use markdown.
Do not add explanations.

Return exactly these keys:

${STARTUP_KEYS.join(", ")}

Rules:
- Use an empty string for anything not found.
- Never invent data.
- Keep the extracted information accurate.
${
  textContent
    ? `

Content:
${textContent.slice(0, 12000)}`
    : ""
}
      `.trim();

      const raw = await callAIWithFallback(
        prompt,
        attachment,
        "json"
      );

      let parsed;

      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(
          "Invalid Gemini startup response:",
          raw
        );

        throw new Error(
          "Gemini returned an invalid startup response."
        );
      }

      return Response.json({
        mode: "startup",
        data: parsed,
      });
    }

    /*
     * =========================================================
     * STEP 6: Investor / Mentor extraction
     * =========================================================
     */

    const prompt = `
Extract every investor or mentor mentioned in the attached content.

Respond with ONLY valid minified JSON.
Do not use markdown.
Do not add explanations.

Return an array of objects.

Each object must contain exactly these keys:

name,
organization,
email,
stages,
sectors,
geography,
ticket,
thesis,
portfolio,
website,
linkedin

Rules:
- Use an empty string for missing fields.
- Never invent information.
- If nothing is found, return [].
${
  textContent
    ? `

Content:
${textContent.slice(0, 12000)}`
    : ""
}
    `.trim();

    const raw = await callAIWithFallback(
      prompt,
      attachment,
      "json"
    );

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(
        "Invalid Gemini investor response:",
        raw
      );

      throw new Error(
        "Gemini returned an invalid investor response."
      );
    }

    const rows = (
      Array.isArray(parsed) ? parsed : []
    ).map((item) => ({
      ...emptyInvestor,
      ...item,
      id: genId(),
    }));

    return Response.json({
      mode: "rows",
      rows,
    });
  } catch (error) {
    console.error("Extraction error:", error);

    return Response.json(
      {
        error:
          error?.message ||
          "Extraction failed.",
      },
      {
        status: 500,
      }
    );
  }
}