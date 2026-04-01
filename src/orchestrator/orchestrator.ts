import type { AuditStore } from "../audit/store.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { SandboxRunner } from "../runner/types.js";
import type {
  PolicyContext,
  RunCommandRequest,
  RunEvent,
  RunRecord,
  RunResult
} from "../shared/types.js";

export class Orchestrator {
  constructor(
    private readonly policyEngine: PolicyEngine,
    private readonly runner: SandboxRunner,
    private readonly auditStore: AuditStore
  ) {}

  async run(request: RunCommandRequest): Promise<RunRecord> {
    const runId = createRunId();
    const requestedAt = new Date().toISOString();

    await this.auditStore.appendEvent(createEvent(runId, "requested", { request }));

    const context: PolicyContext = {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      sandboxMode: request.sandboxMode,
      writableRoots: request.writableRoots,
      requestNetwork: request.requestNetwork ?? false
    };

    const policyDecision = await this.policyEngine.evaluate(context);
    await this.auditStore.appendEvent(
      createEvent(runId, "policy_checked", { policyDecision })
    );

    if (policyDecision.decision !== "allow") {
      const blockedResult: RunResult = {
        runId,
        status: policyDecision.decision === "require_approval" ? "awaiting_approval" : "blocked",
        exitCode: null,
        stdout: "",
        stderr: policyDecision.reason,
        startedAt: requestedAt,
        finishedAt: new Date().toISOString()
      };

      const blockedEventType =
        policyDecision.decision === "require_approval" ? "approval_requested" : "blocked";

      await this.auditStore.appendEvent(
        createEvent(runId, blockedEventType, {
          decision: policyDecision.decision,
          reason: policyDecision.reason,
          violations: policyDecision.violations
        })
      );

      const blockedRecord: RunRecord = {
        runId,
        request,
        policyDecision,
        result: blockedResult
      };

      await this.auditStore.saveRecord(blockedRecord);
      return blockedRecord;
    }

    await this.auditStore.appendEvent(createEvent(runId, "started", { request }));

    const result = await this.runner.run(runId, request, {
      onEvent: async (type, data) => {
        await this.auditStore.appendEvent(
          createEvent(runId, type, {
            ...data,
            __maskEnv: request.env
          })
        );
      }
    });
    await this.auditStore.appendEvent(
      createEvent(runId, result.status === "completed" ? "completed" : "failed", {
        exitCode: result.exitCode,
        status: result.status
      })
    );

    const record: RunRecord = {
      runId,
      request,
      policyDecision,
      result
    };

    await this.auditStore.saveRecord(record);
    return record;
  }

  async approve(runId: string): Promise<RunRecord> {
    const record = await this.auditStore.getRecord(runId);
    if (!record || !record.runId) {
      throw new Error(`Run ${runId} was not found.`);
    }

    if (record.result?.status !== "awaiting_approval") {
      throw new Error(`Run ${runId} is not awaiting approval.`);
    }

    await this.auditStore.appendEvent(
      createEvent(runId, "approval_granted", {
        decision: "allow_after_approval"
      })
    );
    await this.auditStore.appendEvent(createEvent(runId, "started", { request: record.request }));

    const result = await this.runner.run(runId, record.request, {
      onEvent: async (type, data) => {
        await this.auditStore.appendEvent(
          createEvent(runId, type, {
            ...data,
            __maskEnv: record.request.env
          })
        );
      }
    });
    await this.auditStore.appendEvent(
      createEvent(runId, result.status === "completed" ? "completed" : "failed", {
        exitCode: result.exitCode,
        status: result.status
      })
    );

    const updatedRecord: RunRecord = {
      ...record,
      result
    };

    await this.auditStore.saveRecord(updatedRecord);
    return updatedRecord;
  }

  async deny(runId: string): Promise<RunRecord> {
    const record = await this.auditStore.getRecord(runId);
    if (!record || !record.runId) {
      throw new Error(`Run ${runId} was not found.`);
    }

    if (record.result?.status !== "awaiting_approval") {
      throw new Error(`Run ${runId} is not awaiting approval.`);
    }

    const deniedRecord: RunRecord = {
      ...record,
      result: {
        runId,
        status: "blocked",
        exitCode: null,
        stdout: "",
        stderr: "Execution denied by approval API.",
        startedAt: record.result.startedAt,
        finishedAt: new Date().toISOString()
      }
    };

    await this.auditStore.appendEvent(
      createEvent(runId, "approval_denied", {
        decision: "deny_after_approval_request"
      })
    );
    await this.auditStore.appendEvent(
      createEvent(runId, "blocked", {
        reason: "Execution denied by approval API."
      })
    );

    await this.auditStore.saveRecord(deniedRecord);
    return deniedRecord;
  }
}

function createRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEvent(
  runId: string,
  type: RunEvent["type"],
  data: Record<string, unknown>
): RunEvent {
  return {
    runId,
    type,
    timestamp: new Date().toISOString(),
    data
  };
}
