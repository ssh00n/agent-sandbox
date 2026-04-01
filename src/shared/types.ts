export type SandboxMode = "read_only" | "workspace_write" | "danger_full_access";

export type ApprovalDecision = "allow" | "deny" | "require_approval";
export type PolicyCategory =
  | "filesystem"
  | "network"
  | "destructive"
  | "environment"
  | "default";

export type RunStatus =
  | "queued"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type RunEventType =
  | "requested"
  | "policy_checked"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "setup_started"
  | "setup_completed"
  | "setup_failed"
  | "started"
  | "stdout"
  | "stderr"
  | "completed"
  | "failed"
  | "blocked";

export interface CommandSpec {
  command: string;
  args: string[];
}

export interface RunCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  sandboxMode: SandboxMode;
  writableRoots: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  requestNetwork?: boolean;
  runner?: "macos" | "docker";
  containerImage?: string;
  setupCommands?: CommandSpec[];
}

export interface PolicyContext {
  command: string;
  args: string[];
  cwd: string;
  sandboxMode: SandboxMode;
  writableRoots: string[];
  requestNetwork: boolean;
}

export interface PolicyDecision {
  decision: ApprovalDecision;
  code: string;
  category: PolicyCategory;
  reason: string;
  violations: string[];
}

export interface RunEvent {
  runId: string;
  type: RunEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface RunRecord {
  runId?: string;
  request: RunCommandRequest;
  policyDecision: PolicyDecision;
  result?: RunResult;
}

export interface ApprovalSummary {
  runId: string;
  status: RunStatus;
  command: string;
  args: string[];
  cwd: string;
  code?: string;
  category?: PolicyCategory;
  reason: string;
  requestedAt: string | null;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  command: string;
  args: string[];
  cwd: string;
  runner: "macos" | "docker";
  requestedAt: string | null;
  finishedAt: string | null;
}
