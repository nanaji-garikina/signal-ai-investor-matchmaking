import { callGemini } from "../../../lib/gemini";
import {
  emptyInvestor,
  genId,
  rowsToInvestors,
} from "../../../lib/matching";

import { get } from "@vercel/blob";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export const runtime = "nodejs";

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
      attachment = {
        kind: "document",
        mediaType: "application/pdf",
        data: buf.toString("base64"),
      };
    } else if (
      ["jpg", "jpeg", "png"].includes(e)
    ) {
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

      const raw = await callGemini(
        prompt,
        attachment
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

    const raw = await callGemini(
      prompt,
      attachment
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