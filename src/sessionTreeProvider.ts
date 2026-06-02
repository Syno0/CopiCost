import * as vscode from "vscode";
import { SessionCost, RequestCost } from "./costCalculator";
import {
  COST_THRESHOLD_HIGH,
  COST_THRESHOLD_MEDIUM,
  COST_THRESHOLD_LOW,
  formatCurrency,
} from "./config";

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: SessionCost[] = [];

  refresh(sessions: SessionCost[]): void {
    this.sessions = sessions.sort(
      (a, b) => (b.startTime ?? 0) - (a.startTime ?? 0),
    );
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!element) {
      if (this.sessions.length === 0) {
        return [new EmptyItem()];
      }
      const items: TreeItem[] = [new SummaryItem(this.sessions)];
      items.push(...this.sessions.map((s) => new SessionTreeItem(s)));
      return items;
    }
    if (element instanceof SessionTreeItem) {
      return element.session.requests.map(
        (r, i) => new RequestTreeItem(r, i, element.session),
      );
    }
    return [];
  }
}

type TreeItem = SummaryItem | SessionTreeItem | RequestTreeItem | EmptyItem;

class EmptyItem extends vscode.TreeItem {
  constructor() {
    super("No debug log sessions found", vscode.TreeItemCollapsibleState.None);
    this.description = "Enable agentDebugLog.fileLogging.enabled in settings";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

class SummaryItem extends vscode.TreeItem {
  constructor(sessions: SessionCost[]) {
    const totalCost = sessions.reduce((sum, s) => sum + s.totalCost, 0);
    const totalRequests = sessions.reduce(
      (sum, s) => sum + s.requests.length,
      0,
    );

    super(
      `TOTAL: ${formatUsd(totalCost)}`,
      vscode.TreeItemCollapsibleState.None,
    );

    this.description = `${sessions.length} sessions · ${totalRequests} LLM calls`;
    this.iconPath = new vscode.ThemeIcon(
      "credit-card",
      new vscode.ThemeColor("charts.red"),
    );

    const totalInput = sessions.reduce((s, c) => s + c.totalInputTokens, 0);
    const totalOutput = sessions.reduce((s, c) => s + c.totalOutputTokens, 0);
    const totalCached = sessions.reduce((s, c) => s + c.totalCachedTokens, 0);
    const cacheRate =
      totalInput > 0 ? ((totalCached / totalInput) * 100).toFixed(0) : "0";

    this.tooltip = new vscode.MarkdownString(
      [
        `### 💰 Cost Summary`,
        ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Total Cost** | **${formatUsd(totalCost)}** |`,
        `| Sessions | ${sessions.length} |`,
        `| LLM Calls | ${totalRequests} |`,
        `| Input Tokens | ${formatTokens(totalInput)} |`,
        `| Output Tokens | ${formatTokens(totalOutput)} |`,
        `| Cache Hit Rate | ${cacheRate}% |`,
        `| Avg Cost/Session | ${formatUsd(totalCost / sessions.length)} |`,
        `| Avg Cost/Request | ${formatUsd(totalCost / totalRequests)} |`,
      ].join("\n"),
    );
    this.tooltip.supportHtml = true;

    this.command = {
      command: "copicost.showReport",
      title: "Show Full Report",
    };
  }
}

class SessionTreeItem extends vscode.TreeItem {
  constructor(public readonly session: SessionCost) {
    const cost = formatUsd(session.totalCost);
    super(cost, vscode.TreeItemCollapsibleState.Collapsed);

    const timeStr = session.startTime
      ? formatRelativeTime(session.startTime)
      : "unknown";
    const msg = session.userMessage
      ? ` · ${truncate(session.userMessage, 40)}`
      : "";
    this.description = `${timeStr} · ${session.requests.length} calls${msg}`;

    this.iconPath = new vscode.ThemeIcon(
      getCostIcon(session.totalCost),
      getCostColor(session.totalCost),
    );

    const cacheRate =
      session.totalInputTokens > 0
        ? (
            (session.totalCachedTokens / session.totalInputTokens) *
            100
          ).toFixed(0)
        : "0";

    this.tooltip = new vscode.MarkdownString(
      [
        `### 💬 Session`,
        ``,
        session.userMessage ? `> ${session.userMessage}` : "",
        ``,
        `| | |`,
        `|---|---|`,
        `| **Cost** | **${cost}** |`,
        `| LLM Calls | ${session.requests.length} |`,
        `| Input Tokens | ${formatTokens(session.totalInputTokens)} |`,
        `| Output Tokens | ${formatTokens(session.totalOutputTokens)} |`,
        `| Cached Tokens | ${formatTokens(session.totalCachedTokens)} (${cacheRate}%) |`,
        `| Duration | ${formatDuration(session.totalDuration)} |`,
        ``,
        `*${session.startTime ? new Date(session.startTime).toLocaleString() : ""}*`,
      ].join("\n"),
    );
    this.tooltip.supportHtml = true;

    this.contextValue = "session";
  }
}

class RequestTreeItem extends vscode.TreeItem {
  constructor(
    public readonly request: RequestCost,
    index: number,
    session: SessionCost,
  ) {
    const cost = formatUsd(request.totalCost);
    const pct =
      session.totalCost > 0
        ? ((request.totalCost / session.totalCost) * 100).toFixed(0)
        : "0";
    super(cost, vscode.TreeItemCollapsibleState.None);

    this.description = `${request.model} · ${request.debugName ?? `call #${index + 1}`} · ${pct}%`;

    this.iconPath = new vscode.ThemeIcon(
      getCostIcon(request.totalCost),
      getCostColor(request.totalCost),
    );

    const nonCached = request.inputTokens - request.cachedTokens;
    const ttft = request.ttft ? `${(request.ttft / 1000).toFixed(1)}s` : "N/A";
    const cacheRate =
      request.inputTokens > 0
        ? ((request.cachedTokens / request.inputTokens) * 100).toFixed(0)
        : "0";

    this.tooltip = new vscode.MarkdownString(
      [
        `### 🔥 LLM Request #${index + 1}`,
        ``,
        `| | |`,
        `|---|---|`,
        `| **Total Cost** | **${cost}** |`,
        `| Model | \`${request.model}\` |`,
        `| Context | ${request.debugName ?? "N/A"} |`,
        ``,
        `#### Token Breakdown`,
        ``,
        `| Type | Tokens | Cost |`,
        `|------|--------|------|`,
        `| Input (fresh) | ${formatTokens(nonCached)} | ${formatUsd(request.inputCost)} |`,
        `| Input (cached) | ${formatTokens(request.cachedTokens)} | ${formatUsd(request.cacheCost)} |`,
        `| Output | ${formatTokens(request.outputTokens)} | ${formatUsd(request.outputCost)} |`,
        `| **Total** | **${formatTokens(request.inputTokens + request.outputTokens)}** | **${cost}** |`,
        ``,
        `#### Performance`,
        ``,
        `| | |`,
        `|---|---|`,
        `| Time to First Token | ${ttft} |`,
        `| Total Duration | ${formatDuration(request.duration)} |`,
        `| Cache Hit | ${cacheRate}% |`,
      ].join("\n"),
    );
    this.tooltip.supportHtml = true;

    this.command = {
      command: "copicost.showRequestDetail",
      title: "Show Request Detail",
      arguments: [request, index, session],
    };
  }
}

// --- Formatting helpers (exported for reuse) ---

export function formatUsd(usd: number): string {
  return formatCurrency(usd);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}min`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(ts).toLocaleDateString();
}

function getCostIcon(usd: number): string {
  if (usd >= COST_THRESHOLD_HIGH) {
    return "flame";
  }
  if (usd >= COST_THRESHOLD_MEDIUM) {
    return "warning";
  }
  if (usd >= COST_THRESHOLD_LOW) {
    return "circle-filled";
  }
  return "circle-outline";
}

function getCostColor(usd: number): vscode.ThemeColor {
  if (usd >= COST_THRESHOLD_HIGH) {
    return new vscode.ThemeColor("charts.red");
  }
  if (usd >= COST_THRESHOLD_MEDIUM) {
    return new vscode.ThemeColor("charts.orange");
  }
  if (usd >= COST_THRESHOLD_LOW) {
    return new vscode.ThemeColor("charts.yellow");
  }
  return new vscode.ThemeColor("charts.green");
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + "…" : str;
}
