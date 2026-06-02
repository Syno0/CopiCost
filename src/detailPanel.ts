import * as vscode from "vscode";
import { RequestCost, SessionCost } from "./costCalculator";
import { formatUsd, formatTokens, formatDuration } from "./sessionTreeProvider";
import {
  COST_THRESHOLD_HIGH,
  COST_THRESHOLD_MEDIUM,
  COST_THRESHOLD_LOW,
  APPROX_INPUT_PRICE_USD_PER_M,
  APPROX_INPUT_PRICE_DEFAULT,
} from "./config";

export function showRequestDetailPanel(
  context: vscode.ExtensionContext,
  request: RequestCost,
  index: number,
  session: SessionCost,
): void {
  const panel = vscode.window.createWebviewPanel(
    "copicost.requestDetail",
    `Request #${index + 1} — ${formatUsd(request.totalCost)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  panel.webview.html = generateDetailHtml(request, index, session);
}

function generateDetailHtml(
  request: RequestCost,
  index: number,
  session: SessionCost,
): string {
  const nonCached = request.inputTokens - request.cachedTokens;
  const cacheRate =
    request.inputTokens > 0
      ? ((request.cachedTokens / request.inputTokens) * 100).toFixed(1)
      : "0";
  const pctOfSession =
    session.totalCost > 0
      ? ((request.totalCost / session.totalCost) * 100).toFixed(1)
      : "0";

  // Cost without cache (hypothetical)
  const hypotheticalNoCacheCost =
    request.outputCost +
    (request.inputTokens / 1_000_000) * getModelInputPrice(request.model);
  const savings = hypotheticalNoCacheCost - request.totalCost;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Request Detail</title>
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
      --yellow: var(--vscode-charts-yellow, #cca700);
    }
    body { font-family: var(--vscode-font-family, system-ui); padding: 24px; color: var(--fg); background: var(--bg); line-height: 1.5; max-width: 700px; }
    .cost-hero { text-align: center; padding: 32px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .cost-hero .amount { font-size: 3em; font-weight: bold; color: ${getCostCssColor(request.totalCost)}; }
    .cost-hero .subtitle { font-size: 0.9em; opacity: 0.7; margin-top: 8px; }
    .cost-hero .model-badge { display: inline-block; margin-top: 12px; padding: 4px 12px; border-radius: 12px; background: var(--card-bg); border: 1px solid var(--border); font-size: 0.85em; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0; }
    .card { background: var(--card-bg); border-radius: 8px; padding: 16px; border: 1px solid var(--border); }
    .card .value { font-size: 1.5em; font-weight: bold; }
    .card .label { font-size: 0.8em; opacity: 0.6; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .section { margin-top: 28px; }
    .section h3 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    th { font-size: 0.75em; text-transform: uppercase; opacity: 0.5; }
    .bar-container { width: 100%; height: 24px; background: var(--card-bg); border-radius: 4px; overflow: hidden; display: flex; margin: 16px 0; }
    .bar-segment { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 0.7em; font-weight: bold; color: #fff; }
    .bar-input { background: var(--orange); }
    .bar-cached { background: var(--green); }
    .bar-output { background: var(--red); }
    .insight { background: var(--card-bg); border-left: 3px solid var(--accent); padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    .insight strong { color: var(--accent); }
    .savings { color: var(--green); font-weight: bold; }
  </style>
</head>
<body>
  <div class="cost-hero">
    <div class="amount">${formatUsd(request.totalCost)}</div>
    <div class="subtitle">Single LLM call · Request #${index + 1} of ${session.requests.length}</div>
    <div class="model-badge">${escapeHtml(request.model)}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="value" style="color: var(--orange)">${formatTokens(nonCached)}</div>
      <div class="label">Input tokens (fresh)</div>
    </div>
    <div class="card">
      <div class="value" style="color: var(--green)">${formatTokens(request.cachedTokens)}</div>
      <div class="label">Input tokens (cached)</div>
    </div>
    <div class="card">
      <div class="value" style="color: var(--red)">${formatTokens(request.outputTokens)}</div>
      <div class="label">Output tokens</div>
    </div>
    <div class="card">
      <div class="value">${request.ttft ? (request.ttft / 1000).toFixed(1) + "s" : "N/A"}</div>
      <div class="label">Time to first token</div>
    </div>
  </div>

  <div class="section">
    <h3>Cost Distribution</h3>
    <div class="bar-container">
      ${renderBar(request)}
    </div>
    <table>
      <thead><tr><th>Component</th><th>Tokens</th><th>Cost</th><th>% of total</th></tr></thead>
      <tbody>
        <tr>
          <td>🟠 Input (fresh)</td>
          <td>${formatTokens(nonCached)}</td>
          <td>${formatUsd(request.inputCost)}</td>
          <td>${pctOf(request.inputCost, request.totalCost)}%</td>
        </tr>
        <tr>
          <td>🟢 Input (cached)</td>
          <td>${formatTokens(request.cachedTokens)}</td>
          <td>${formatUsd(request.cacheCost)}</td>
          <td>${pctOf(request.cacheCost, request.totalCost)}%</td>
        </tr>
        <tr>
          <td>🔴 Output</td>
          <td>${formatTokens(request.outputTokens)}</td>
          <td>${formatUsd(request.outputCost)}</td>
          <td>${pctOf(request.outputCost, request.totalCost)}%</td>
        </tr>
        <tr style="font-weight:bold">
          <td>Total</td>
          <td>${formatTokens(request.inputTokens + request.outputTokens)}</td>
          <td>${formatUsd(request.totalCost)}</td>
          <td>100%</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h3>Context</h3>
    <div class="insight">
      <strong>${pctOfSession}%</strong> of session cost (${formatUsd(session.totalCost)} total)
      ${request.debugName ? `<br>Purpose: <strong>${escapeHtml(request.debugName)}</strong>` : ""}
      <br>Duration: <strong>${formatDuration(request.duration)}</strong>
    </div>
  </div>

  <div class="section">
    <h3>Cache Impact</h3>
    <div class="insight">
      Cache hit rate: <strong>${cacheRate}%</strong><br>
      ${
        savings > 0
          ? `Cache saved you <span class="savings">${formatUsd(savings)}</span> on this request.`
          : "No cache savings on this request."
      }
      <br><small>Without caching, this call would have cost ~${formatUsd(hypotheticalNoCacheCost)}</small>
    </div>
  </div>

  <div class="section">
    <h3>Perspective</h3>
    <div class="insight">
      ${getCostPerspective(request.totalCost)}
    </div>
  </div>
</body>
</html>`;
}

function renderBar(request: RequestCost): string {
  const total = request.inputCost + request.cacheCost + request.outputCost;
  if (total === 0) {
    return '<div class="bar-segment bar-input" style="width:100%">—</div>';
  }
  const inputPct = ((request.inputCost / total) * 100).toFixed(0);
  const cachePct = ((request.cacheCost / total) * 100).toFixed(0);
  const outputPct = ((request.outputCost / total) * 100).toFixed(0);
  return `
    <div class="bar-segment bar-input" style="width:${inputPct}%">${Number(inputPct) > 10 ? inputPct + "%" : ""}</div>
    <div class="bar-segment bar-cached" style="width:${cachePct}%">${Number(cachePct) > 10 ? cachePct + "%" : ""}</div>
    <div class="bar-segment bar-output" style="width:${outputPct}%">${Number(outputPct) > 10 ? outputPct + "%" : ""}</div>
  `;
}

function pctOf(part: number, total: number): string {
  if (total === 0) {
    return "0";
  }
  return ((part / total) * 100).toFixed(0);
}

function getCostCssColor(usd: number): string {
  if (usd >= COST_THRESHOLD_HIGH) {
    return "var(--red)";
  }
  if (usd >= COST_THRESHOLD_MEDIUM) {
    return "var(--orange)";
  }
  if (usd >= COST_THRESHOLD_LOW) {
    return "var(--yellow)";
  }
  return "var(--green)";
}

function getCostPerspective(usd: number): string {
  // Relatable comparisons to drive home the cost
  const perHour = usd * 60; // if you made 1 request/minute
  const perDay8h = perHour * 8;
  const perMonth = perDay8h * 22;

  const lines: string[] = [];
  lines.push(`At this rate per request:`);
  lines.push(
    `<br>• 1 request/min for 1 hour = <strong>${formatUsd(perHour)}</strong>`,
  );
  lines.push(
    `<br>• 1 request/min for a workday = <strong>${formatUsd(perDay8h)}</strong>`,
  );
  lines.push(
    `<br>• 1 request/min for a month = <strong>${formatUsd(perMonth)}</strong>`,
  );

  if (usd >= 0.01) {
    const coffees = Math.floor(1 / (usd * 100)); // how many requests per $1
    lines.push(
      `<br><br>☕ <strong>${coffees}</strong> requests like this = $1 (a coffee)`,
    );
  }

  return lines.join("");
}

function getModelInputPrice(model: string): number {
  return APPROX_INPUT_PRICE_USD_PER_M[model] ?? APPROX_INPUT_PRICE_DEFAULT;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
