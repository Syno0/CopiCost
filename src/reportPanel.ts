import * as vscode from "vscode";
import { SessionCost } from "./costCalculator";
import { formatUsd, formatTokens } from "./sessionTreeProvider";
import {
  CACHE_SAVINGS_ESTIMATE_PER_M,
  REPORT_MAX_SESSIONS,
  REPORT_MAX_DAYS,
  REPORT_TOP_EXPENSIVE,
} from "./config";

export function createReportPanel(
  context: vscode.ExtensionContext,
  sessions: SessionCost[],
): void {
  const panel = vscode.window.createWebviewPanel(
    "copicost.report",
    "CopiCost — Full Report",
    vscode.ViewColumn.One,
    { enableScripts: false },
  );

  panel.webview.html = generateReportHtml(sessions);
}

function generateReportHtml(sessions: SessionCost[]): string {
  const totalCost = sessions.reduce((sum, s) => sum + s.totalCost, 0);
  const totalRequests = sessions.reduce((sum, s) => sum + s.requests.length, 0);
  const totalInputTokens = sessions.reduce(
    (sum, s) => sum + s.totalInputTokens,
    0,
  );
  const totalOutputTokens = sessions.reduce(
    (sum, s) => sum + s.totalOutputTokens,
    0,
  );
  const totalCachedTokens = sessions.reduce(
    (sum, s) => sum + s.totalCachedTokens,
    0,
  );
  const cacheRate =
    totalInputTokens > 0
      ? ((totalCachedTokens / totalInputTokens) * 100).toFixed(0)
      : "0";
  const avgCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
  const noCacheCostEstimate =
    totalCost + (totalCachedTokens / 1_000_000) * CACHE_SAVINGS_ESTIMATE_PER_M;

  // Group costs by model
  const byModel = new Map<
    string,
    {
      requests: number;
      cost: number;
      input: number;
      output: number;
      cached: number;
    }
  >();
  for (const session of sessions) {
    for (const req of session.requests) {
      const existing = byModel.get(req.model) ?? {
        requests: 0,
        cost: 0,
        input: 0,
        output: 0,
        cached: 0,
      };
      existing.requests++;
      existing.cost += req.totalCost;
      existing.input += req.inputTokens;
      existing.output += req.outputTokens;
      existing.cached += req.cachedTokens;
      byModel.set(req.model, existing);
    }
  }

  // Group costs by day
  const byDay = new Map<string, { cost: number; requests: number }>();
  for (const session of sessions) {
    for (const req of session.requests) {
      const day = new Date(req.timestamp).toISOString().substring(0, 10);
      const existing = byDay.get(day) ?? { cost: 0, requests: 0 };
      existing.cost += req.totalCost;
      existing.requests++;
      byDay.set(day, existing);
    }
  }
  const sortedDays = [...byDay.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  );

  // Top expensive requests
  const allRequests = sessions.flatMap((s) => s.requests);
  const topExpensive = [...allRequests]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, REPORT_TOP_EXPENSIVE);

  const modelRows = [...byModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(
      ([model, data]) => `
      <tr>
        <td><span class="model-pill">${escapeHtml(model)}</span></td>
        <td>${data.requests}</td>
        <td>${formatTokens(data.input)}</td>
        <td>${formatTokens(data.output)}</td>
        <td>${data.input > 0 ? ((data.cached / data.input) * 100).toFixed(0) : 0}%</td>
        <td class="cost-cell">${formatUsd(data.cost)}</td>
        <td class="cost-cell">${formatUsd(data.cost / data.requests)}</td>
      </tr>`,
    )
    .join("");

  const dayRows = sortedDays
    .slice(0, REPORT_MAX_DAYS)
    .map(
      ([day, data]) => `
      <tr>
        <td>${day}</td>
        <td>${data.requests}</td>
        <td class="cost-cell">${formatUsd(data.cost)}</td>
        <td>${renderMiniBar(data.cost, Math.max(...sortedDays.map((d) => d[1].cost)))}</td>
      </tr>`,
    )
    .join("");

  const topRows = topExpensive
    .map(
      (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><span class="model-pill">${escapeHtml(r.model)}</span></td>
        <td>${formatTokens(r.inputTokens)}</td>
        <td>${formatTokens(r.outputTokens)}</td>
        <td class="cost-cell">${formatUsd(r.totalCost)}</td>
        <td>${r.debugName ? escapeHtml(r.debugName) : ""}</td>
      </tr>`,
    )
    .join("");

  const sessionRows = sessions
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
    .slice(0, REPORT_MAX_SESSIONS)
    .map(
      (s) => `
      <tr>
        <td>${s.startTime ? new Date(s.startTime).toLocaleString() : "N/A"}</td>
        <td>${s.requests.length}</td>
        <td>${formatTokens(s.totalInputTokens + s.totalOutputTokens)}</td>
        <td class="cost-cell">${formatUsd(s.totalCost)}</td>
        <td class="msg">${escapeHtml(s.userMessage ?? "").substring(0, 60)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>CopiCost Report</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-foreground, #ccc);
      --accent: var(--vscode-textLink-foreground, #4fc1ff);
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
      --border: var(--vscode-panel-border, #444);
      --red: var(--vscode-charts-red, #f44747);
      --orange: var(--vscode-charts-orange, #d18616);
      --green: var(--vscode-charts-green, #89d185);
    }
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family, system-ui); padding: 32px; color: var(--fg); background: var(--bg); line-height: 1.5; }
    h1 { color: var(--accent); font-size: 1.8em; margin-bottom: 8px; }
    .subtitle { opacity: 0.6; margin-bottom: 32px; }
    .hero { text-align: center; padding: 40px 0; border-bottom: 2px solid var(--border); margin-bottom: 32px; }
    .hero .amount { font-size: 4em; font-weight: bold; color: var(--accent); letter-spacing: -2px; }
    .hero .meta { margin-top: 8px; opacity: 0.7; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 24px 0; }
    .card { background: var(--card-bg); border-radius: 10px; padding: 20px; border: 1px solid var(--border); }
    .card .value { font-size: 1.6em; font-weight: bold; }
    .card .label { font-size: 0.75em; opacity: 0.5; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card.highlight { border-color: var(--accent); }
    .card.highlight .value { color: var(--accent); }
    .card.savings .value { color: var(--green); }
    h2 { margin-top: 40px; padding-bottom: 8px; border-bottom: 1px solid var(--border); font-size: 1.1em; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.9em; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    th { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.5; }
    tr:hover { background: var(--card-bg); }
    .cost-cell { font-weight: bold; font-family: monospace; }
    .model-pill { background: var(--card-bg); padding: 2px 8px; border-radius: 10px; font-size: 0.85em; border: 1px solid var(--border); }
    .mini-bar { height: 8px; border-radius: 4px; background: var(--accent); opacity: 0.7; }
    .msg { opacity: 0.6; font-size: 0.85em; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .perspective { background: var(--card-bg); border-left: 4px solid var(--accent); padding: 16px 20px; margin: 24px 0; border-radius: 0 10px 10px 0; }
    .perspective strong { color: var(--accent); }
  </style>
</head>
<body>
  <div class="hero">
    <div class="amount">${formatUsd(totalCost)}</div>
    <div class="meta">Total estimated Copilot cost across ${sessions.length} sessions</div>
  </div>

  <div class="cards">
    <div class="card highlight">
      <div class="value">${totalRequests}</div>
      <div class="label">LLM Calls</div>
    </div>
    <div class="card">
      <div class="value">${formatTokens(totalInputTokens)}</div>
      <div class="label">Input Tokens</div>
    </div>
    <div class="card">
      <div class="value">${formatTokens(totalOutputTokens)}</div>
      <div class="label">Output Tokens</div>
    </div>
    <div class="card">
      <div class="value">${cacheRate}%</div>
      <div class="label">Cache Hit Rate</div>
    </div>
    <div class="card">
      <div class="value">${formatUsd(avgCostPerRequest)}</div>
      <div class="label">Avg / Request</div>
    </div>
    <div class="card savings">
      <div class="value">~${formatUsd(noCacheCostEstimate - totalCost)}</div>
      <div class="label">Saved by Cache</div>
    </div>
  </div>

  <div class="perspective">
    💡 <strong>Perspective:</strong> At your average usage rate, you spend roughly
    <strong>${formatUsd(sortedDays.length > 0 ? sortedDays.reduce((s, [, d]) => s + d.cost, 0) / sortedDays.length : 0)}/day</strong>.
    That's ~<strong>${formatUsd((sortedDays.length > 0 ? sortedDays.reduce((s, [, d]) => s + d.cost, 0) / sortedDays.length : 0) * 22)}/month</strong> (22 work days).
    ${totalCost > 1 ? `<br>🔥 You've already spent more than <strong>$${Math.floor(totalCost)}</strong> total.` : ""}
  </div>

  <h2>💸 Top 10 Most Expensive Requests</h2>
  <table>
    <thead><tr><th>#</th><th>Model</th><th>Input</th><th>Output</th><th>Cost</th><th>Context</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>

  <h2>🤖 Cost by Model</h2>
  <table>
    <thead><tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cache%</th><th>Cost</th><th>Avg/Call</th></tr></thead>
    <tbody>${modelRows}</tbody>
  </table>

  <h2>📅 Cost by Day</h2>
  <table>
    <thead><tr><th>Date</th><th>Requests</th><th>Cost</th><th></th></tr></thead>
    <tbody>${dayRows}</tbody>
  </table>

  <h2>💬 Recent Sessions</h2>
  <table>
    <thead><tr><th>Date</th><th>Calls</th><th>Tokens</th><th>Cost</th><th>First Message</th></tr></thead>
    <tbody>${sessionRows}</tbody>
  </table>
</body>
</html>`;
}

function renderMiniBar(value: number, max: number): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="mini-bar" style="width:${pct}%"></div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
