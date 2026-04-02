import type {
  LinuxBackend,
  LinuxRuntimeCapabilities,
  RuntimeSelection
} from "../../shared/types.js";

export function resolveLinuxRuntime(
  requestedBackend: LinuxBackend | undefined,
  capabilities: LinuxRuntimeCapabilities
): RuntimeSelection {
  const backend = requestedBackend ?? "auto";

  if (backend === "auto" && capabilities.platform !== "linux") {
    return {
      runner: "linux",
      backend: "fallback",
      enforcementLevel: "fallback",
      reason: `Linux auto backend requires process.platform=linux. Current platform is ${capabilities.platform}.`,
      capabilities
    };
  }

  if (backend !== "auto") {
    return explicitSelection(backend, capabilities);
  }

  if (capabilities.nativeStrictCandidate) {
    return {
      runner: "linux",
      backend: "native_strict",
      enforcementLevel: "strict",
      reason: "bwrap and user namespace prerequisites look available on this host.",
      capabilities
    };
  }

  if (capabilities.podmanUsable) {
    return {
      runner: "linux",
      backend: "container_rootless",
      enforcementLevel: "container",
      reason: buildFallbackReason(
        capabilities.nativeStrictBlockers,
        "podman is usable on this host."
      ),
      capabilities
    };
  }

  if (capabilities.dockerUsable) {
    return {
      runner: "linux",
      backend: "container_rootful",
      enforcementLevel: "container",
      reason: buildFallbackReason(
        capabilities.nativeStrictBlockers,
        "docker is usable on this host."
      ),
      capabilities
    };
  }

  if (capabilities.setprivAvailable) {
    return {
      runner: "linux",
      backend: "native_lsm",
      enforcementLevel: "partial",
      reason: "container backends are unavailable; partial Linux hardening tools exist.",
      capabilities
    };
  }

  return {
    runner: "linux",
    backend: "fallback",
    enforcementLevel: "fallback",
    reason: buildFallbackReason(
      capabilities.nativeStrictBlockers,
      "strict native and usable container backends are unavailable on this host."
    ),
    capabilities
  };
}

function explicitSelection(
  backend: LinuxBackend,
  capabilities: LinuxRuntimeCapabilities
): RuntimeSelection {
  if (backend === "native_strict") {
    return {
      runner: "linux",
      backend,
      enforcementLevel: "strict",
      reason: "Linux native strict backend was explicitly requested.",
      capabilities
    };
  }

  if (backend === "container_rootless" || backend === "container_rootful") {
    return {
      runner: "linux",
      backend,
      enforcementLevel: "container",
      reason: `Linux ${backend} backend was explicitly requested.`,
      capabilities
    };
  }

  if (backend === "native_lsm") {
    return {
      runner: "linux",
      backend,
      enforcementLevel: "partial",
      reason: "Linux native LSM backend was explicitly requested.",
      capabilities
    };
  }

  return {
    runner: "linux",
    backend,
    enforcementLevel: "fallback",
    reason: "Linux fallback backend was explicitly requested.",
    capabilities
  };
}

function buildFallbackReason(blockers: string[], suffix: string): string {
  if (blockers.length === 0) {
    return suffix;
  }

  return `${blockers.slice(0, 3).join("; ")}; ${suffix}`;
}
