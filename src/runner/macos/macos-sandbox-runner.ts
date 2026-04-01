import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { RunCommandRequest, RunResult } from "../../shared/types.js";
import type { RunnerHooks, SandboxRunner } from "../types.js";

export class MacosSandboxRunner implements SandboxRunner {
  constructor(private readonly allowUnsandboxedFallback = false) {}

  async run(
    runId: string,
    request: RunCommandRequest,
    _hooks?: RunnerHooks
  ): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const profileDir = await mkdtemp(path.join(os.tmpdir(), "codex-sandbox-"));
    const profilePath = path.join(profileDir, "profile.sb");

    try {
      await writeFile(profilePath, buildProfile(request));

      const sandboxed = await executeProcess(
        "/usr/bin/sandbox-exec",
        ["-f", profilePath, request.command, ...request.args],
        request
      );

      const shouldFallback =
        this.allowUnsandboxedFallback &&
        sandboxed.exitCode === 71 &&
        sandboxed.stderr.includes("sandbox_apply: Operation not permitted");

      if (shouldFallback) {
        const direct = await executeProcess(request.command, request.args, request);
        return {
          runId,
          status: direct.exitCode === 0 ? "completed" : "failed",
          exitCode: direct.exitCode,
          stdout: direct.stdout,
          stderr: [
            "[development-fallback] sandbox-exec could not be applied in the current environment.",
            direct.stderr
          ]
            .filter((value) => value.length > 0)
            .join("\n"),
          startedAt,
          finishedAt: new Date().toISOString()
        };
      }

      return {
        runId,
        status: sandboxed.exitCode === 0 ? "completed" : "failed",
        exitCode: sandboxed.exitCode,
        stdout: sandboxed.stdout,
        stderr: sandboxed.stderr,
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        runId,
        status: "failed",
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown runner error.",
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  }
}

async function executeProcess(
  command: string,
  args: string[],
  request: RunCommandRequest
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, args, {
    cwd: request.cwd,
    env: request.env ?? process.env
  });

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await waitForChild(child, request.timeoutMs);
  return { exitCode, stdout, stderr };
}

function waitForChild(
  child: ReturnType<typeof spawn>,
  timeoutMs?: number
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill("SIGKILL");
        resolve(null);
      }, timeoutMs);
    }

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (!settled) {
        settled = true;
        resolve(code);
      }
    });
  });
}

function buildProfile(request: RunCommandRequest): string {
  const readablePaths = new Set<string>([
    "/bin",
    "/dev",
    "/private/tmp",
    "/System",
    "/tmp",
    "/usr",
    request.cwd,
    ...request.writableRoots
  ]);

  const writablePaths =
    request.sandboxMode === "workspace_write" || request.sandboxMode === "danger_full_access"
      ? new Set<string>([request.cwd, ...request.writableRoots, "/private/tmp", "/tmp"])
      : new Set<string>();

  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read-metadata)",
    ...Array.from(readablePaths).sort().map((value) => allowSubpath("file-read*", value))
  ];

  if (writablePaths.size > 0) {
    lines.push(
      ...Array.from(writablePaths)
        .sort()
        .map((value) => allowSubpath("file-write*", value))
    );
  }

  return `${lines.join("\n")}\n`;
}

function allowSubpath(permission: string, targetPath: string): string {
  const normalized = escapeSandboxString(path.resolve(targetPath));
  return `(allow ${permission} (subpath "${normalized}"))`;
}

function escapeSandboxString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
