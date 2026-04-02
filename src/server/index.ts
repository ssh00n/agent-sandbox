import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { FileAuditStore } from "../audit/file-audit-store.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { DefaultPolicyEngine } from "../policy/default-policy-engine.js";
import { DockerSandboxRunner } from "../runner/docker/docker-sandbox-runner.js";
import { LinuxCapabilityProbe } from "../runner/linux/capability-probe.js";
import { LinuxSandboxRunner } from "../runner/linux/linux-sandbox-runner.js";
import { MacosSandboxRunner } from "../runner/macos/macos-sandbox-runner.js";
import { loadConfig } from "../shared/config.js";
import type { CommandSpec, RunCommandRequest } from "../shared/types.js";

const config = loadConfig();
const auditStore = new FileAuditStore(config.auditLogDir);
const linuxCapabilityProbe = new LinuxCapabilityProbe();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return respondJson(response, 200, {
        name: "codex-sandbox-orchestrator",
        status: "ok",
        defaultSandboxMode: config.defaultSandboxMode,
        writableRoots: config.writableRoots,
        runnerKind: config.runnerKind,
        dockerImage: config.dockerImage
      });
    }

    if (request.method === "GET" && request.url === "/approvals") {
      const approvals = await auditStore.listPendingApprovals();
      return respondJson(response, 200, { approvals });
    }

    if (request.method === "GET" && request.url === "/runtime/linux/capabilities") {
      const capabilities = await linuxCapabilityProbe.probe();
      return respondJson(response, 200, { capabilities });
    }

    if (request.method === "GET" && request.url === "/runs") {
      const runs = await auditStore.listRuns();
      return respondJson(response, 200, { runs });
    }

    if (request.method === "GET" && request.url) {
      const runEventsMatch = request.url.match(/^\/runs\/([^/]+)\/events$/);
      if (runEventsMatch) {
        const [, runId] = runEventsMatch;
        const events = await auditStore.getEvents(runId);
        return respondJson(response, 200, { runId, events });
      }

      const runMatch = request.url.match(/^\/runs\/([^/]+)$/);
      if (runMatch) {
        const [, runId] = runMatch;
        const record = await auditStore.getRecord(runId);

        if (!record) {
          return respondJson(response, 404, { error: `Run ${runId} not found.` });
        }

        return respondJson(response, 200, record);
      }
    }

    if (request.method === "POST" && request.url === "/runs") {
      const body = await readJsonBody(request);
      const validatedRequest = validateRunCommandRequest(body);
      const mergedRequest: RunCommandRequest = {
        ...validatedRequest,
        sandboxMode: validatedRequest.sandboxMode ?? config.defaultSandboxMode,
        runner: validatedRequest.runner ?? config.runnerKind,
        containerImage: validatedRequest.containerImage ?? config.dockerImage,
        writableRoots:
          validatedRequest.writableRoots.length > 0
            ? validatedRequest.writableRoots
            : config.writableRoots
      };

      const orchestrator = new Orchestrator(
        new DefaultPolicyEngine(),
        createRunner(mergedRequest),
        auditStore
      );
      const record = await orchestrator.run(mergedRequest);
      return respondJson(response, 200, record);
    }

    if (request.method === "POST" && request.url) {
      const approvalMatch = request.url.match(/^\/approvals\/([^/]+)\/(approve|deny)$/);
      if (approvalMatch) {
        const [, runId, action] = approvalMatch;
        const record = await auditStore.getRecord(runId);

        if (!record) {
          return respondJson(response, 404, { error: `Run ${runId} not found.` });
        }

        const orchestrator = new Orchestrator(
          new DefaultPolicyEngine(),
          createRunner(record.request),
          auditStore
        );

        const updatedRecord =
          action === "approve"
            ? await orchestrator.approve(runId)
            : await orchestrator.deny(runId);

        return respondJson(response, 200, updatedRecord);
      }
    }

    return respondJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return respondJson(response, 400, { error: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(
    `Sandbox orchestrator listening on http://${config.host}:${config.port}`
  );
});

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk.toString();
    });

    request.on("end", () => {
      try {
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

function validateRunCommandRequest(value: unknown): RunCommandRequest {
  if (!isRecord(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  const command = requireString(value.command, "command");
  const args = requireStringArray(value.args, "args");
  const cwd = requireString(value.cwd, "cwd");
  const sandboxMode = parseSandboxMode(value.sandboxMode);
  const writableRoots = optionalStringArray(value.writableRoots);
  const env = optionalStringRecord(value.env);
  const timeoutMs = optionalNumber(value.timeoutMs, "timeoutMs");
  const requestNetwork = optionalBoolean(value.requestNetwork, "requestNetwork");
  const runner = optionalRunner(value.runner);
  const linuxBackend = optionalLinuxBackend(value.linuxBackend);
  const containerImage = optionalString(value.containerImage, "containerImage");
  const setupCommands = optionalCommandSpecArray(value.setupCommands, "setupCommands");

  return {
    command,
    args,
    cwd,
    sandboxMode,
    writableRoots,
    env,
    timeoutMs,
    requestNetwork,
    runner,
    linuxBackend,
    containerImage,
    setupCommands
  };
}

function parseSandboxMode(value: unknown): RunCommandRequest["sandboxMode"] {
  if (
    value === "read_only" ||
    value === "workspace_write" ||
    value === "danger_full_access"
  ) {
    return value;
  }

  if (value === undefined) {
    return config.defaultSandboxMode;
  }

  throw new Error("sandboxMode must be one of read_only, workspace_write, danger_full_access.");
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function optionalStringArray(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("writableRoots must be an array of strings when provided.");
  }

  return value;
}

function optionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("env must be an object of string values.");
  }

  const entries = Object.entries(value);
  if (!entries.every(([, entryValue]) => typeof entryValue === "string")) {
    throw new Error("env must contain only string values.");
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string when provided.`);
  }

  return value;
}

function optionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }

  return value;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function optionalRunner(value: unknown): "macos" | "docker" | "linux" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "macos" || value === "docker" || value === "linux") {
    return value;
  }

  throw new Error("runner must be one of macos, linux, or docker.");
}

function optionalLinuxBackend(
  value: unknown
):
  | "auto"
  | "native_strict"
  | "container_rootless"
  | "container_rootful"
  | "native_lsm"
  | "fallback"
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "auto" ||
    value === "native_strict" ||
    value === "container_rootless" ||
    value === "container_rootful" ||
    value === "native_lsm" ||
    value === "fallback"
  ) {
    return value;
  }

  throw new Error(
    "linuxBackend must be one of auto, native_strict, container_rootless, container_rootful, native_lsm, fallback."
  );
}

function optionalCommandSpecArray(
  value: unknown,
  fieldName: string
): CommandSpec[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value.map((entry, index) => validateCommandSpec(entry, `${fieldName}[${index}]`));
}

function validateCommandSpec(value: unknown, fieldName: string): CommandSpec {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return {
    command: requireString(value.command, `${fieldName}.command`),
    args: requireStringArray(value.args, `${fieldName}.args`)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function createRunner(request: RunCommandRequest) {
  if (request.runner === "docker") {
    return new DockerSandboxRunner({ defaultImage: config.dockerImage });
  }

  if (request.runner === "linux") {
    return new LinuxSandboxRunner({
      allowUnsandboxedFallback: config.allowUnsandboxedFallback,
      containerRunner: new DockerSandboxRunner({ defaultImage: config.dockerImage })
    });
  }

  return new MacosSandboxRunner(config.allowUnsandboxedFallback);
}
