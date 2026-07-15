"use client";
import { useEffect, useMemo, useState } from "react";
import { Field, Gauge } from "./UI";
import { computeMatch, LABELS } from "../lib/matching";
import InvestorAgent from "./InvestorAgent";

const PAGE_SIZE = 20;

export default function MatchDashboard({ startup, investors, selected, setSelected, enrichment, setEnrichment, canContinue, onContinue }) {
  const [filters, setFilters] = useState({ minScore: 0, sector: "", stage: "", geo: "" });
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState({});
  const [agentTarget, setAgentTarget] = useState(null);

  const matches = useMemo(
    () => investors.map((inv) => ({ inv, m: computeMatch(startup, inv) })).sort((a, b) => b.m.overall - a.m.overall),
    [investors, startup]
  );

  const filtered = matches.filter(({ inv, m }) => {
    if (m.overall < filters.minScore) return false;
    if (filters.sector && !`${inv.sectors}`.toLowerCase().includes(filters.sector.toLowerCase())) return false;
    if (filters.stage && !`${inv.stages}`.toLowerCase().includes(filters.stage.toLowerCase())) return false;
    if (filters.geo && !`${inv.geography}`.toLowerCase().includes(filters.geo.toLowerCase())) return false;
    return true;
  });

  // Reset how many cards are shown whenever the filters change (so a narrower filter doesn't stay stuck at page 3).
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filters.minScore, filters.sector, filters.stage, filters.geo]);

  const visible = filtered.slice(0, visibleCount);
  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const enrichTop = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startup, matches: filtered.slice(0, 10).map(({ inv, m }) => ({ inv, subs: m.subs })) }),
      });
      const data = await res.json();
      if (data.enrichment) setEnrichment((prev) => ({ ...prev, ...data.enrichment }));
    } catch (e) {
      /* leave local scores as fallback */
    }
    setLoading(false);
  };

  const toggleSelect = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  return (
    <>
      <div className="filters">
        <Field label={`Min match score: ${filters.minScore}`}>
          <input type="range" min="0" max="100" value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: +e.target.value })} />
        </Field>
        <Field label="Sector contains"><input value={filters.sector} onChange={(e) => setFilters({ ...filters, sector: e.target.value })} /></Field>
        <Field label="Stage contains"><input value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })} /></Field>
        <Field label="Geography contains"><input value={filters.geo} onChange={(e) => setFilters({ ...filters, geo: e.target.value })} /></Field>
        <button className="btn" onClick={enrichTop} disabled={loading}>{loading ? "Enriching…" : "Enrich top 10 with AI rationale"}</button>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 12px" }}>
        Showing {visible.length} of {filtered.length} matching investor{filtered.length === 1 ? "" : "s"}
        {investors.length !== filtered.length ? ` (${investors.length} total uploaded)` : ""}
      </div>

      {filtered.length === 0 && <div className="empty">No investors match these filters.</div>}

      {visible.map(({ inv, m }) => {
        const enr = enrichment[inv.id];
        const isOpen = !!expanded[inv.id];
        return (
          <div className="match-card" key={inv.id}>
            <Gauge score={m.overall} />
            <div className="match-body">
              <div className="match-top">
                <div>
                  <strong>{inv.name}</strong>{inv.organization ? ` — ${inv.organization}` : ""}
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{[inv.email, inv.website, inv.linkedin].filter(Boolean).join(" · ")}</div>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" checked={!!selected[inv.id]} onChange={() => toggleSelect(inv.id)} />
                  Select for outreach
                </label>
              </div>
              <div className="subscores">
                {Object.entries(m.subs).map(([k, v]) => (
                  <span key={k} className={`sub ${v >= 70 ? "good" : v >= 40 ? "mid" : "bad"}`}>{LABELS[k]}: {v}</span>
                ))}
              </div>
              {enr?.rationale && <div className="rationale">{enr.rationale}</div>}
              {!enr?.rationale && m.matched.length > 0 && (
                <div className="rationale">Strong alignment on {m.matched.map((k) => LABELS[k].toLowerCase()).join(", ")}.</div>
              )}
              {enr?.concerns?.length > 0 && <div className="concerns">Concerns: {enr.concerns.join("; ")}</div>}
              {!enr?.concerns?.length && m.gaps.length > 0 && (
                <div className="concerns">Gaps: {m.gaps.map((k) => LABELS[k].toLowerCase()).join(", ")}</div>
              )}

              <div className="match-actions">
                <button className="agent-launch-btn" onClick={() => setAgentTarget({ inv, m })}>
                  <span className="agent-launch-icon">✦</span>
                  Ask Investor Agent
                </button>
              </div>

              <button
                className="btn-link"
                style={{ marginTop: 8, background: "none", border: "none", color: "var(--signal, #f0a830)", cursor: "pointer", padding: 0, fontSize: 13 }}
                onClick={() => toggleExpand(inv.id)}
              >
                {isOpen ? "Hide full profile ▲" : "Show full profile ▼"}
              </button>

              {isOpen && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border, #333)", fontSize: 13, lineHeight: 1.6 }}>
                  {inv.stages && <div><strong>Stages:</strong> {inv.stages}</div>}
                  {inv.sectors && <div><strong>Sectors:</strong> {inv.sectors}</div>}
                  {inv.geography && <div><strong>Geography:</strong> {inv.geography}</div>}
                  {inv.ticket && <div><strong>Typical ticket:</strong> {inv.ticket}</div>}
                  {inv.thesis && <div><strong>Thesis:</strong> {inv.thesis}</div>}
                  {inv.portfolio && <div><strong>Portfolio:</strong> {inv.portfolio}</div>}
                  {!inv.stages && !inv.sectors && !inv.geography && !inv.ticket && !inv.thesis && !inv.portfolio && (
                    <div style={{ color: "var(--muted)" }}>No additional details available for this investor.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {visibleCount < filtered.length && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
          Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more ({filtered.length - visibleCount} remaining)
        </button>
      )}

      <button className="btn" disabled={!canContinue} onClick={onContinue} style={{ marginTop: 16 }}>
        Continue to outreach ({Object.values(selected).filter(Boolean).length} selected) →
      </button>

      {agentTarget && (
        <InvestorAgent
          investor={agentTarget.inv}
          startup={startup}
          match={agentTarget.m}
          enrichment={enrichment[agentTarget.inv.id]}
          onClose={() => setAgentTarget(null)}
        />
      )}
    </>
  );
}