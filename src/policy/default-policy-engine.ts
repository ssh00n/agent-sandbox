import path from "node:path";

import type { PolicyContext, PolicyDecision } from "../shared/types.js";
import type { PolicyEngine } from "./engine.js";

const DESTRUCTIVE_COMMANDS = new Set(["rm", "mv", "chmod", "chown"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "nc", "scp", "ssh"]);
const PACKAGE_MANAGER_COMMANDS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "cargo",
  "go"
]);

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
        code: "cwd_outside_writable_roots",
        category: "filesystem",
        intent: "external_path_access",
        reason: "Current working directory is outside writable roots.",
        violations
      };
    }

    if (context.requestNetwork || NETWORK_COMMANDS.has(context.command)) {
      return {
        decision: "require_approval",
        code: "network_capable_command",
        category: "network",
        intent: "network_access",
        reason: "Network-capable command requires explicit approval.",
        violations
      };
    }

    if (context.sandboxMode === "danger_full_access") {
      return {
        decision: "require_approval",
        code: "danger_full_access_requested",
        category: "environment",
        intent: "environment_escalation",
        reason: "Danger-full-access mode requires explicit approval.",
        violations
      };
    }

    if (isPackageInstallCommand(context.command, context.args)) {
      return {
        decision: "require_approval",
        code: "package_install_command",
        category: "environment",
        intent: "package_installation",
        reason: "Package installation requires explicit approval.",
        violations
      };
    }

    if (DESTRUCTIVE_COMMANDS.has(context.command)) {
      return {
        decision: "require_approval",
        code: "destructive_command",
        category: "destructive",
        intent: "destructive_change",
        reason: "Potentially destructive command requires approval.",
        violations
      };
    }

    if (hasAbsolutePathArgumentOutsideRoots(context.args, context.writableRoots)) {
      return {
        decision: "require_approval",
        code: "absolute_path_target_outside_writable_roots",
        category: "filesystem",
        intent: "external_path_access",
        reason: "Command targets an absolute path outside writable roots.",
        violations
      };
    }

    return {
      decision: "allow",
      code: "allowed_by_default_policy",
      category: "default",
      intent: "safe_read",
      reason: "Command is allowed by the default policy.",
      violations
    };
  }
}

function isPackageInstallCommand(command: string, args: string[]): boolean {
  if (!PACKAGE_MANAGER_COMMANDS.has(command)) {
    return false;
  }

  const joined = args.join(" ");
  return /\b(add|install|sync|fetch|get)\b/.test(joined);
}

function hasAbsolutePathArgumentOutsideRoots(
  args: string[],
  writableRoots: string[]
): boolean {
  const normalizedRoots = writableRoots.map((root) => path.resolve(root));

  return args.some((arg) => {
    if (!arg.startsWith("/")) {
      return false;
    }

    const normalizedArg = path.resolve(arg);
    return !normalizedRoots.some(
      (root) => normalizedArg === root || normalizedArg.startsWith(`${root}${path.sep}`)
    );
  });
}
