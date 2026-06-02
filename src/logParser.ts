import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface LlmRequestEntry {
  ts: number;
  dur: number;
  sid: string;
  type: "llm_request";
  name: string;
  spanId: string;
  parentSpanId?: string;
  status: string;
  attrs: {
    model: string;
    debugName?: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    ttft?: number;
    responseId?: string;
    userRequest?: string;
  };
}

export interface SessionInfo {
  sessionId: string;
  workspaceStorageId: string;
  logPath: string;
  startTime?: number;
  copilotVersion?: string;
  vscodeVersion?: string;
  userMessage?: string;
  llmRequests: LlmRequestEntry[];
}

export interface ModelPricing {
  id: string;
  name: string;
  inputPrice: number; // cents per million tokens
  outputPrice: number; // cents per million tokens
  cachePrice: number; // cents per million tokens
  batchSize: number; // usually 1_000_000
}

function getWorkspaceStoragePath(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "workspaceStorage",
      );
    case "win32":
      return path.join(
        process.env["APPDATA"] || "",
        "Code",
        "User",
        "workspaceStorage",
      );
    default: // linux
      return path.join(
        os.homedir(),
        ".config",
        "Code",
        "User",
        "workspaceStorage",
      );
  }
}

export function findAllDebugLogSessions(): string[] {
  const storagePath = getWorkspaceStoragePath();
  const sessions: string[] = [];

  if (!fs.existsSync(storagePath)) {
    return sessions;
  }

  const workspaces = fs.readdirSync(storagePath);
  for (const ws of workspaces) {
    const debugLogsDir = path.join(
      storagePath,
      ws,
      "GitHub.copilot-chat",
      "debug-logs",
    );
    if (!fs.existsSync(debugLogsDir)) {
      continue;
    }
    const sessionDirs = fs.readdirSync(debugLogsDir);
    for (const sessionDir of sessionDirs) {
      const mainJsonl = path.join(debugLogsDir, sessionDir, "main.jsonl");
      if (fs.existsSync(mainJsonl)) {
        sessions.push(mainJsonl);
      }
    }
  }

  return sessions;
}

export function parseSession(mainJsonlPath: string): SessionInfo {
  const sessionDir = path.dirname(mainJsonlPath);
  const sessionId = path.basename(sessionDir);
  const debugLogsDir = path.dirname(sessionDir);
  const workspaceStorageId = path.basename(
    path.dirname(path.dirname(debugLogsDir)),
  );

  const content = fs.readFileSync(mainJsonlPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const session: SessionInfo = {
    sessionId,
    workspaceStorageId,
    logPath: mainJsonlPath,
    llmRequests: [],
  };

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.type === "session_start") {
        session.startTime = entry.ts;
        session.copilotVersion = entry.attrs?.copilotVersion;
        session.vscodeVersion = entry.attrs?.vscodeVersion;
      } else if (entry.type === "user_message" && !session.userMessage) {
        session.userMessage = entry.attrs?.content?.substring(0, 100);
      } else if (entry.type === "llm_request") {
        session.llmRequests.push(entry as LlmRequestEntry);
      }
    } catch {
      // skip malformed lines
    }
  }

  return session;
}

export function loadModelPricing(
  mainJsonlPath: string,
): Map<string, ModelPricing> {
  const sessionDir = path.dirname(mainJsonlPath);
  const modelsPath = path.join(sessionDir, "models.json");
  const pricingMap = new Map<string, ModelPricing>();

  if (!fs.existsSync(modelsPath)) {
    return pricingMap;
  }

  try {
    const content = fs.readFileSync(modelsPath, "utf-8");
    const models = JSON.parse(content);

    for (const model of models) {
      const prices = model.billing?.token_prices?.default;
      if (prices) {
        pricingMap.set(model.id, {
          id: model.id,
          name: model.name || model.id,
          inputPrice: prices.input_price ?? 0,
          outputPrice: prices.output_price ?? 0,
          cachePrice: prices.cache_price ?? 0,
          batchSize: model.billing.token_prices.batch_size ?? 1_000_000,
        });
      }
    }
  } catch {
    // ignore parse errors
  }

  return pricingMap;
}
