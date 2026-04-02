import path from "node:path";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { RunCommandRequest, RunResult, RuntimeSelection } from "../../shared/types.js";
import type { RunnerExecution, RunnerHooks, SandboxRunner } from "../types.js";
import { DockerSandboxRunner } from "../docker/docker-sandbox-runner.js";
import { LinuxCapabilityProbe } from "./capability-probe.js";
import { resolveLinuxRuntime } from "./runtime-resolver.js";

const DEFAULT_READ_ONLY_BINDS = [
  "/bin",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/sbin",
  "/usr"
];

interface LinuxSandboxRunnerOptions {
  allowUnsandboxedFallback?: boolean;
  containerRunner?: SandboxRunner;
  capabilityProbe?: LinuxCapabilityProbe;
}

export class LinuxSandboxRunner implements SandboxRunner {
  private readonly allowUnsandboxedFallback: boolean;
  private readonly containerRunner: SandboxRunner;
  private readonly capabilityProbe: LinuxCapabilityProbe;

  constructor(options: LinuxSandboxRunnerOptions | boolean = {}) {
    const normalizedOptions =
      typeof options === "boolean" ? { allowUnsandboxedFallback: options } : options;

    this.allowUnsandboxedFallback = normalizedOptions.allowUnsandboxedFallback ?? false;
    this.containerRunner = normalizedOptions.containerRunner ?? new DockerSandboxRunner();
    this.capabilityProbe = normalizedOptions.capabilityProbe ?? new LinuxCapabilityProbe();
  }

  async run(
    runId: string,
    request: RunCommandRequest,
    hooks?: RunnerHooks
  ): Promise<RunnerExecution> {
    const startedAt = new Date().toISOString();

    await hooks?.onEvent?.("runtime_probe_started", {
      platform: process.platform,
      requestedBackend: request.linuxBackend ?? "auto"
    });

    const capabilities = await this.capabilityProbe.probe();
    await hooks?.onEvent?.("runtime_probe_completed", {
      platform: capabilities.platform,
      capabilities
    });

    const runtimeSelection = resolveLinuxRuntime(request.linuxBackend, capabilities);
    await hooks?.onEvent?.("runtime_selected", runtimeSelectionToEvent(runtimeSelection));

    if (
      runtimeSelection.backend === "container_rootless" ||
      runtimeSelection.backend === "container_rootful"
    ) {
      const containerExecution = await this.containerRunner.run(
        runId,
        { ...request, runner: "docker" },
        hooks
      );

      return {
        ...containerExecution,
        runtimeSelection
      };
    }

    if (runtimeSelection.backend === "native_lsm") {
      await hooks?.onEvent?.("sandbox_fallback_used", {
        from: "native_lsm",
        to: "fallback",
        reason: "Linux native LSM backend is not implemented yet; using fallback execution.",
        developmentOnly: true
      });

      return {
        runtimeSelection,
        result: await runDirectly(
          runId,
          request,
          startedAt,
          "Linux native LSM backend is not implemented yet."
        )
      };
    }

    if (runtimeSelection.backend === "fallback") {
      await hooks?.onEvent?.("sandbox_fallback_used", {
        from: request.linuxBackend ?? "auto",
        to: "fallback",
        reason: runtimeSelection.reason,
        developmentOnly: true
      });

      return {
        runtimeSelection,
        result: await runDirectly(runId, request, startedAt, runtimeSelection.reason)
      };
    }

    return this.runNativeStrict(runId, request, startedAt, runtimeSelection, hooks);
  }

