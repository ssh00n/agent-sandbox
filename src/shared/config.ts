import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  defaultSandboxMode: "workspace_write";
  writableRoots: string[];
  auditLogDir: string;
  allowUnsandboxedFallback: boolean;
  runnerKind: "macos" | "docker";
  dockerImage: string;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: parseInteger(process.env.PORT, 4000),
    defaultSandboxMode: "workspace_write",
    writableRoots: [cwd],
    auditLogDir: path.join(cwd, ".runs"),
    allowUnsandboxedFallback: process.env.ALLOW_UNSANDBOXED_FALLBACK === "1",
    runnerKind: process.env.RUNNER_KIND === "docker" ? "docker" : "macos",
    dockerImage: process.env.DOCKER_IMAGE ?? "alpine:3.20"
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
