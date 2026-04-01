import path from "node:path";

import type { PolicyContext, PolicyDecision } from "../shared/types.js";
import type { PolicyEngine } from "./engine.js";

const DESTRUCTIVE_COMMANDS = new Set(["rm", "mv", "chmod", "chown"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "nc", "scp", "ssh"]);

export class DefaultPolicyEngine implements PolicyEngine {
  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    const violations: string[] = [];
    const normalizedCwd = path.resolve(context.cwd);

    const insideWritableRoot = context.writableRoots.some((root) => {
      const normalizedRoot = path.resolve(root);
      return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}${path.sep}`);
    });

    if (!insideWritableRoot) {
      violations.push("cwd_outside_writable_roots");
      return {
        decision: "deny",
        reason: "Current working directory is outside writable roots.",
        violations
      };
    }

    if (context.requestNetwork || NETWORK_COMMANDS.has(context.command)) {
      return {
        decision: "require_approval",
        reason: "Network-capable command requires explicit approval.",
        violations
      };
    }

    if (DESTRUCTIVE_COMMANDS.has(context.command)) {
      return {
        decision: "require_approval",
        reason: "Potentially destructive command requires approval.",
        violations
      };
    }

    return {
      decision: "allow",
      reason: "Command is allowed by the default policy.",
      violations
    };
  }
}
