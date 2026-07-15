"use client";
import { useState } from "react";
import { Field } from "./UI";
import { emptyInvestor, rowsToInvestors, genId } from "../lib/matching";

const PAGE_SIZE = 20;

export default function InvestorImport({ investors, setInvestors, canContinue, onContinue }) {
  const [draft, setDraft] = useState(emptyInvestor);
  const [bulkText, setBulkText] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [fileStatus, setFileStatus] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const addInvestor = () => {
    if (!draft.name.trim()) return;
    setInvestors((prev) => [...prev, { ...draft, id: genId() }]);
    setDraft(emptyInvestor);
  };

  const removeInvestor = (id) => setInvestors((prev) => prev.filter((i) => i.id !== id));

  const importBulk = () => {
    if (!bulkText.trim()) return;
    const rows = rowsToInvestors(bulkText);
    if (!rows.length) {
      setBulkMsg("Couldn't find a header row plus data rows. Paste the CSV including its header.");
      return;
    }
    setInvestors((prev) => [...prev, ...rows]);
    setBulkMsg(`Imported ${rows.length} investors.`);
    setBulkText("");
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setFileStatus({ state: "loading", msg: `Processing ${files.length} file(s)…` });
    let added = 0;
    const notes = [];
    const errors = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("type", "investor");
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setInvestors((prev) => [...prev, ...data.rows]);
        added += data.rows.length;
        if (data.sheets > 1) notes.push(`${file.name}: read ${data.sheets} sheets`);
      } catch (e) {
        errors.push(`${file.name}: ${e.message || "failed"}`);
      }
    }
    setFileStatus({
      state: errors.length ? "error" : "done",
      msg: `Added ${added} investor(s) from upload.${notes.length ? " " + notes.join("; ") + "." : ""}${errors.length ? " Issues: " + errors.join("; ") : ""}`,
    });
  };

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const visible = investors.slice(0, visibleCount);

  return (
    <>
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Upload investor file(s)</h3>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>
          Upload a Tracxn/Crunchbase export or your own list — CSV and XLSX are parsed on the server instantly,
          no size limit, no AI cost (every sheet in a multi-tab XLSX is read). PDFs, DOCX, or screenshots of shorter lists are read by AI instead.
        </p>
        <label className="dropzone">
          <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png" style={{ display: "none" }}
            onChange={(e) => uploadFiles(e.target.files)} />
          <span>Click to upload one or more investor files</span>
        </label>
        {fileStatus && <div className={`notice ${fileStatus.state === "error" ? "notice-error" : ""}`} style={{ marginTop: 10 }}>{fileStatus.msg}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Or paste CSV directly</h3>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 10 }}>Header row + data rows. Columns are auto-mapped by name.</p>
        <textarea rows={5} style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9, color: "var(--text)", padding: 10, fontFamily: "monospace", fontSize: 12.5 }}
          value={bulkText} onChange={(e) => setBulkText(e.target.value)}
          placeholder={"Investor Name,Organization,Email,Stage,Sectors,Geography,Ticket Size,Thesis\nJane Doe,Acme Ventures,jane@acme.vc,Seed,Climate,Global,$250K-$1M,Backs early climate hardware"} />
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn" onClick={importBulk}>Import rows</button>
          {bulkMsg && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{bulkMsg}</span>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 14 }}>Add investor manually</h3>
        <div className="grid">
          <Field label="Name"><input value={draft.name} onChange={set("name")} /></Field>
          <Field label="Organization"><input value={draft.organization} onChange={set("organization")} /></Field>
          <Field label="Email"><input value={draft.email} onChange={set("email")} /></Field>
          <Field label="Stages"><input value={draft.stages} onChange={set("stages")} placeholder="Seed, Series A" /></Field>
          <Field label="Preferred sectors"><input value={draft.sectors} onChange={set("sectors")} /></Field>
          <Field label="Geography"><input value={draft.geography} onChange={set("geography")} /></Field>
          <Field label="Average ticket size"><input value={draft.ticket} onChange={set("ticket")} placeholder="$250K-$1M" /></Field>
          <Field label="Website"><input value={draft.website} onChange={set("website")} /></Field>
          <Field label="LinkedIn"><input value={draft.linkedin} onChange={set("linkedin")} /></Field>
        </div>
        <div style={{ marginTop: 12 }}><Field label="Investment thesis / notes"><textarea rows={2} value={draft.thesis} onChange={set("thesis")} /></Field></div>
        <div style={{ marginTop: 12 }}><button className="btn" onClick={addInvestor}>Add investor</button></div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Investor list ({investors.length})</h3>
        {investors.length === 0 && <div className="empty">No investors yet — import a file, paste a CSV, or add one manually above.</div>}
        {investors.length > 0 && (
          <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 8 }}>
            Showing {visible.length} of {investors.length}
          </div>
        )}
        {visible.map((inv) => (
          <div key={inv.id} className="investor-row">
            <div>
              <strong>{inv.name || "Unnamed"}</strong>{inv.organization ? ` · ${inv.organization}` : ""}
              <div className="meta">{[inv.sectors, inv.stages, inv.geography].filter(Boolean).join(" · ")}</div>
            </div>
            <button className="btn ghost small" onClick={() => removeInvestor(inv.id)}>Remove</button>
          </div>
        ))}
        {visibleCount < investors.length && (
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            Load {Math.min(PAGE_SIZE, investors.length - visibleCount)} more ({investors.length - visibleCount} remaining)
          </button>
        )}
      </div>

      <button className="btn" disabled={!canContinue} onClick={onContinue}>See matches →</button>
    </>
  );
}