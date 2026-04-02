export type SandboxMode = "read_only" | "workspace_write" | "danger_full_access";
export type RunnerKind = "macos" | "docker" | "linux";
export type LinuxBackend =
  | "auto"
  | "native_strict"
  | "container_rootless"
  | "container_rootful"
  | "native_lsm"
  | "fallback";
export type RuntimeEnforcementLevel = "strict" | "container" | "partial" | "fallback";

export type ApprovalDecision = "allow" | "deny" | "require_approval";
export type PolicyCategory =
  | "filesystem"
  | "network"
  | "destructive"
  | "environment"
  | "default";
export type PolicySeverity = "low" | "medium" | "high";
export type PolicyIntent =
  | "safe_read"
  | "network_access"
  | "environment_escalation"
  | "package_installation"
  | "destructive_change"
  | "external_path_access";

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
  | "runtime_probe_started"
  | "runtime_probe_completed"
  | "runtime_selected"
  | "sandbox_apply_started"
  | "sandbox_apply_failed"
  | "sandbox_fallback_used"
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
  runner?: RunnerKind;
  linuxBackend?: LinuxBackend;
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
  severity: PolicySeverity;
  intent: PolicyIntent;
  summary: string;
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

export interface LinuxRuntimeCapabilities {
  platform: string;
  bwrapAvailable: boolean;
  unshareAvailable: boolean;
  podmanAvailable: boolean;
  podmanUsable: boolean;
  podmanFailureReason: string | null;
  dockerAvailable: boolean;
  dockerUsable: boolean;
  dockerFailureReason: string | null;
  setprivAvailable: boolean;
  apparmorRestrictsUserns: boolean | null;
  unprivilegedUsernsClone: boolean | null;
  nativeStrictCandidate: boolean;
  nativeStrictBlockers: string[];
}

export interface RuntimeSelection {
  runner: "linux";
  backend: LinuxBackend;
  enforcementLevel: RuntimeEnforcementLevel;
  reason: string;
  capabilities?: LinuxRuntimeCapabilities;
}

export interface RunRecord {
  runId?: string;
  request: RunCommandRequest;
  policyDecision: PolicyDecision;
  runtimeSelection?: RuntimeSelection;
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
  severity?: PolicySeverity;
  intent?: PolicyIntent;
  summary?: string;
  reason: string;
  requestedAt: string | null;
}

export interface RunSummary {
  runId: string;
  status: RunStatus;
  command: string;
  args: string[];
  cwd: string;
  runner: RunnerKind;
  runtimeBackend?: LinuxBackend;
  runtimeEnforcementLevel?: RuntimeEnforcementLevel;
  requestedAt: string | null;
  finishedAt: string | null;
}
