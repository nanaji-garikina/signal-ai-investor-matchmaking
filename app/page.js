"use client";
import { useEffect, useState } from "react";
import StartupForm from "../components/StartupForm";
import InvestorImport from "../components/InvestorImport";
import MatchDashboard from "../components/MatchDashboard";
import Outreach from "../components/Outreach";
import { emptyStartup } from "../lib/matching";

export default function Page() {
  const [step, setStep] = useState(1);
  const [theme, setTheme] = useState("light");
  const [startup, setStartup] = useState(emptyStartup);
  const [investors, setInvestors] = useState([]);
  const [selected, setSelected] = useState({});
  const [enrichment, setEnrichment] = useState({});
  const [emails, setEmails] = useState({});
  const [history, setHistory] = useState([]);

  // The color variables (--surface, --text, etc.) are declared at :root
  // and only overridden by the .dark/.light class. That class needs to
  // live on <html> (not just an inner wrapper div) or the page background
  // and any element outside the wrapper never picks up the new theme.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  const canStep3 = !!startup.name && investors.length > 0;
  const selectedInvestors = investors.filter((i) => selected[i.id]);
  const canStep4 = selectedInvestors.length > 0;

  return (
    <div className={theme}>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="dot" />
            <h1>Signal</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="tag">Founder ↔ Investor Matchmaking</span>
            <button className="btn ghost small on-topbar" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "☀ Light" : "● Dark"}
            </button>
          </div>
        </div>
      </div>

      <div className="shell">
        <div className="tabs">
          <button className={`tab ${step === 1 ? "active" : ""}`} onClick={() => setStep(1)}>01 · Startup</button>
          <button className={`tab ${step === 2 ? "active" : ""}`} onClick={() => setStep(2)}>02 · Investors</button>
          <button className={`tab ${step === 3 ? "active" : ""}`} disabled={!canStep3} onClick={() => setStep(3)}>03 · Matches</button>
          <button className={`tab ${step === 4 ? "active" : ""}`} disabled={!canStep4} onClick={() => setStep(4)}>04 · Outreach</button>
        </div>

        {step === 1 && <StartupForm startup={startup} setStartup={setStartup} onContinue={() => setStep(2)} />}

        {step === 2 && (
          <InvestorImport
            investors={investors}
            setInvestors={setInvestors}
            canContinue={canStep3}
            onContinue={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <MatchDashboard
            startup={startup}
            investors={investors}
            selected={selected}
            setSelected={setSelected}
            enrichment={enrichment}
            canContinue={canStep4}
            onContinue={() => setStep(4)}
          />
        )}

        {step === 4 && (
          <Outreach
            startup={startup}
            selectedInvestors={selectedInvestors}
            enrichment={enrichment}
            emails={emails}
            setEmails={setEmails}
            history={history}
            setHistory={setHistory}
          />
        )}
      </div>
    </div>
  );
}