import type {
  RunCommandRequest,
  RunEventType,
  RunResult,
  RuntimeSelection
} from "../shared/types.js";

export interface RunnerHooks {
  onEvent?: (type: RunEventType, data: Record<string, unknown>) => Promise<void>;
}

export interface RunnerExecution {
  result: RunResult;
  runtimeSelection?: RuntimeSelection;
}

export interface SandboxRunner {
  run(runId: string, request: RunCommandRequest, hooks?: RunnerHooks): Promise<RunnerExecution>;
}
