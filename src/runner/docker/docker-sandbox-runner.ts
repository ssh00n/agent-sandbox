import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import type {
  CommandSpec,
  RunCommandRequest,
  RunResult
} from "../../shared/types.js";
import type { RunnerHooks, SandboxRunner } from "../types.js";

interface DockerSandboxRunnerOptions {
  defaultImage?: string;
}

export class DockerSandboxRunner implements SandboxRunner {
  private readonly defaultImage: string;

  constructor(options: DockerSandboxRunnerOptions = {}) {
    this.defaultImage = options.defaultImage ?? "alpine:3.20";
  }

  async run(
    runId: string,
    request: RunCommandRequest,
    hooks?: RunnerHooks
  ): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const workspaceDir = request.cwd;
    const image = request.containerImage ?? this.defaultImage;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-docker-runner-"));
    const setupScriptPath = path.join(tempDir, "setup.sh");
    const agentScriptPath = path.join(tempDir, "agent.sh");

    try {
      if (request.setupCommands && request.setupCommands.length > 0) {
        await hooks?.onEvent?.("setup_started", {
          image,
          commandCount: request.setupCommands.length,
          networkMode: "bridge"
        });

        await writeFile(setupScriptPath, buildScript(request.setupCommands));
        const setupResult = await runDockerContainer({
          image,
          workspaceDir,
          scriptPath: setupScriptPath,
          containerScriptPath: "/codex/setup.sh",
          networkMode: "bridge",
          env: request.env,
          timeoutMs: request.timeoutMs
        });

        if (setupResult.exitCode !== 0) {
          await hooks?.onEvent?.("setup_failed", {
            image,
            exitCode: setupResult.exitCode,
            stderrPreview: previewOutput(setupResult.stderr)
          });

          return {
            runId,
            status: "failed",
            exitCode: setupResult.exitCode,
            stdout: prefixOutput("setup", setupResult.stdout),
            stderr: prefixOutput("setup", setupResult.stderr),
            startedAt,
            finishedAt: new Date().toISOString()
          };
        }

        await hooks?.onEvent?.("setup_completed", {
          image,
          exitCode: setupResult.exitCode,
          stdoutPreview: previewOutput(setupResult.stdout)
        });
      }

      await writeFile(
        agentScriptPath,
        buildScript([{ command: request.command, args: request.args }])
      );

      const agentEnv = sanitizeEnvForAgent(request.env);
      const agentNetworkMode =
        request.sandboxMode === "danger_full_access" && request.requestNetwork ? "bridge" : "none";

      const agentResult = await runDockerContainer({
        image,
        workspaceDir,
        scriptPath: agentScriptPath,
        containerScriptPath: "/codex/agent.sh",
        networkMode: agentNetworkMode,
        env: agentEnv,
        timeoutMs: request.timeoutMs
      });

      return {
        runId,
        status: agentResult.exitCode === 0 ? "completed" : "failed",
        exitCode: agentResult.exitCode,
        stdout: prefixOutput("agent", agentResult.stdout),
        stderr: prefixOutput("agent", agentResult.stderr),
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        runId,
        status: "failed",
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown Docker runner error.",
        startedAt,
        finishedAt: new Date().toISOString()
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

interface DockerRunOptions {
  image: string;
  workspaceDir: string;
  scriptPath: string;
  containerScriptPath: string;
  networkMode: "bridge" | "none";
  env?: Record<string, string>;
  timeoutMs?: number;
}

async function runDockerContainer(
  options: DockerRunOptions
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const args = [
    "run",
    "--rm",
    "--workdir",
    "/workspace",
    "--mount",
    `type=bind,src=${options.workspaceDir},dst=/workspace`,
    "--mount",
    `type=bind,src=${options.scriptPath},dst=${options.containerScriptPath},readonly`,
    "--network",
    options.networkMode
  ];

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  args.push(options.image, "/bin/sh", options.containerScriptPath);

  return executeProcess("docker", args, options.timeoutMs);
}

async function executeProcess(
  command: string,
  args: string[],
  timeoutMs?: number
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, args);

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await waitForChild(child, timeoutMs);
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

function buildScript(commands: CommandSpec[]): string {
  const lines = ["#!/bin/sh", "set -eu"];

  for (const command of commands) {
    lines.push(toShellLine(command));
  }

  lines.push("");
  return lines.join("\n");
}

function toShellLine(command: CommandSpec): string {
  const parts = [command.command, ...command.args].map(shellEscape);
  return parts.join(" ");
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function sanitizeEnvForAgent(
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.fromEntries(
    Object.keys(env).map((key) => [key, `$${key}`])
  );
}

function prefixOutput(prefix: string, value: string): string {
  if (value.length === 0) {
    return "";
  }

  return value
    .split("\n")
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ""))
    .map((line) => `[${prefix}] ${line}`)
    .join("\n");
}

function previewOutput(value: string, maxLength = 240): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}...`;
}
