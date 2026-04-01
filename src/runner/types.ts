import type { RunCommandRequest, RunEventType, RunResult } from "../shared/types.js";

export interface RunnerHooks {
  onEvent?: (type: RunEventType, data: Record<string, unknown>) => Promise<void>;
}

export interface SandboxRunner {
  run(runId: string, request: RunCommandRequest, hooks?: RunnerHooks): Promise<RunResult>;
}
