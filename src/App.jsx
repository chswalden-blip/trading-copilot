import { useState, useRef, useEffect, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_WATCHLIST = ["SOFI","HOOD","NVDA","AAPL","TSLA","MRVL","PLTR"];
const MARKET_OPEN_HOUR = 9.5;   // 9:30 ET
const MARKET_CLOSE_HOUR = 16;   // 4:00 ET

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
const store = {
  get: (k, fallback = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── MARKET HOURS ─────────────────────────────────────────────────────────────
function getMarketStatus() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const hour = et.getHours() + et.getMinutes() / 60;
  if (day === 0 || day === 6) return { status: "CLOSED", label: "Weekend", color: "#475569" };
  if (hour < MARKET_OPEN_HOUR - 2) return { status: "CLOSED", label: "Pre-Pre", color: "#475569" };
  if (hour < MARKET_OPEN_HOUR) return { status: "PREMARKET", label: "Pre-Market", color: "#fbbf24" };
  if (hour < MARKET_CLOSE_HOUR) return { status: "OPEN", label: "Market Open", color: "#22c55e" };
  if (hour < MARKET_CLOSE_HOUR + 4) return { status: "AFTERHOURS", label: "After Hours", color: "#f97316" };
  return { status: "CLOSED", label: "Closed", color: "#475569" };
}

// ─── AI PROMPTS ───────────────────────────────────────────────────────────────
const P = {
  market: () => `Professional trading analyst. Search for RIGHT NOW market data.
Return ONLY this format, no extra text:

MARKET — ${new Date().toLocaleDateString()}
SPY: $[price] [▲/▼][%] | [BULLISH/NEUTRAL/BEARISH] | Support $[x] Resist $[x]
QQQ: $[price] [▲/▼][%] | [BULLISH/NEUTRAL/BEARISH] | Support $[x] Resist $[x]
VIX: [level] | [FEAR/NEUTRAL/COMPLACENT] | [buying options is CHEAP/FAIR/EXPENSIVE]
Breadth: [%] above 50MA | [NARROW/BROAD] participation
Leaders: [sector] [sector]
Laggards: [sector] [sector]
This week: [one key event/earnings]
Gap-up alerts: [any stocks gapping 5%+ today — list them or "none"]

VERDICT: [RISK-ON / MIXED / RISK-OFF / STAY IN CASH]
SIZING: [FULL / REDUCED / MINIMAL]
REASON: [max 15 words]`,

  scan: () => `Professional options analyst. Search current market data now.
Scan: S&P500, Nasdaq100, unusual options flow, high relative volume, momentum names.

REJECT any setup with: earnings within 7 days, gap-up today over 4%, low OI under 300, choppy/sideways chart, VIX spike, poor R/R under 2:1.

Max 3 setups. If none qualify: output only "NO EDGE — STAY IN CASH" and one sentence why.

For each qualifying setup use EXACTLY this format:

==SETUP==
T:[ticker] D:[BULL/BEAR] G:[A+/A/B] EV:[x/10] PR:[x/10] RK:[x/10]
PRICE:$[x] SUP:$[x] RES:$[x]
ENTRY:$[x]-$[x] STOP:$[x] TP1:$[x] TP2:$[x] TP3:$[x] RR:[x:1]
CONTRACT:[Mmm DD] $[strike][C/P] DTE:[x] Δ:[x] Θ:[x] IV:[x%] OI:[x]
EDGE:[one sentence — specific reason this works right now]
DANGER:[one sentence — main reason it fails]
GAP_CHECK:[CLEAN/WARNING — one line]
CALL:[STRONG BUY/BUY/WATCHLIST]
==END==`,

  deepdive: (ticker) => `Professional options analyst. Deep dive ${ticker} RIGHT NOW.
Search: current price, trend, volume vs average, recent news, next earnings date.

Return ONLY this format:

==DIVE:${ticker}==
PRICE:$[x] TREND:[BULL/BEAR/NEUTRAL] VOL:[x]% vs avg
SUP:$[x] RES:$[x] EMA21:[above/below] EMA50:[above/below]
EARNINGS:[date] [SAFE/CAUTION — days away]
NEWS:[none / one line if relevant]
GAP_TODAY:[YES [%] — DO NOT TRADE / NO — CLEAR]
COMMITTEE:[APPROVED/REJECTED] — [one line reason]
CONTRACT:$[strike][C/P] [Mmm DD] DTE:[x] Δ:[x] Θ:[x] IV:[x%] OI:[x] Vol:[x]
ENTRY:$[x]-$[x] STOP:$[x] TP1:$[x] TP2:$[x] TP3:$[x] RR:[x:1]
VERDICT:[ENTER NOW / WAIT FOR PULLBACK / AVOID]
REASON:[one sentence]
==END==`,

  recheck: (trade) => `Professional trading analyst. Re-evaluate this saved trade setup RIGHT NOW.
Search current price and conditions for ${trade.ticker}.

Original setup: Entry $${trade.entry}, Stop $${trade.stop}, Target $${trade.tp2}
Contract: ${trade.contract}
Saved: ${trade.savedAt}

Return ONLY:
==RECHECK:${trade.ticker}==
CURRENT:$[price] vs entry $${trade.entry}
TREND:[STILL VALID / WEAKENING / BROKEN]
CONTRACT_STATUS:[STILL GOOD / REPRICED — check chain / EXPIRED]
GAP_CHECK:[CLEAN / WARNING]
EARNINGS_CHECK:[SAFE / CAUTION — [x] days]
VERDICT:[STILL VALID — ENTER / WAIT / SETUP EXPIRED — REMOVE]
REASON:[one sentence]
==END==`,

  flow: () => `Options flow analyst. Search for TODAY's unusual options activity right now.
Find sweeps, large blocks, unusual volume vs OI ratio.
Max 3 signals. If none notable: "NO UNUSUAL FLOW TODAY"

==FLOW==
T:[ticker] DIR:[BULL/BEAR] SIZE:[large/unusual]
ACTIVITY:[one line — what happened]
STRENGTH:[STRONG/MODERATE/WEAK]
TRADE:[YES/NO] — [if YES: $[strike][C/P] [expiry] one line why]
==END==`,

  risk: () => `Risk manager. Search current VIX and market conditions now.
Under 80 words total. Return ONLY:

RISK LEVEL: [LOW/MEDIUM/HIGH/EXTREME]
VIX: [level] — [implication for option buyers]
IV environment: [CHEAP/FAIR/EXPENSIVE — what this means for premiums]
Biggest threat: [one line]
Earnings landmines: [any major earnings this week that could spike vol]
Position size: [FULL 2-5% / REDUCED 1-2% / MINIMAL 0.5-1%]
VERDICT: [TRADE NORMAL / TRADE SMALL / STAY CASH]`,

  ask: (q) => `Professional trading analyst. Answer this question concisely with numbers and decisions, not paragraphs. Max 120 words. Question: ${q}`,
};

// ─── PARSERS ──────────────────────────────────────────────────────────────────
function parseSetups(text) {
  const blocks = [...text.matchAll(/==SETUP==([\s\S]*?)==END==/g)].map(m => m[1]);
  return blocks.map(b => {
    const g = (re) => b.match(re)?.[1]?.trim();
    return {
      ticker:    g(/T:([A-Z]+)/),
      direction: g(/D:(BULL|BEAR)/),
      grade:     g(/G:(A\+|A|B|C)/),
      ev:        g(/EV:(\d+)/),
      prob:      g(/PR:(\d+)/),
      risk:      g(/RK:(\d+)/),
      price:     g(/PRICE:\$([^\s]+)/),
      support:   g(/SUP:\$([^\s]+)/),
      resist:    g(/RES:\$([^\s]+)/),
      entry:     g(/ENTRY:\$([^\s]+)/),
      stop:      g(/STOP:\$([^\s]+)/),
      tp1:       g(/TP1:\$([^\s]+)/),
      tp2:       g(/TP2:\$([^\s]+)/),
      tp3:       g(/TP3:\$([^\s]+)/),
      rr:        g(/RR:([^\s]+)/),
      contract:  g(/CONTRACT:([^\n]+)/),
      dte:       g(/DTE:(\d+)/),
      delta:     g(/Δ:([^\s]+)/),
      theta:     g(/Θ:([^\s]+)/),
      iv:        g(/IV:([^\s%]+)/),
      oi:        g(/OI:([^\s]+)/),
      edge:      g(/EDGE:([^\n]+)/),
      danger:    g(/DANGER:([^\n]+)/),
      gap:       g(/GAP_CHECK:([^\n]+)/),
      call:      g(/CALL:(STRONG BUY|BUY|WATCHLIST|AVOID)/),
      raw: b,
    };
  });
}

function parseDive(text, ticker) {
  const block = text.match(new RegExp(`==DIVE:${ticker}==([\\s\\S]*?)==END==`))?.[1] || text;
  const g = (re) => block.match(re)?.[1]?.trim();
  return {
    ticker,
    price:     g(/PRICE:\$([^\s]+)/),
    trend:     g(/TREND:(BULL|BEAR|NEUTRAL)/),
    vol:       g(/VOL:([^\s]+)/),
    support:   g(/SUP:\$([^\s]+)/),
    resist:    g(/RES:\$([^\s]+)/),
    earnings:  g(/EARNINGS:([^\n]+)/),
    news:      g(/NEWS:([^\n]+)/),
    gap:       g(/GAP_TODAY:([^\n]+)/),
    committee: g(/COMMITTEE:(APPROVED|REJECTED)/),
    committeeReason: block.match(/COMMITTEE:(?:APPROVED|REJECTED)\s*—\s*([^\n]+)/)?.[1]?.trim(),
    contract:  g(/CONTRACT:([^\n]+)/),
    entry:     g(/ENTRY:\$([^\s]+)/),
    stop:      g(/STOP:\$([^\s]+)/),
    tp1:       g(/TP1:\$([^\s]+)/),
    tp2:       g(/TP2:\$([^\s]+)/),
    tp3:       g(/TP3:\$([^\s]+)/),
    rr:        g(/RR:([^\s]+)/),
    verdict:   g(/VERDICT:([^\n]+)/),
    reason:    g(/REASON:([^\n]+)/),
    raw: block,
  };
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const GC = { "A+":"#22c55e","A":"#86efac","B":"#fbbf24","C":"#f97316","Avoid":"#ef4444" };
const CC = { "STRONG BUY":"#22c55e","BUY":"#86efac","WATCHLIST":"#fbbf24","AVOID":"#ef4444" };
const SC = (n) => +n >= 8 ? "#22c55e" : +n >= 6 ? "#fbbf24" : "#ef4444";
const DC = (d) => d === "BULL" ? "#22c55e" : "#ef4444";

// ─── API CALL ─────────────────────────────────────────────────────────────────
async function callAI(systemNote, userPrompt) {
  // Rate limit: wait 2s between calls
  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `Trading analyst. ${systemNote} Follow output format exactly. Numbers only, no prose.`,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function ScorePill({ label, value }) {
  return (
    <div style={{ textAlign: "center", minWidth: 36 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: SC(value), lineHeight: 1, fontFamily: "'Syne', sans-serif" }}>{value}</div>
      <div style={{ fontSize: 8, color: "#334155", letterSpacing: "0.1em", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Tag({ children, color = "#3b82f6" }) {
  return (
    <span style={{
      background: `${color}15`, border: `1px solid ${color}35`,
      color, padding: "2px 8px", borderRadius: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
    }}>{children}</span>
  );
}

function InfoRow({ label, value, valueColor = "#94a3b8" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span style={{ fontSize: 11, color: "#334155", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 11, color: valueColor, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function RobinhoodChecklist({ delta, theta, oi, dte }) {
  const checks = [
    { label: `Delta ${delta || "—"} is 0.35–0.70`, pass: delta && +delta >= 0.35 && +delta <= 0.70 },
    { label: `Theta ${theta || "—"} is under –0.10`, pass: theta && +theta > -0.10 },
    { label: `OI ${oi || "—"} is 500+`, pass: oi && +oi.replace(/,/g,"") >= 500 },
    { label: `DTE ${dte || "—"} is 21–75 days`, pass: dte && +dte >= 21 && +dte <= 75 },
    { label: "No earnings within 7 days", pass: null },
    { label: "Bid/ask spread is tight (under $0.15)", pass: null },
  ];
  return (
    <div style={{ background: "rgba(250,204,21,0.04)", border: "1px solid rgba(250,204,21,0.1)", borderRadius: 8, padding: 12, marginTop: 10 }}>
      <div style={{ fontSize: 9, color: "#fbbf24", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 8 }}>✓ VERIFY IN ROBINHOOD</div>
      {checks.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: c.pass === null ? "#334155" : c.pass ? "#22c55e" : "#ef4444", flexShrink: 0 }}>
            {c.pass === null ? "□" : c.pass ? "✓" : "✗"}
          </span>
          <span style={{ fontSize: 11, color: c.pass === false ? "#ef4444" : "#475569" }}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function SetupCard({ setup, onSave, onDive, saved }) {
  const [open, setOpen] = useState(false);
  const isGap = setup.gap?.includes("WARNING");

  return (
    <div style={{
      background: "#080e1a",
      border: `1px solid ${GC[setup.grade] || "#1e293b"}25`,
      borderLeft: `3px solid ${GC[setup.grade] || "#1e293b"}`,
      borderRadius: 12, marginBottom: 10, overflow: "hidden",
      opacity: isGap ? 0.6 : 1,
    }}>
      {isGap && (
        <div style={{ background: "rgba(239,68,68,0.1)", padding: "6px 14px", fontSize: 10, color: "#ef4444", fontWeight: 700 }}>
          ⚠ GAP WARNING — {setup.gap}
        </div>
      )}

      {/* Card header */}
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>{setup.ticker}</span>
            <Tag color={DC(setup.direction)}>{setup.direction === "BULL" ? "▲ BULLISH" : "▼ BEARISH"}</Tag>
            {setup.grade && <Tag color={GC[setup.grade]}>{setup.grade}</Tag>}
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <ScorePill label="EV" value={setup.ev} />
            <ScorePill label="PROB" value={setup.prob} />
            <ScorePill label="RISK" value={setup.risk} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>{setup.edge}</div>
        {setup.call && (
          <div style={{ marginTop: 8 }}>
            <Tag color={CC[setup.call] || "#64748b"}>{setup.call}</Tag>
          </div>
        )}
      </div>

      {/* Expanded */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "14px 16px" }}>
          {/* Price grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[
              { l: "ENTRY", v: `$${setup.entry}`, c: "#3b82f6" },
              { l: "STOP", v: `$${setup.stop}`, c: "#ef4444" },
              { l: "R/R", v: setup.rr, c: "#fbbf24" },
              { l: "DTE", v: setup.dte ? `${setup.dte}d` : "—", c: "#94a3b8" },
            ].map(x => (
              <div key={x.l} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 6, padding: "8px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.08em", marginBottom: 3 }}>{x.l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: x.c }}>{x.v}</div>
              </div>
            ))}
          </div>

          {/* Targets */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[["TP1", setup.tp1], ["TP2", setup.tp2], ["TP3", setup.tp3]].map(([l, v]) => (
              <div key={l} style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)", borderRadius: 6, padding: "8px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.08em", marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#22c55e" }}>${v}</div>
              </div>
            ))}
          </div>

          {/* Contract */}
          {setup.contract && (
            <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#3b82f6", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 4 }}>BEST CONTRACT</div>
              <div style={{ fontSize: 12, color: "#93c5fd", fontFamily: "monospace", wordBreak: "break-all" }}>{setup.contract}</div>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                {[["Δ", setup.delta], ["Θ", setup.theta], ["IV", setup.iv ? `${setup.iv}%` : null], ["OI", setup.oi]].map(([l, v]) => v && (
                  <div key={l} style={{ fontSize: 10, color: "#475569" }}><span style={{ color: "#334155" }}>{l} </span>{v}</div>
                ))}
              </div>
            </div>
          )}

          {/* Danger */}
          {setup.danger && (
            <div style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#ef4444", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 3 }}>⚠ BIGGEST RISK</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{setup.danger}</div>
            </div>
          )}

          <RobinhoodChecklist delta={setup.delta} theta={setup.theta} oi={setup.oi} dte={setup.dte} />

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => onDive(setup.ticker)} style={btnStyle("#3b82f6", 1)}>↓ DEEP DIVE</button>
            <button
              onClick={() => onSave(setup)}
              style={btnStyle(saved ? "#22c55e" : "#fbbf24", 1)}
            >{saved ? "✓ SAVED" : "+ SAVE TRADE"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DiveCard({ dive, onSave, saved }) {
  const [open, setOpen] = useState(true);
  const approved = dive.committee === "APPROVED";
  const gapIssue = dive.gap?.toUpperCase().includes("YES");
  const verdictColor = dive.verdict?.includes("ENTER") ? "#22c55e" : dive.verdict?.includes("WAIT") ? "#fbbf24" : "#ef4444";

  return (
    <div style={{ background: "#080e1a", border: `1px solid ${approved ? "#22c55e" : "#ef4444"}20`, borderLeft: `3px solid ${approved ? "#22c55e" : "#ef4444"}`, borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
      {gapIssue && (
        <div style={{ background: "rgba(239,68,68,0.12)", padding: "6px 14px", fontSize: 10, color: "#ef4444", fontWeight: 700 }}>
          ⚠ GAP TODAY DETECTED — {dive.gap} — DO NOT ENTER TODAY
        </div>
      )}
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>{dive.ticker}</span>
              {dive.trend && <Tag color={dive.trend === "BULL" ? "#22c55e" : dive.trend === "BEAR" ? "#ef4444" : "#fbbf24"}>{dive.trend === "BULL" ? "▲" : dive.trend === "BEAR" ? "▼" : "→"} {dive.trend}</Tag>}
              <Tag color={approved ? "#22c55e" : "#ef4444"}>{approved ? "APPROVED" : "REJECTED"}</Tag>
            </div>
            <div style={{ fontSize: 11, color: "#475569" }}>{dive.committeeReason}</div>
          </div>
          {dive.price && <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>${dive.price}</div>}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "14px 16px" }}>
          <InfoRow label="Support / Resistance" value={`$${dive.support} / $${dive.resist}`} />
          <InfoRow label="Volume vs Average" value={`${dive.vol}%`} valueColor={+dive.vol?.replace("%","") > 100 ? "#22c55e" : "#94a3b8"} />
          <InfoRow label="Earnings" value={dive.earnings} valueColor={dive.earnings?.includes("CAUTION") ? "#ef4444" : "#22c55e"} />
          {dive.news && dive.news !== "none" && <InfoRow label="News" value={dive.news} valueColor="#fbbf24" />}

          {approved && !gapIssue && (
            <>
              <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, padding: 10, marginTop: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "#3b82f6", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 4 }}>RECOMMENDED CONTRACT</div>
                <div style={{ fontSize: 12, color: "#93c5fd", fontFamily: "monospace", wordBreak: "break-all", marginBottom: 6 }}>{dive.contract}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                  {[["ENTRY", `$${dive.entry}`], ["STOP", `$${dive.stop}`], ["TP2", `$${dive.tp2}`], ["R/R", dive.rr]].map(([l, v]) => (
                    <div key={l} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 5, padding: "6px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 8, color: "#334155", marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: l === "STOP" ? "#ef4444" : l === "R/R" ? "#fbbf24" : "#e2e8f0" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <RobinhoodChecklist />
            </>
          )}

          <div style={{ background: `${verdictColor}08`, border: `1px solid ${verdictColor}25`, borderRadius: 8, padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: verdictColor, fontFamily: "'Syne',sans-serif", letterSpacing: "0.05em" }}>{dive.verdict}</div>
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{dive.reason}</div>
          </div>

          {approved && !gapIssue && (
            <button onClick={() => onSave({ ticker: dive.ticker, entry: dive.entry, stop: dive.stop, tp1: dive.tp1, tp2: dive.tp2, tp3: dive.tp3, contract: dive.contract, rr: dive.rr, savedAt: new Date().toLocaleDateString() })} style={{ ...btnStyle(saved ? "#22c55e" : "#fbbf24", 1), marginTop: 10, width: "100%" }}>
              {saved ? "✓ SAVED TO JOURNAL" : "+ SAVE TO TRADE JOURNAL"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TradeJournal({ trades, onRemove, onRecheck, recheckResult }) {
  if (trades.length === 0) return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#1e293b", fontSize: 12 }}>
      No saved trades yet.<br />
      <span style={{ fontSize: 11, color: "#0f172a" }}>Save a setup from Scan or Deep Dive.</span>
    </div>
  );

  return (
    <div>
      {recheckResult && (
        <div style={{ background: "#080e1a", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 6 }}>RECHECK RESULT</div>
          <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 11, color: "#94a3b8", whiteSpace: "pre-wrap" }}>{recheckResult}</pre>
        </div>
      )}
      {trades.map((t, i) => (
        <div key={i} style={{ background: "#080e1a", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: 14, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>{t.ticker}</span>
              <span style={{ fontSize: 10, color: "#334155" }}>Saved {t.savedAt}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onRecheck(t)} style={btnStyle("#3b82f6", 0.7)}>RECHECK</button>
              <button onClick={() => onRemove(i)} style={btnStyle("#ef4444", 0.7)}>REMOVE</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
            {[["ENTRY", `$${t.entry}`], ["STOP", `$${t.stop}`], ["TP2", `$${t.tp2}`], ["R/R", t.rr]].map(([l, v]) => (
              <div key={l} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 5, padding: "6px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#334155", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: l === "STOP" ? "#ef4444" : l === "R/R" ? "#fbbf24" : "#94a3b8" }}>{v}</div>
              </div>
            ))}
          </div>
          {t.contract && <div style={{ fontSize: 10, color: "#334155", marginTop: 8, fontFamily: "monospace" }}>{t.contract}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── BUTTON STYLE ─────────────────────────────────────────────────────────────
function btnStyle(color, opacity = 1) {
  return {
    flex: 1, background: `${color}10`, border: `1px solid ${color}30`,
    borderRadius: 7, padding: "9px 12px", color,
    fontSize: 10, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", letterSpacing: "0.08em",
    opacity, transition: "all 0.15s",
  };
}

// ─── MARKET STATUS BAR ────────────────────────────────────────────────────────
function MarketStatusBar() {
  const [ms, setMs] = useState(getMarketStatus());
  useEffect(() => { const iv = setInterval(() => setMs(getMarketStatus()), 60000); return () => clearInterval(iv); }, []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: ms.color, boxShadow: `0 0 6px ${ms.color}`, animation: ms.status === "OPEN" ? "pulse 1.5s infinite" : "none" }} />
      <span style={{ fontSize: 9, color: ms.color, letterSpacing: "0.1em", fontWeight: 700 }}>{ms.label.toUpperCase()}</span>
    </div>
  );
}

// ─── LOADING SPINNER ──────────────────────────────────────────────────────────
const LOADING_SETS = {
  scan:    ["Scanning S&P 500…","Checking Nasdaq momentum…","Scanning unusual flow…","Running Risk Committee…","Rejecting weak setups…","Building trade cards…"],
  market:  ["Fetching SPY…","Reading QQQ…","Checking VIX…","Analyzing breadth…"],
  flow:    ["Scanning options flow…","Finding large sweeps…","Checking block trades…"],
  risk:    ["Assessing risk level…","Reading VIX environment…","Checking earnings calendar…"],
  dive:    ["Searching live data…","Checking earnings date…","Running Risk Committee…","Selecting best contract…"],
  recheck: ["Fetching current price…","Re-evaluating setup…","Checking for gaps…"],
  ask:     ["Analyzing…","Searching…","Processing…"],
};

function Spinner({ label }) {
  return (
    <div style={{ background: "#080e1a", border: "1px solid rgba(59,130,246,0.1)", borderRadius: 10, padding: 20, textAlign: "center", marginBottom: 10 }}>
      <div style={{ width: 18, height: 18, margin: "0 auto 10px", border: "1.5px solid rgba(59,130,246,0.2)", borderTop: "1.5px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 11, color: "#3b82f6", letterSpacing: "0.06em" }}>{label}</div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("scan");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [loadingType, setLoadingType] = useState(null);
  const [results, setResults] = useState([]);
  const [savedTrades, setSavedTrades] = useState(() => store.get("saved_trades", []));
  const [watchlist, setWatchlist] = useState(() => store.get("watchlist", DEFAULT_WATCHLIST));
  const [recheckResult, setRecheckResult] = useState(null);
  const [askInput, setAskInput] = useState("");
  const [addTicker, setAddTicker] = useState("");
  const topRef = useRef(null);

  // Persist saved trades
  useEffect(() => { store.set("saved_trades", savedTrades); }, [savedTrades]);
  useEffect(() => { store.set("watchlist", watchlist); }, [watchlist]);

  const run = useCallback(async (type, promptFn, ...args) => {
    setLoading(true);
    setLoadingType(type);
    const labels = LOADING_SETS[type] || LOADING_SETS.ask;
    let li = 0;
    setLoadingLabel(labels[0]);
    const iv = setInterval(() => { li = (li + 1) % labels.length; setLoadingLabel(labels[li]); }, 1900);
    try {
      const text = await callAI("Protect capital first. Reject bad setups.", promptFn(...args));
      setResults(prev => [{ type, text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }, ...prev.slice(0, 19)]);
      setTab("scan");
      setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) {
      setResults(prev => [{ type: "error", text: `Error: ${e.message}`, time: "" }, ...prev]);
    }
    clearInterval(iv);
    setLoading(false);
    setLoadingType(null);
  }, []);

  const handleSave = (trade) => {
    setSavedTrades(prev => {
      if (prev.find(t => t.ticker === trade.ticker && t.entry === trade.entry)) return prev;
      return [{ ...trade, savedAt: new Date().toLocaleDateString() }, ...prev];
    });
  };

  const handleRecheck = async (trade) => {
    setLoading(true);
    setLoadingType("recheck");
    setLoadingLabel("Fetching current price…");
    try {
      const text = await callAI("Re-evaluate saved trades objectively.", P.recheck(trade));
      setRecheckResult(text);
      setTab("journal");
    } catch (e) {
      setRecheckResult(`Error: ${e.message}`);
    }
    setLoading(false);
    setLoadingType(null);
  };

  const isSaved = (ticker) => savedTrades.some(t => t.ticker === ticker);

  // ── RENDER RESULT ──────────────────────────────────────────────────────────
  const renderResult = (r, i) => {
    if (r.type === "error") return (
      <div key={i} style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 11, color: "#ef4444" }}>{r.text}</div>
    );

    if (r.type === "scan") {
      const isCash = r.text.toUpperCase().includes("NO EDGE") || r.text.toUpperCase().includes("STAY IN CASH");
      const setups = parseSetups(r.text);
      if (isCash && setups.length === 0) return (
        <div key={i} style={{ background: "#080e1a", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 12, padding: 20, textAlign: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>◈</div>
          <div style={{ fontSize: 14, color: "#3b82f6", fontWeight: 800, fontFamily: "'Syne',sans-serif", letterSpacing: "0.06em", marginBottom: 6 }}>STAY IN CASH</div>
          <div style={{ fontSize: 11, color: "#334155" }}>No high-quality setups found. Protecting capital is the correct position.</div>
          <div style={{ fontSize: 10, color: "#1e293b", marginTop: 8 }}>{r.time}</div>
        </div>
      );
      return (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.1em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span>{setups.length} SETUP{setups.length !== 1 ? "S" : ""} PASSED RISK COMMITTEE — TAP TO EXPAND</span>
            <span>{r.time}</span>
          </div>
          {setups.map((s, j) => <SetupCard key={j} setup={s} onSave={handleSave} onDive={(t) => run("dive", P.deepdive, t)} saved={isSaved(s.ticker)} />)}
        </div>
      );
    }

    if (r.type === "dive") {
      const ticker = r.text.match(/==DIVE:([A-Z]+)==/)?.[1] || "TICKER";
      const dive = parseDive(r.text, ticker);
      return <DiveCard key={i} dive={dive} onSave={handleSave} saved={isSaved(dive.ticker)} />;
    }

    if (r.type === "market") {
      const lines = r.text.split("\n").filter(l => l.trim());
      const verdictLine = lines.find(l => l.startsWith("VERDICT:"));
      const verdictColor = verdictLine?.includes("RISK-ON") ? "#22c55e" : verdictLine?.includes("RISK-OFF") ? "#ef4444" : verdictLine?.includes("MIXED") ? "#fbbf24" : "#3b82f6";
      return (
        <div key={i} style={{ background: "#080e1a", border: "1px solid rgba(59,130,246,0.12)", borderRadius: 12, padding: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.1em", marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
            <span>MARKET SNAPSHOT</span><span>{r.time}</span>
          </div>
          {lines.map((line, j) => {
            const isVerdict = line.startsWith("VERDICT:");
            const isReason = line.startsWith("REASON:");
            const isSizing = line.startsWith("SIZING:");
            const isGapAlert = line.startsWith("Gap-up");
            return (
              <div key={j} style={{ padding: "3px 0", borderBottom: j < lines.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                <span style={{
                  fontSize: isVerdict ? 13 : 11,
                  fontFamily: isVerdict ? "'Syne',sans-serif" : "monospace",
                  fontWeight: isVerdict ? 800 : 400,
                  color: isVerdict ? verdictColor : isReason || isSizing ? "#475569" : isGapAlert && !line.includes("none") ? "#ef4444" : "#64748b",
                  letterSpacing: isVerdict ? "0.05em" : "0",
                }}>{line}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // Flow, Risk, Ask — clean text
    return (
      <div key={i} style={{ background: "#080e1a", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: 16, marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.1em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <span>{{ flow: "OPTIONS FLOW", risk: "RISK ASSESSMENT", ask: "ANALYSIS" }[r.type] || "RESULT"}</span>
          <span>{r.time}</span>
        </div>
        <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, color: "#64748b", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          dangerouslySetInnerHTML={{ __html: r.text
            .replace(/(STRONG BUY|APPROVED)/g, '<span style="color:#22c55e;font-weight:700;">$1</span>')
            .replace(/(REJECTED|AVOID|NO EDGE|STAY IN CASH)/g, '<span style="color:#ef4444;font-weight:700;">$1</span>')
            .replace(/(RISK-ON)/g, '<span style="color:#22c55e;font-weight:700;">$1</span>')
            .replace(/(RISK-OFF)/g, '<span style="color:#ef4444;font-weight:700;">$1</span>')
            .replace(/(MIXED)/g, '<span style="color:#fbbf24;font-weight:700;">$1</span>')
            .replace(/(\$[\d,.]+)/g, '<span style="color:#e2e8f0;">$1</span>')
          }}
        />
      </div>
    );
  };

  // ── TABS ───────────────────────────────────────────────────────────────────
  const TABS = [
    { id: "scan",    label: "SCAN",    badge: null },
    { id: "journal", label: "JOURNAL", badge: savedTrades.length || null },
    { id: "watch",   label: "WATCH",   badge: null },
    { id: "ask",     label: "ASK",     badge: null },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#04080f", fontFamily: "'Fira Code','Courier New',monospace", color: "#e2e8f0", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ background: "rgba(4,8,15,0.98)", borderBottom: "1px solid rgba(255,255,255,0.04)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.12em", fontFamily: "'Syne',sans-serif" }}>◈ TRADING COPILOT</div>
          <div style={{ fontSize: 9, color: "#1e293b", marginTop: 1, letterSpacing: "0.06em" }}>SCAN · DECIDE · VERIFY · TRADE</div>
        </div>
        <MarketStatusBar />
      </div>

      {/* Action buttons */}
      <div style={{ padding: "12px 16px 8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { type: "scan",   icon: "⬡", label: "FULL SCAN",     color: "#22c55e", desc: "Best trades now",          fn: () => run("scan",   P.scan)   },
          { type: "market", icon: "◉", label: "MARKET STATUS", color: "#3b82f6", desc: "SPY · QQQ · VIX",          fn: () => run("market", P.market) },
          { type: "flow",   icon: "◆", label: "OPTIONS FLOW",  color: "#a855f7", desc: "Unusual activity",         fn: () => run("flow",   P.flow)   },
          { type: "risk",   icon: "▲", label: "RISK CHECK",    color: "#ef4444", desc: "Position size & threats",   fn: () => run("risk",   P.risk)   },
        ].map(btn => (
          <button key={btn.type} onClick={btn.fn} disabled={loading} style={{
            background: loadingType === btn.type ? `${btn.color}15` : "#080e1a",
            border: `1px solid ${loadingType === btn.type ? btn.color + "40" : "rgba(255,255,255,0.05)"}`,
            borderRadius: 12, padding: "14px 12px", cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit", textAlign: "left", opacity: loading && loadingType !== btn.type ? 0.35 : 1, transition: "all 0.2s",
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{btn.icon}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: loading && loadingType !== btn.type ? "#1e293b" : btn.color, letterSpacing: "0.1em" }}>{btn.label}</div>
            <div style={{ fontSize: 9, color: "#1e293b", marginTop: 2 }}>{btn.desc}</div>
          </button>
        ))}
      </div>

      {/* Watchlist pills */}
      <div style={{ padding: "0 16px 10px", display: "flex", gap: 6, overflowX: "auto" }}>
        {watchlist.map(t => (
          <button key={t} onClick={() => run("dive", P.deepdive, t)} disabled={loading} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 5,
            padding: "5px 10px", color: loading ? "#0f172a" : "#334155",
            fontSize: 10, cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.1em", whiteSpace: "nowrap", flexShrink: 0,
          }}>{t}</button>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(4,8,15,0.9)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "10px 4px", background: "transparent",
            border: "none", borderBottom: `2px solid ${tab === t.id ? "#3b82f6" : "transparent"}`,
            color: tab === t.id ? "#3b82f6" : "#1e293b",
            fontSize: 9, cursor: "pointer", fontFamily: "inherit",
            fontWeight: 700, letterSpacing: "0.1em", position: "relative",
          }}>
            {t.label}
            {t.badge && <span style={{ position: "absolute", top: 6, right: "20%", background: "#3b82f6", color: "#fff", borderRadius: "50%", width: 14, height: 14, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }} ref={topRef}>
        {loading && <Spinner label={loadingLabel} />}

        {tab === "scan" && (
          <div>
            {results.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "50px 20px" }}>
                <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.08 }}>⬡</div>
                <div style={{ fontSize: 11, color: "#1e293b", letterSpacing: "0.1em", marginBottom: 10 }}>ONE TAP. REAL DATA. CLEAR DECISION.</div>
                <div style={{ fontSize: 10, color: "#0f172a", lineHeight: 2 }}>
                  FULL SCAN searches the entire market.<br />
                  No edge found = STAY IN CASH.<br />
                  Gap detected = SKIP automatically.
                </div>
              </div>
            )}
            {results.map(renderResult)}
          </div>
        )}

        {tab === "journal" && (
          <TradeJournal
            trades={savedTrades}
            onRemove={(i) => setSavedTrades(prev => prev.filter((_, j) => j !== i))}
            onRecheck={handleRecheck}
            recheckResult={recheckResult}
          />
        )}

        {tab === "watch" && (
          <div>
            <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.1em", marginBottom: 12 }}>YOUR WATCHLIST</div>
            {watchlist.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#080e1a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: "12px 14px", marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>{t}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => run("dive", P.deepdive, t)} disabled={loading} style={btnStyle("#3b82f6", 0.8)}>DIVE</button>
                  <button onClick={() => { if (DEFAULT_WATCHLIST.includes(t)) return; setSavedTrades(p => p); setWatchlist(prev => prev.filter(x => x !== t)); }} style={{ ...btnStyle("#ef4444", 0.6), opacity: DEFAULT_WATCHLIST.includes(t) ? 0.2 : 0.7, cursor: DEFAULT_WATCHLIST.includes(t) ? "not-allowed" : "pointer" }}>✕</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input
                value={addTicker}
                onChange={e => setAddTicker(e.target.value.toUpperCase().slice(0, 5))}
                onKeyDown={e => { if (e.key === "Enter" && addTicker && !watchlist.includes(addTicker)) { setWatchlist(p => [...p, addTicker]); setAddTicker(""); } }}
                placeholder="ADD TICKER..."
                style={{ flex: 1, background: "#080e1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7, padding: "10px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }}
              />
              <button
                onClick={() => { if (addTicker && !watchlist.includes(addTicker)) { setWatchlist(p => [...p, addTicker]); setAddTicker(""); } }}
                style={btnStyle("#22c55e", 1)}
              >ADD</button>
            </div>
          </div>
        )}

        {tab === "ask" && (
          <div>
            <div style={{ fontSize: 10, color: "#334155", letterSpacing: "0.1em", marginBottom: 12 }}>ASK YOUR ANALYST</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                value={askInput}
                onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && askInput.trim()) { run("ask", P.ask, askInput.trim()); setAskInput(""); } }}
                placeholder="Should I enter NVDA now? Is VIX too high?..."
                style={{ flex: 1, background: "#080e1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "12px 14px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }}
              />
              <button onClick={() => { if (askInput.trim()) { run("ask", P.ask, askInput.trim()); setAskInput(""); } }} disabled={loading || !askInput.trim()} style={btnStyle("#3b82f6", 1)}>ASK</button>
            </div>
            {[
              "Is now a good time to buy calls with VIX this low?",
              "What does it mean when a stock gaps up before I enter?",
              "How do I know if I should take profit early?",
              "What's the safest DTE for a beginner right now?",
            ].map((q, i) => (
              <button key={i} onClick={() => { run("ask", P.ask, q); }} disabled={loading} style={{ display: "block", width: "100%", background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.1)", borderRadius: 8, padding: "12px 14px", color: "#334155", fontSize: 11, cursor: "pointer", fontFamily: "inherit", textAlign: "left", marginBottom: 6, transition: "all 0.2s" }}>
                → {q}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&family=Syne:wght@700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 2px; height: 2px; }
        ::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.15); border-radius: 2px; }
        input::placeholder { color: #1e293b; }
        body { background: #04080f; }
      `}</style>
    </div>
  );
}
