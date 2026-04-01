#!/usr/bin/env node

import { Orchestrator } from "../dist/orchestrator/orchestrator.js";
import { DefaultPolicyEngine } from "../dist/policy/default-policy-engine.js";
import { DockerSandboxRunner } from "../dist/runner/docker/docker-sandbox-runner.js";
import { MacosSandboxRunner } from "../dist/runner/macos/macos-sandbox-runner.js";
import { FileAuditStore } from "../dist/audit/file-audit-store.js";

const runnerKind = process.argv[2];

async function main() {
  if (runnerKind !== "macos" && runnerKind !== "docker") {
    throw new Error("Usage: node scripts/verify-runner.mjs <macos|docker>");
  }

  const results =
    runnerKind === "macos" ? await runMacosChecks() : await runDockerChecks();

  printSection(`Runner Verification: ${runnerKind}`);
  for (const result of results) {
    printCheck(result);
  }
}

async function runMacosChecks() {
  const store = new FileAuditStore(".runs-verify-macos");
  const orchestrator = new Orchestrator(
    new DefaultPolicyEngine(),
    new MacosSandboxRunner(process.env.ALLOW_UNSANDBOXED_FALLBACK === "1"),
    store
  );

  const allowed = await orchestrator.run({
    runner: "macos",
    command: "/bin/pwd",
    args: [],
    cwd: process.cwd(),
    sandboxMode: "workspace_write",
    writableRoots: [process.cwd()],
    timeoutMs: 5000,
    requestNetwork: false
  });

  const denied = await orchestrator.run({
    runner: "macos",
    command: "/bin/pwd",
    args: [],
    cwd: "/",
    sandboxMode: "workspace_write",
    writableRoots: [process.cwd()],
    timeoutMs: 5000,
    requestNetwork: false
  });

  const approval = await orchestrator.run({
    runner: "macos",
    command: "curl",
    args: ["https://example.com"],
    cwd: process.cwd(),
    sandboxMode: "workspace_write",
    writableRoots: [process.cwd()],
    timeoutMs: 5000,
    requestNetwork: false
  });

  return [
    {
      label: "allowed local command",
      expected: "completed or sandbox failure depending on host constraints",
      status: allowed.result?.status ?? "unknown",
      detail: summarizeRun(allowed)
    },
    {
      label: "cwd outside writable roots",
      expected: "blocked",
      status: denied.result?.status ?? "unknown",
      detail: summarizeRun(denied)
    },
    {
      label: "network-capable command requires approval",
      expected: "awaiting_approval",
      status: approval.result?.status ?? "unknown",
      detail: summarizeRun(approval)
    }
  ];
}

async function runDockerChecks() {
  const store = new FileAuditStore(".runs-verify-docker");
  const orchestrator = new Orchestrator(
    new DefaultPolicyEngine(),
    new DockerSandboxRunner({ defaultImage: "curlimages/curl:8.12.1" }),
    store
  );

  const approval = await orchestrator.run({
    runner: "docker",
    containerImage: "curlimages/curl:8.12.1",
    command: "curl",
    args: ["-I", "https://example.com"],
    cwd: process.cwd(),
    sandboxMode: "danger_full_access",
    writableRoots: [process.cwd()],
    timeoutMs: 20000,
    requestNetwork: true
  });

  const approved = approval.runId ? await orchestrator.approve(approval.runId) : approval;

  const blockedRuntime = await new DockerSandboxRunner({
    defaultImage: "curlimages/curl:8.12.1"
  }).run("run_verify_docker_block", {
    runner: "docker",
    containerImage: "curlimages/curl:8.12.1",
    command: "sh",
    args: ["-lc", "curl -I https://example.com"],
    cwd: process.cwd(),
    sandboxMode: "workspace_write",
    writableRoots: [process.cwd()],
    timeoutMs: 20000,
    requestNetwork: false
  });

  return [
    {
      label: "network command enters approval flow",
      expected: "awaiting_approval before approval",
      status: approval.result?.status ?? "unknown",
      detail: summarizeRun(approval)
    },
    {
      label: "approved network command succeeds",
      expected: "completed",
      status: approved.result?.status ?? "unknown",
      detail: summarizeRun(approved)
    },
    {
      label: "agent runtime network blocked",
      expected: "failed with network resolution/connect error",
      status: blockedRuntime.status,
      detail: summarizeResult(blockedRuntime)
    }
  ];
}

function summarizeRun(record) {
  return summarizeResult(record.result);
}

function summarizeResult(result) {
  if (!result) {
    return "no result";
  }

  const parts = [`status=${result.status}`];
  if (result.exitCode !== null) {
    parts.push(`exitCode=${result.exitCode}`);
  }
  if (result.stderr) {
    parts.push(`stderr=${firstLine(result.stderr)}`);
  }
  if (result.stdout) {
    parts.push(`stdout=${firstLine(result.stdout)}`);
  }

  return parts.join(" | ");
}

function firstLine(value) {
  return value.split("\n").find((line) => line.trim().length > 0) ?? "";
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

function printCheck(check) {
  console.log(`- ${check.label}`);
  console.log(`  expected  ${check.expected}`);
  console.log(`  actual    ${check.status}`);
  console.log(`  detail    ${check.detail}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