  private async runNativeStrict(
    runId: string,
    request: RunCommandRequest,
    startedAt: string,
    runtimeSelection: RuntimeSelection,
    hooks?: RunnerHooks
  ): Promise<RunnerExecution> {
    await hooks?.onEvent?.("sandbox_apply_started", {
      backend: runtimeSelection.backend,
      sandboxMode: request.sandboxMode,
      requestNetwork: request.requestNetwork ?? false
    });

    try {
      if (process.platform !== "linux") {
        return {
          runtimeSelection,
          result: await this.handleUnsupportedPlatform(runId, request, startedAt, hooks)
        };
      }

      const sandboxed = await executeProcess(
        "bwrap",
        await buildBubblewrapArgs(request),
        request
      );

      if (
        sandboxed.exitCode !== 0 &&
        this.allowUnsandboxedFallback &&
        containsFallbackMarker(sandboxed.stderr)
      ) {
        await hooks?.onEvent?.("sandbox_apply_failed", {
          backend: runtimeSelection.backend,
          stage: "namespace_setup",
          error: sandboxed.stderr
        });
        await hooks?.onEvent?.("sandbox_fallback_used", {
          from: runtimeSelection.backend,
          to: "fallback",
          reason: sandboxed.stderr,
          developmentOnly: true
        });

        return {
          runtimeSelection,
          result: await runDirectly(runId, request, startedAt, sandboxed.stderr)
        };
      }

      if (sandboxed.exitCode !== 0) {
        await hooks?.onEvent?.("sandbox_apply_failed", {
          backend: runtimeSelection.backend,
          stage: "namespace_setup",
          error: sandboxed.stderr
        });
      }

      return {
        runtimeSelection,
        result: {
          runId,
          status: sandboxed.exitCode === 0 ? "completed" : "failed",
          exitCode: sandboxed.exitCode,
          stdout: sandboxed.stdout,
          stderr: sandboxed.stderr,
          startedAt,
          finishedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Linux runner error.";
      await hooks?.onEvent?.("sandbox_apply_failed", {
        backend: runtimeSelection.backend,
        stage: "spawn",
        error: message
      });

      if (this.allowUnsandboxedFallback && shouldFallbackFromError(error)) {
        await hooks?.onEvent?.("sandbox_fallback_used", {
          from: runtimeSelection.backend,
          to: "fallback",
          reason: message,
          developmentOnly: true
        });

        return {
          runtimeSelection,
          result: await runDirectly(runId, request, startedAt, message)
        };
      }

      return {
        runtimeSelection,
        result: {
          runId,
          status: "failed",
          exitCode: null,
          stdout: "",
          stderr: message,
          startedAt,
          finishedAt: new Date().toISOString()
        }
      };
    }
  }

  private async handleUnsupportedPlatform(
    runId: string,
    request: RunCommandRequest,
    startedAt: string,
    hooks?: RunnerHooks
  ): Promise<RunResult> {
    const message = `Linux native runner requires process.platform=linux. Current platform is ${process.platform}.`;

    await hooks?.onEvent?.("sandbox_apply_failed", {
      backend: "native_strict",
      stage: "platform_check",
      error: message
    });

    if (this.allowUnsandboxedFallback) {
      await hooks?.onEvent?.("sandbox_fallback_used", {
        from: "native_strict",
        to: "fallback",
        reason: message,
        developmentOnly: true
      });
      return runDirectly(runId, request, startedAt, message);
    }

    return {
      runId,
      status: "failed",
      exitCode: null,
      stdout: "",
      stderr: message,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }
}

async function buildBubblewrapArgs(request: RunCommandRequest): Promise<string[]> {
  const args = ["--die-with-parent", "--new-session", "--unshare-all"];

  if (request.sandboxMode === "danger_full_access" && request.requestNetwork) {
    args.push("--share-net");
  }

  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");

  for (const targetPath of DEFAULT_READ_ONLY_BINDS) {
    if (await pathExists(targetPath)) {
      args.push("--ro-bind", targetPath, targetPath);
    }
  }

  const mountTargets = new Set<string>([
    path.resolve(request.cwd),
    ...request.writableRoots.map((targetPath) => path.resolve(targetPath))
  ]);

  const writable =
    request.sandboxMode === "workspace_write" || request.sandboxMode === "danger_full_access";

  for (const targetPath of Array.from(mountTargets).sort()) {
    if (!(await pathExists(targetPath))) {
      continue;
    }

    args.push(writable ? "--bind" : "--ro-bind", targetPath, targetPath);
  }

  args.push("--chdir", path.resolve(request.cwd), request.command, ...request.args);
  return args;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runDirectly(
  runId: string,
  request: RunCommandRequest,
  startedAt: string,
  fallbackReason: string
): Promise<RunResult> {
  const direct = await executeProcess(request.command, request.args, request);
  return {
    runId,
    status: direct.exitCode === 0 ? "completed" : "failed",
    exitCode: direct.exitCode,
    stdout: direct.stdout,
    stderr: [
      "[development-fallback] linux native sandbox could not be applied in the current environment.",
      fallbackReason,
      direct.stderr
    ]
      .filter((value) => value.length > 0)
      .join("\n"),
    startedAt,
    finishedAt: new Date().toISOString()
  };
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

function shouldFallbackFromError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (containsFallbackMarker(error.message) || getErrorCode(error) === "ENOENT")
  );
}

function containsFallbackMarker(value: string): boolean {
  return [
    "Operation not permitted",
    "No permissions to create new namespace",
    "creating new namespace",
    "setting up uid map",
    "No such file or directory",
    "Failed RTM_NEWADDR"
  ].some((marker) => value.includes(marker));
}

function getErrorCode(error: Error): string | undefined {
  return (error as Error & { code?: string }).code;
}

function runtimeSelectionToEvent(selection: RuntimeSelection): Record<string, unknown> {
  return {
    runner: selection.runner,
    backend: selection.backend,
    enforcementLevel: selection.enforcementLevel,
    reason: selection.reason,
    capabilities: selection.capabilities
  };
}
