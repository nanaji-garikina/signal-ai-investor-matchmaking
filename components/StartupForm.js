"use client";
import { useState } from "react";
import { Field } from "./UI";

export default function StartupForm({ startup, setStartup, onContinue }) {
  const [status, setStatus] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setStatus({ state: "loading", msg: `Reading ${file.name}…` });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "startup");
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStartup((prev) => {
        const next = { ...prev };
        Object.entries(data.data).forEach(([k, v]) => { if (v && k in next) next[k] = v; });
        return next;
      });
      setStatus({ state: "done", msg: `Extracted fields from ${file.name} — review and edit below.` });
    } catch (e) {
      setStatus({ state: "error", msg: e.message || "Couldn't read that file." });
    }
  };

  const set = (k) => (e) => setStartup({ ...startup, [k]: e.target.value });

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Startup profile</h3>
      <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>
        Upload a pitch deck or one-pager (PDF, DOCX, XLSX, CSV, TXT, JPG, PNG) and the fields below fill in
        automatically — or just type them in directly. For PPT/PPTX, export to PDF first.
      </p>
      <label className="dropzone">
        <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png" style={{ display: "none" }}
          onChange={(e) => upload(e.target.files[0])} />
        <span>Click to upload a startup document</span>
      </label>
      {status && <div className={`notice ${status.state === "error" ? "notice-error" : ""}`} style={{ marginTop: 10 }}>{status.msg}</div>}

      <div className="grid" style={{ marginTop: 16 }}>
        <Field label="Startup name"><input value={startup.name} onChange={set("name")} /></Field>
        <Field label="Founder(s)"><input value={startup.founder} onChange={set("founder")} /></Field>
        <Field label="Industry / sector"><input value={startup.industry} onChange={set("industry")} placeholder="e.g. climate, fintech, SaaS" /></Field>
        <Field label="Stage">
          <select value={startup.stage} onChange={set("stage")}>
            {["pre-seed", "seed", "series a", "series b", "series c", "growth", "late stage"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Business model"><input value={startup.businessModel} onChange={set("businessModel")} placeholder="e.g. B2B SaaS subscription" /></Field>
        <Field label="Funding requirement"><input value={startup.funding} onChange={set("funding")} placeholder="e.g. $1.5M" /></Field>
        <Field label="Geography"><input value={startup.geography} onChange={set("geography")} placeholder="e.g. India, Southeast Asia" /></Field>
        <Field label="Target market"><input value={startup.targetMarket} onChange={set("targetMarket")} /></Field>
        <Field label="Technology"><input value={startup.technology} onChange={set("technology")} placeholder="e.g. computer vision, IoT sensors" /></Field>
        <Field label="Website"><input value={startup.website} onChange={set("website")} /></Field>
      </div>
      <div style={{ marginTop: 14 }}><Field label="Traction"><textarea rows={2} value={startup.traction} onChange={set("traction")} /></Field></div>
      <div style={{ marginTop: 14 }}><Field label="Additional notes"><textarea rows={2} value={startup.notes} onChange={set("notes")} /></Field></div>
      <div style={{ marginTop: 16 }}>
        <button className="btn" disabled={!startup.name} onClick={onContinue}>Save & continue</button>
      </div>
    </div>
  );
}
