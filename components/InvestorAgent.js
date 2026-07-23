"use client";
import { useEffect, useState } from "react";

/* ============================================================================
 * AGENT REPLY RENDERER
 * ----------------------------------------------------------------------------
 * The AI prompt (see app/api/investor-agent/route.js RESPONSE FORMAT
 * section) asks the model for "## " headings, "**bold**", bullet/numbered
 * lists, and inline scores like "Geography: 100/100". This turns that into
 * real, styled JSX instead of showing raw markdown characters:
 *   - "## Heading"      -> uppercase section heading (.agent-heading)
 *   - "**bold**"        -> <strong>
 *   - "* item" / "- item" -> a real bullet list
 *   - "1. item"         -> a real numbered list
 *   - "Label: 82/100"   -> a colored score chip, using the same
 *                          good/mid/bad thresholds as the match Gauge
 *                          in components/UI.js
 *   - consecutive plain lines with no blank line between them are grouped
 *     into a single paragraph, instead of one <p> per line
 * ==========================================================================*/

// Same thresholds as Gauge() in components/UI.js, so a score mentioned in
// an agent reply is colored consistently with the rest of the app.
function scoreTier(value) {
  if (value >= 70) return "good";
  if (value >= 45) return "mid";
  return "bad";
}

// Matches "**bold**" and "Label words: NN/100" in a single pass so both can
// be replaced without one clobbering the other.
const INLINE_PATTERN = /(\*\*[^*]{1,300}?\*\*)|([A-Za-z][\w() /&+-]{1,40}?:\s*\d{1,3}\/100)/g;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let n = 0;
  let match;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-t-${n++}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      // **bold**
      nodes.push(<strong key={`${keyPrefix}-b-${n++}`}>{match[1].slice(2, -2)}</strong>);
    } else if (match[2]) {
      // "Label: NN/100" -> colored chip
      const raw = match[2];
      const colonIdx = raw.lastIndexOf(":");
      const label = raw.slice(0, colonIdx).trim();
      const valueMatch = raw.slice(colonIdx + 1).match(/(\d{1,3})\/100/);
      const value = valueMatch ? Math.min(100, parseInt(valueMatch[1], 10)) : null;

      if (value !== null) {
        nodes.push(
          <span className={`agent-score-chip ${scoreTier(value)}`} key={`${keyPrefix}-s-${n++}`}>
            {label}: {value}/100
          </span>
        );
      } else {
        nodes.push(<span key={`${keyPrefix}-s-${n++}`}>{raw}</span>);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`${keyPrefix}-t-${n++}`}>{text.slice(lastIndex)}</span>);
  }

  return nodes;
}

function renderAgentContent(content) {
  if (!content) return null;

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];

  let paraBuffer = [];
  let listBuffer = [];
  let listType = null; // "ul" | "ol"

  const flushParagraph = (key) => {
    if (!paraBuffer.length) return;
    const joined = paraBuffer.join(" ");
    blocks.push(<p key={`p-${key}`}>{renderInline(joined, `p-${key}`)}</p>);
    paraBuffer = [];
  };

  const flushList = (key) => {
    if (!listBuffer.length) return;
    const items = listBuffer;
    const isOrdered = listType === "ol";
    listBuffer = [];
    listType = null;

    blocks.push(
      isOrdered ? (
        <ol className="agent-list ordered" key={`list-${key}`}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `oli-${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul className="agent-list" key={`list-${key}`}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `uli-${key}-${i}`)}</li>
          ))}
        </ul>
      )
    );
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph(idx);
      flushList(idx);
      return;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      flushParagraph(idx);
      flushList(idx);
      blocks.push(
        <h4 className="agent-heading" key={`h-${idx}`}>
          {headingMatch[1].replace(/\*\*/g, "")}
        </h4>
      );
      return;
    }

    const bulletMatch = line.match(/^[*-]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph(idx);
      if (listType && listType !== "ul") flushList(idx);
      listType = "ul";
      listBuffer.push(bulletMatch[1]);
      return;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph(idx);
      if (listType && listType !== "ol") flushList(idx);
      listType = "ol";
      listBuffer.push(numberedMatch[1]);
      return;
    }

    flushList(idx);
    paraBuffer.push(line);
  });

  flushParagraph("end");
  flushList("end");

  return blocks;
}

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
              <div className="investor-agent-message-content">
                {m.role === "assistant" && !m.error ? renderAgentContent(m.content) : m.content}
              </div>
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