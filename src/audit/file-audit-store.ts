import path from "node:path";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import type { AuditStore } from "./store.js";
import type {
  ApprovalSummary,
  RunEvent,
  RunRecord,
  RunSummary
} from "../shared/types.js";

export class FileAuditStore implements AuditStore {
  constructor(private readonly baseDir = path.join(process.cwd(), ".runs")) {}

  async appendEvent(event: RunEvent): Promise<void> {
    await this.ensureBaseDir();
    const sanitizedEvent = sanitizeEvent(event);
    await appendFile(
      path.join(this.baseDir, "events.jsonl"),
      `${JSON.stringify(sanitizedEvent)}\n`
    );
  }

  async saveRecord(record: RunRecord): Promise<void> {
    await this.ensureBaseDir();
    const sanitizedRecord = sanitizeRecord(record);

    const line = JSON.stringify(sanitizedRecord);
    const serialized = JSON.stringify(sanitizedRecord, null, 2);
    const recordPath = path.join(
      this.baseDir,
      `${sanitizedRecord.result?.runId ?? sanitizedRecord.runId ?? `run_${Date.now()}`}.json`
    );

    await appendFile(path.join(this.baseDir, "records.jsonl"), `${line}\n`);
    await writeFile(recordPath, `${serialized}\n`);
  }

  async getRecord(runId: string): Promise<RunRecord | null> {
    await this.ensureBaseDir();

    try {
      const contents = await readFile(path.join(this.baseDir, `${runId}.json`), "utf-8");
      return JSON.parse(contents) as RunRecord;
    } catch {
      return null;
    }
  }

  async getEvents(runId: string): Promise<RunEvent[]> {
    await this.ensureBaseDir();

    try {
      const contents = await readFile(path.join(this.baseDir, "events.jsonl"), "utf-8");
      return contents
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as RunEvent)
        .filter((event) => event.runId === runId);
    } catch {
      return [];
    }
  }

  async listRuns(): Promise<RunSummary[]> {
    const records = await this.readRunRecords();

    return records
      .filter((record): record is RunRecord & { runId: string } => typeof record.runId === "string")
      .map((record) => ({
        runId: record.runId,
        status: record.result?.status ?? "queued",
        command: record.request.command,
        args: record.request.args,
        cwd: record.request.cwd,
        runner: record.request.runner ?? "macos",
        requestedAt: record.result?.startedAt ?? null,
        finishedAt: record.result?.finishedAt ?? null
      }))
      .sort((left, right) => (left.requestedAt ?? "").localeCompare(right.requestedAt ?? ""));
  }

  async listPendingApprovals(): Promise<ApprovalSummary[]> {
    const records = await this.readRunRecords();
    const approvals: Array<ApprovalSummary | null> = records.map((record) => {
      if (record.result?.status !== "awaiting_approval" || !record.runId) {
        return null;
      }

      const summary: ApprovalSummary = {
        runId: record.runId,
        status: record.result.status,
        command: record.request.command,
        args: record.request.args,
        cwd: record.request.cwd,
        reason: record.policyDecision.reason,
        requestedAt: record.result.startedAt
      };

      return summary;
    });

    return approvals.filter((entry): entry is ApprovalSummary => entry !== null);
  }

  private async ensureBaseDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private async readRunRecords(): Promise<RunRecord[]> {
    await this.ensureBaseDir();

    const filenames = await readdir(this.baseDir);
    const runFiles = filenames.filter(
      (filename) => filename.startsWith("run_") && filename.endsWith(".json")
    );

    return Promise.all(
      runFiles.map(async (filename) => {
        const contents = await readFile(path.join(this.baseDir, filename), "utf-8");
        return JSON.parse(contents) as RunRecord;
      })
    );
  }
}

function sanitizeRecord(record: RunRecord): RunRecord {
  const replacements = buildSecretReplacements(record.request.env);
  return deepSanitize(record, replacements) as RunRecord;
}

function sanitizeEvent(event: RunEvent): RunEvent {
  let replacements: Array<[string, string]> = [];

  if (isRecord(event.data) && isRecord(event.data.__maskEnv)) {
    replacements = buildSecretReplacements(event.data.__maskEnv as Record<string, string>);
  } else if (isRecord(event.data) && isRecord(event.data.request)) {
    const env = event.data.request.env;
    if (isRecord(env)) {
      replacements = buildSecretReplacements(env as Record<string, string>);
    }
  }

  const sanitized = deepSanitize(event, replacements) as RunEvent;

  if (isRecord(sanitized.data) && "__maskEnv" in sanitized.data) {
    const { __maskEnv: _unused, ...rest } = sanitized.data;
    sanitized.data = rest;
  }

  return sanitized;
}

function buildSecretReplacements(
  env: Record<string, string> | undefined
): Array<[string, string]> {
  if (!env) {
    return [];
  }

  return Object.entries(env)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => [value, `$${key}`]);
}

function deepSanitize(value: unknown, replacements: Array<[string, string]>): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, replacements);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deepSanitize(entry, replacements));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepSanitize(entry, replacements)])
    );
  }

  return value;
}

function sanitizeString(value: string, replacements: Array<[string, string]>): string {
  let masked = value;

  for (const [secret, placeholder] of replacements) {
    masked = masked.split(secret).join(placeholder);
  }

  return masked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
