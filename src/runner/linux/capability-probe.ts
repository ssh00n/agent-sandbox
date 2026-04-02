import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import type { LinuxRuntimeCapabilities } from "../../shared/types.js";

export class LinuxCapabilityProbe {
  async probe(): Promise<LinuxRuntimeCapabilities> {
    const [
      bwrapAvailable,
      unshareAvailable,
      podmanAvailable,
      dockerAvailable,
      podmanStatus,
      dockerStatus,
      setprivAvailable,
      apparmorRestrictsUserns,
      unprivilegedUsernsClone
    ] = await Promise.all([
      commandExists("bwrap"),
      commandExists("unshare"),
      commandExists("podman"),
      commandExists("docker"),
      commandStatus("podman info"),
      commandStatus("docker info"),
      commandExists("setpriv"),
      readBooleanFlag("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"),
      readBooleanFlag("/proc/sys/kernel/unprivileged_userns_clone")
    ]);
    const podmanUsable = podmanAvailable && podmanStatus.ok;
    const dockerUsable = dockerAvailable && dockerStatus.ok;
    const podmanFailureReason =
      podmanAvailable && !podmanUsable ? summarizeFailureReason(podmanStatus) : null;
    const dockerFailureReason =
      dockerAvailable && !dockerUsable ? summarizeFailureReason(dockerStatus) : null;

    const nativeStrictCandidate =
      process.platform === "linux" &&
      bwrapAvailable &&
      unshareAvailable &&
      apparmorRestrictsUserns !== true &&
      unprivilegedUsernsClone !== false;
    const nativeStrictBlockers = buildNativeStrictBlockers({
      platform: process.platform,
      bwrapAvailable,
      unshareAvailable,
      apparmorRestrictsUserns,
      unprivilegedUsernsClone,
      podmanAvailable,
      podmanUsable,
      podmanFailureReason,
      dockerAvailable,
      dockerUsable,
      dockerFailureReason
    });

    return {
      platform: process.platform,
      bwrapAvailable,
      unshareAvailable,
      podmanAvailable,
      podmanUsable,
      podmanFailureReason,
      dockerAvailable,
      dockerUsable,
      dockerFailureReason,
      setprivAvailable,
      apparmorRestrictsUserns,
      unprivilegedUsernsClone,
      nativeStrictCandidate,
      nativeStrictBlockers
    };
  }
}

function buildNativeStrictBlockers(input: {
  platform: string;
  bwrapAvailable: boolean;
  unshareAvailable: boolean;
  apparmorRestrictsUserns: boolean | null;
  unprivilegedUsernsClone: boolean | null;
  podmanAvailable: boolean;
  podmanUsable: boolean;
  podmanFailureReason: string | null;
  dockerAvailable: boolean;
  dockerUsable: boolean;
  dockerFailureReason: string | null;
}): string[] {
  const blockers: string[] = [];

  if (input.platform !== "linux") {
    blockers.push(`process.platform is ${input.platform}, not linux`);
  }

  if (!input.bwrapAvailable) {
    blockers.push("bwrap command is unavailable");
  }

  if (!input.unshareAvailable) {
    blockers.push("unshare command is unavailable");
  }

  if (input.apparmorRestrictsUserns === true) {
    blockers.push("AppArmor restricts unprivileged user namespaces");
  }

  if (input.unprivilegedUsernsClone === false) {
    blockers.push("kernel.unprivileged_userns_clone is disabled");
  }

  if (input.podmanAvailable && !input.podmanUsable && input.podmanFailureReason) {
    blockers.push(`podman unusable: ${input.podmanFailureReason}`);
  }

  if (input.dockerAvailable && !input.dockerUsable && input.dockerFailureReason) {
    blockers.push(`docker unusable: ${input.dockerFailureReason}`);
  }

  return blockers;
}

async function commandExists(command: string): Promise<boolean> {
  return (await commandStatus(`command -v ${shellEscape(command)}`)).ok;
}

async function commandStatus(command: string): Promise<{
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command]);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) =>
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: error.message
      })
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr
      })
    );
  });
}

async function readBooleanFlag(filePath: string): Promise<boolean | null> {
  try {
    const value = (await readFile(filePath, "utf-8")).trim();
    if (value === "1") {
      return true;
    }

    if (value === "0") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function summarizeFailureReason(status: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string {
  const message = firstNonEmptyLine(status.stderr) || firstNonEmptyLine(status.stdout);

  if (message.length > 0) {
    return message;
  }

  if (status.exitCode !== null) {
    return `exit code ${status.exitCode}`;
  }

  return "unknown runtime probe failure";
}

function firstNonEmptyLine(value: string): string {
  return value.split("\n").find((line) => line.trim().length > 0) ?? "";
}
