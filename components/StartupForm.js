"use client";

import { useState } from "react";
import { upload as uploadToBlob } from "@vercel/blob/client";
import { Field } from "./UI";
import { STAGE_ORDER } from "../lib/matching";

export default function StartupForm({
  startup,
  setStartup,
  onContinue,
}) {
  const [status, setStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const upload = async (file) => {
    if (!file || isUploading) return;

    setIsUploading(true);

    setStatus({
      state: "loading",
      msg: `Uploading ${file.name}…`,
    });

    try {
      /*
       * STEP 1:
       * Upload the file directly from the browser to Vercel Blob.
       *
       * This prevents the large original file from passing through
       * the /api/extract Vercel Function request body.
       */
      const blob = await uploadToBlob(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/blob-upload",
        clientPayload: JSON.stringify({
          type: "startup",
          originalName: file.name,
        }),
      });

      if (!blob?.url) {
        throw new Error(
          "File upload completed, but no Blob URL was returned."
        );
      }

      setStatus({
        state: "loading",
        msg: `${file.name} uploaded. Extracting startup information…`,
      });

      /*
       * STEP 2:
       * Send only the Blob reference to /api/extract.
       *
       * We do NOT send the complete large file again.
       */
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          blobUrl: blob.url,
          pathname: blob.pathname,
          fileName: file.name,
          contentType:
            file.type || "application/octet-stream",
          type: "startup",
        }),
      });

      /*
       * Read as text first because platform-level errors may return
       * plain text or HTML instead of JSON.
       */
      const responseText = await res.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Server error (${res.status}): ${responseText.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            `Request failed with status ${res.status}`
        );
      }

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.data || typeof data.data !== "object") {
        throw new Error(
          "The server did not return valid startup data."
        );
      }

      /*
       * STEP 3:
       * Fill the Startup Profile fields automatically.
       */
      setStartup((prev) => {
        const next = { ...prev };

        Object.entries(data.data).forEach(([key, value]) => {
          if (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            key in next
          ) {
            next[key] = value;
          }
        });

        return next;
      });

      setStatus({
        state: "done",
        msg: `Extracted fields from ${file.name} — review and edit below.`,
      });
    } catch (error) {
      console.error(
        "Startup document upload/extraction error:",
        error
      );

      setStatus({
        state: "error",
        msg:
          error?.message ||
          "Couldn't upload or read that file. Please try again.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const set = (key) => (event) => {
    setStartup({
      ...startup,
      [key]: event.target.value,
    });
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>
        Startup profile
      </h3>

      <p
        style={{
          color: "var(--muted)",
          fontSize: 12.5,
          marginBottom: 10,
        }}
      >
        Upload a pitch deck or one-pager (PDF, DOCX, XLSX,
        CSV, TXT, JPG, PNG) and the fields below fill in
        automatically — or just type them in directly. For
        PPT/PPTX, export to PDF first.
      </p>

      <label
        className="dropzone"
        style={{
          cursor: isUploading ? "not-allowed" : "pointer",
          opacity: isUploading ? 0.7 : 1,
        }}
      >
        <input
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
          style={{ display: "none" }}
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              upload(file);
            }

            /*
             * Reset input so the same file can be selected again
             * after an error.
             */
            event.target.value = "";
          }}
        />

        <span>
          {isUploading
            ? "Uploading and processing document…"
            : "Click to upload a startup document"}
        </span>
      </label>

      {status && (
        <div
          className={`notice ${
            status.state === "error" ? "notice-error" : ""
          }`}
          style={{ marginTop: 10 }}
        >
          {status.msg}
        </div>
      )}

      <div
        className="grid"
        style={{ marginTop: 16 }}
      >
        <Field label="Startup name">
          <input
            value={startup.name || ""}
            onChange={set("name")}
          />
        </Field>

        <Field label="Founder(s)">
          <input
            value={startup.founder || ""}
            onChange={set("founder")}
          />
        </Field>

        <Field label="Industry / sector">
          <input
            value={startup.industry || ""}
            onChange={set("industry")}
            placeholder="e.g. climate, fintech, SaaS"
          />
        </Field>

        <Field label="Stage">
          <select
            value={startup.stage || "seed"}
            onChange={set("stage")}
          >
            {STAGE_ORDER.map((stage) => (
              <option
                key={stage}
                value={stage}
              >
                {stage}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Business model">
          <input
            value={startup.businessModel || ""}
            onChange={set("businessModel")}
            placeholder="e.g. B2B SaaS subscription"
          />
        </Field>

        <Field label="Funding requirement">
          <input
            value={startup.funding || ""}
            onChange={set("funding")}
            placeholder="e.g. $1.5M"
          />
        </Field>

        <Field label="Geography">
          <input
            value={startup.geography || ""}
            onChange={set("geography")}
            placeholder="e.g. India, Southeast Asia"
          />
        </Field>

        <Field label="Target market">
          <input
            value={startup.targetMarket || ""}
            onChange={set("targetMarket")}
          />
        </Field>

        <Field label="Technology">
          <input
            value={startup.technology || ""}
            onChange={set("technology")}
            placeholder="e.g. computer vision, IoT sensors"
          />
        </Field>

        <Field label="Website">
          <input
            value={startup.website || ""}
            onChange={set("website")}
          />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Traction">
          <textarea
            rows={2}
            value={startup.traction || ""}
            onChange={set("traction")}
          />
        </Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Additional notes">
          <textarea
            rows={2}
            value={startup.notes || ""}
            onChange={set("notes")}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          className="btn"
          disabled={!startup.name || isUploading}
          onClick={onContinue}
        >
          Save & continue
        </button>
      </div>
    </div>
  );
}