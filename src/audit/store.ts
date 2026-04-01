import type {
  ApprovalSummary,
  RunEvent,
  RunRecord,
  RunSummary
} from "../shared/types.js";

export interface AuditStore {
  appendEvent(event: RunEvent): Promise<void>;
  saveRecord(record: RunRecord): Promise<void>;
  getRecord(runId: string): Promise<RunRecord | null>;
  getEvents(runId: string): Promise<RunEvent[]>;
  listRuns(): Promise<RunSummary[]>;
  listPendingApprovals(): Promise<ApprovalSummary[]>;
}
