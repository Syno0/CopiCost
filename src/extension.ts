import * as vscode from "vscode";
import {
  findAllDebugLogSessions,
  parseSession,
  loadModelPricing,
} from "./logParser";
import { computeSessionCost, SessionCost, RequestCost } from "./costCalculator";
import { SessionTreeProvider } from "./sessionTreeProvider";
import { createReportPanel } from "./reportPanel";
import { showRequestDetailPanel } from "./detailPanel";
import {
  MONTHLY_BUDGET_USD,
  STATUS_BAR_WARNING_PCT,
  STATUS_BAR_CRITICAL_PCT,
} from "./config";

let sessionCosts: SessionCost[] = [];
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50,
  );
  statusBarItem.command = "copicost.showReport";
  statusBarItem.tooltip = "CopiCost — Click for full report";
  context.subscriptions.push(statusBarItem);

  // Tree view
  const treeProvider = new SessionTreeProvider();
  vscode.window.registerTreeDataProvider("copicost.sessions", treeProvider);

  // Commands
  const refreshCommand = vscode.commands.registerCommand(
    "copicost.refresh",
    () => {
      sessionCosts = loadAllSessions();
      treeProvider.refresh(sessionCosts);
      updateStatusBar();
    },
  );

  const reportCommand = vscode.commands.registerCommand(
    "copicost.showReport",
    () => {
      if (sessionCosts.length === 0) {
        sessionCosts = loadAllSessions();
      }
      createReportPanel(context, sessionCosts);
    },
  );

  const detailCommand = vscode.commands.registerCommand(
    "copicost.showRequestDetail",
    (request: RequestCost, index: number, session: SessionCost) => {
      showRequestDetailPanel(context, request, index, session);
    },
  );

  context.subscriptions.push(refreshCommand, reportCommand, detailCommand);

  // Auto-load on activation
  sessionCosts = loadAllSessions();
  treeProvider.refresh(sessionCosts);
  updateStatusBar();
}

function updateStatusBar(): void {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Only count current month's cost
  const monthCost = sessionCosts
    .filter((s) => (s.startTime ?? 0) >= monthStart)
    .reduce((sum, s) => sum + s.totalCost, 0);

  const pct = Math.min((monthCost / MONTHLY_BUDGET_USD) * 100, 100);
  const pctStr = pct < 1 ? pct.toFixed(2) : pct.toFixed(1);

  let icon = "$(pulse)";
  if (pct >= STATUS_BAR_CRITICAL_PCT) {
    icon = "$(flame)";
  } else if (pct >= STATUS_BAR_WARNING_PCT) {
    icon = "$(warning)";
  }

  statusBarItem.text = `${icon} $${monthCost.toFixed(3)} · ${pctStr}% of $${MONTHLY_BUDGET_USD}/mo`;
  statusBarItem.tooltip = `CopiCost: $${monthCost.toFixed(4)} spent this month\n${pctStr}% of $${MONTHLY_BUDGET_USD} monthly budget\nClick for full report`;
  statusBarItem.backgroundColor =
    pct >= STATUS_BAR_CRITICAL_PCT
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  statusBarItem.show();
}

function loadAllSessions(): SessionCost[] {
  const logPaths = findAllDebugLogSessions();
  const results: SessionCost[] = [];

  for (const logPath of logPaths) {
    try {
      const session = parseSession(logPath);
      if (session.llmRequests.length === 0) {
        continue;
      }
      const pricing = loadModelPricing(logPath);
      results.push(computeSessionCost(session, pricing));
    } catch {
      // skip unreadable sessions
    }
  }

  return results;
}

export function deactivate() {}
