"use client";

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Gauge({ score }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 70 ? "var(--signal)" : score >= 45 ? "var(--warn)" : "var(--danger)";
  return (
    <div className="gauge">
      <svg width="66" height="66" viewBox="0 0 66 66">
        <circle cx="33" cy="33" r={r} stroke="var(--border)" strokeWidth="5" fill="none" />
        <circle
          cx="33" cy="33" r={r} stroke={color} strokeWidth="5" fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 33 33)"
        />
      </svg>
      <span className="gauge-num" style={{ color }}>{score}</span>
    </div>
  );
}
