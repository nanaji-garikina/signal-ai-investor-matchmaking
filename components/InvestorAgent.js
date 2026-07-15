"use client";
import { useEffect, useState } from "react";

const SUGGESTED_QUESTIONS = [
  "Why is this investor a good match for my startup?",
  "What are the biggest weaknesses or risks in this match?",
  "How should I approach this investor?",
  "What should I mention in my pitch and outreach email?",
];

export default function InvestorAgent({ investor, startup, match, enrichment, onClose }) {
  const storageKey = investor?.id ? `signal-agent-${investor.id}` : null;
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try { setMessages(JSON.parse(localStorage.getItem(storageKey) || "[]")); }
    catch { setMessages([]); }
    setQuestion("");
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  if (!investor || !match) return null;

  const askQuestion = async (text) => {
    const clean = text?.trim();
    if (!clean || loading) return;
    const userMessage = { role: "user", content: clean };
    const previous = messages;
    setMessages((m) => [...m, userMessage]);
    setQuestion("");
    setLoading(true);
    try {
      const res = await fetch("/api/investor-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startup, investor,
          match: { overall: match.overall, subs: match.subs, matched: match.matched, gaps: match.gaps },
          enrichment: enrichment || null,
          messages: previous,
          question: clean,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Investor Agent failed.");
      setMessages((m) => [...m, { role: "assistant", content: data.answer || "No answer was generated." }]);
    } catch (error) {
      setMessages((m) => [...m, { role: "assistant", content: error.message || "I couldn't answer right now. Please try again.", error: true }]);
    } finally { setLoading(false); }
  };

  const clearChat = () => {
    setMessages([]);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  return (
    <div className="investor-agent-overlay" onClick={onClose}>
      <aside className="investor-agent-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="investor-agent-header">
          <div>
            <div className="investor-agent-label">✦ INVESTOR INTELLIGENCE AGENT</div>
            <h2>{investor.name}</h2>
            {investor.organization && <div className="investor-agent-organization">{investor.organization}</div>}
          </div>
          <button className="investor-agent-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="investor-agent-score-card">
          <div><span>MATCH SCORE</span><strong>{match.overall}/100</strong></div>
          <p>{enrichment?.rationale || "Ask the agent to understand this match, its strengths, gaps, and the best outreach angle."}</p>
        </div>

        {messages.length === 0 && (
          <div className="investor-agent-welcome">
            <div className="agent-orb">✦</div>
            <div>
              <h3>Understand this investor before outreach</h3>
              <p>I use your startup profile, this investor's data, match dimensions, and AI rationale to give grounded, investor-specific answers.</p>
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="investor-agent-suggestions">
            <div className="investor-agent-section-label">QUICK QUESTIONS</div>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => askQuestion(q)} disabled={loading}>{q}<span>→</span></button>
            ))}
          </div>
        )}

        <div className="investor-agent-messages">
          {messages.map((m, i) => (
            <div key={i} className={`investor-agent-message ${m.role} ${m.error ? "error" : ""}`}>
              <div className="investor-agent-message-role">{m.role === "user" ? "YOU" : "✦ AGENT"}</div>
              <div className="investor-agent-message-content">{m.content}</div>
            </div>
          ))}
          {loading && <div className="investor-agent-message assistant"><div className="investor-agent-message-role">✦ AGENT</div><div className="investor-agent-thinking"><i></i><i></i><i></i> Analyzing this investor...</div></div>}
        </div>

        <form className="investor-agent-input-area" onSubmit={(e) => { e.preventDefault(); askQuestion(question); }}>
          <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask anything about ${investor.name}...`} disabled={loading}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(question); } }} />
          <div className="investor-agent-input-footer">
            <button type="button" className="btn small ghost" onClick={clearChat} disabled={!messages.length}>Clear chat</button>
            <button className="btn small" disabled={!question.trim() || loading}>{loading ? "Thinking…" : "Ask Agent →"}</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
