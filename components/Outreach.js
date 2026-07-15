"use client";

import { useState } from "react";
import { Field } from "./UI";

const openInGmail = (to, subject, body) => {
  const url =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(to || "")}` +
    `&su=${encodeURIComponent(subject || "")}` +
    `&body=${encodeURIComponent(body || "")}`;

  window.open(url, "_blank", "noopener,noreferrer");
};

export default function Outreach({
  startup,
  selectedInvestors,
  enrichment,
  emails,
  setEmails,
  history,
  setHistory,
}) {
  const [loading, setLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);

  // Generate drafts for all selected investors
  const generateEmails = async () => {
    setLoading(true);

    try {
      const res = await fetch("/api/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startup,
          investors: selectedInvestors,
          enrichment,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error || "Could not generate email drafts."
        );
      }

      if (data.emails) {
        setEmails((prev) => ({
          ...prev,
          ...data.emails,
        }));
      }
    } catch (error) {
      alert(
        error.message ||
          "Could not generate personalized email drafts."
      );
    } finally {
      setLoading(false);
    }
  };

  // Regenerate only one investor's email
  const regenerateEmail = async (inv) => {
    setGeneratingId(inv.id);

    try {
      const res = await fetch("/api/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startup,
          investors: [inv],
          enrichment,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error || "Could not regenerate email."
        );
      }

      if (data.emails?.[inv.id]) {
        setEmails((prev) => ({
          ...prev,
          [inv.id]: data.emails[inv.id],
        }));
      }
    } catch (error) {
      alert(
        error.message ||
          "Could not regenerate personalized email."
      );
    } finally {
      setGeneratingId(null);
    }
  };

  const updateEmail = (id, key, value) => {
    setEmails((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value,
      },
    }));
  };

  const copy = async (text) => {
    await navigator.clipboard.writeText(text);
  };

  // Open Gmail and update status
  const openDraft = (inv) => {
    const em = emails[inv.id];

    if (!em || !inv.email) return;

    openInGmail(
      inv.email,
      em.subject,
      em.body
    );

    const openedAt = Date.now();

    setEmails((prev) => ({
      ...prev,
      [inv.id]: {
        ...prev[inv.id],
        status: "opened",
        openedAt,
      },
    }));

    const record = {
      id: `${inv.id}-${openedAt}`,
      ts: openedAt,
      investorId: inv.id,
      investor: inv.name,
      organization: inv.organization,
      to: inv.email,
      subject: em.subject,
      status: "opened",
    };

    setHistory((prev) => [
      record,
      ...prev.filter(
        (item) =>
          !(
            item.investorId === inv.id &&
            item.status === "opened"
          )
      ),
    ]);
  };

  // User confirms email was actually sent
  const markAsSent = (inv) => {
    const em = emails[inv.id];

    if (!em) return;

    const sentAt = Date.now();

    setEmails((prev) => ({
      ...prev,
      [inv.id]: {
        ...prev[inv.id],
        status: "sent",
        sentAt,
      },
    }));

    const sentRecord = {
      id: `${inv.id}-${sentAt}`,
      ts: sentAt,
      investorId: inv.id,
      investor: inv.name,
      organization: inv.organization,
      to: inv.email,
      subject: em.subject,
      status: "sent",
    };

    setHistory((prev) => [
      sentRecord,
      ...prev.filter(
        (item) => item.investorId !== inv.id
      ),
    ]);
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case "sent":
        return "SENT";
      case "opened":
        return "OPENED IN GMAIL";
      case "fallback":
        return "FALLBACK DRAFT";
      case "draft":
        return "READY TO REVIEW";
      default:
        return "DRAFT";
    }
  };

  return (
    <>
      <div className="notice">
        <strong>Review-first Gmail outreach:</strong>{" "}
        Generate a personalized AI email for each investor,
        review and edit it, open it in Gmail, attach your pitch
        deck, and send it. After returning to MatchEngine, click
        <strong> Mark as Sent</strong> to update the outreach
        status.
      </div>

      <button
        className="btn"
        onClick={generateEmails}
        disabled={loading}
      >
        {loading
          ? "Generating personalized drafts…"
          : "Generate personalized email drafts"}
      </button>

      <div style={{ marginTop: 18 }}>
        {selectedInvestors.map((inv) => {
          const em = emails[inv.id];

          return (
            <div className="email-card" key={inv.id}>
              <div className="match-top">
                <div>
                  <strong>
                    {inv.name}
                    {inv.organization
                      ? ` — ${inv.organization}`
                      : ""}
                  </strong>

                  {inv.email && (
                    <div className="meta">
                      {inv.email}
                    </div>
                  )}
                </div>

                {em && (
                  <span className="email-status">
                    {getStatusLabel(em.status)}
                  </span>
                )}
              </div>

              {em ? (
                <>
                  <div style={{ marginTop: 10 }}>
                    <Field label="Subject">
                      <input
                        value={em.subject || ""}
                        disabled={em.status === "sent"}
                        onChange={(e) =>
                          updateEmail(
                            inv.id,
                            "subject",
                            e.target.value
                          )
                        }
                      />
                    </Field>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <Field label="Body">
                      <textarea
                        rows={12}
                        value={em.body || ""}
                        disabled={em.status === "sent"}
                        onChange={(e) =>
                          updateEmail(
                            inv.id,
                            "body",
                            e.target.value
                          )
                        }
                      />
                    </Field>
                  </div>

                  <div className="row-actions">
                    {em.status !== "sent" && (
                      <>
                        <button
                          className="btn small ghost"
                          onClick={() =>
                            copy(
                              `${em.subject}\n\n${em.body}`
                            )
                          }
                        >
                          Copy draft
                        </button>

                        <button
                          className="btn small ghost"
                          disabled={
                            generatingId === inv.id
                          }
                          onClick={() =>
                            regenerateEmail(inv)
                          }
                        >
                          {generatingId === inv.id
                            ? "Regenerating…"
                            : "Regenerate"}
                        </button>

                        <button
                          className="btn small"
                          onClick={() =>
                            openDraft(inv)
                          }
                          disabled={!inv.email}
                        >
                          {em.status === "opened"
                            ? "Open Gmail Again"
                            : "Open in Gmail"}
                        </button>
                      </>
                    )}

                    {em.status === "opened" && (
                      <button
                        className="btn small"
                        onClick={() =>
                          markAsSent(inv)
                        }
                      >
                        ✓ Mark as Sent
                      </button>
                    )}

                    {em.status === "sent" && (
                      <span className="email-status">
                        ✓ Email marked as sent
                      </span>
                    )}
                  </div>

                  {!inv.email && (
                    <div
                      className="concerns"
                      style={{ marginTop: 8 }}
                    >
                      No email address is available for this
                      investor.
                    </div>
                  )}
                </>
              ) : (
                <div className="empty">
                  No draft generated yet.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>
            Outreach History
          </h3>

          {history.map((h) => (
            <div
              className="investor-row"
              key={h.id || h.ts}
            >
              <div>
                <strong>{h.investor}</strong>

                {h.organization
                  ? ` · ${h.organization}`
                  : ""}

                <div className="meta">
                  {h.to && `${h.to} · `}
                  {h.subject} ·{" "}
                  {new Date(h.ts).toLocaleString()}
                </div>
              </div>

              <span className="email-status">
                {h.status === "sent"
                  ? "✓ SENT"
                  : "OPENED IN GMAIL"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}