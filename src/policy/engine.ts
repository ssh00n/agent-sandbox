import type { PolicyContext, PolicyDecision } from "../shared/types.js";

export interface PolicyEngine {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}
