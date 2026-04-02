#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:4000";
const rawMode = process.env.DEMO_JSON === "1" || process.argv.includes("--json");
const presentMode = process.env.DEMO_PRESENT === "1" || process.argv.includes("--present");

async function main() {
  const filteredArgs = process.argv
    .slice(2)
    .filter((arg) => arg !== "--json" && arg !== "--present");
  const [command, ...args] = filteredArgs;

  switch (command) {
    case "health":
      return printJson(await getJson("/health"));
    case "linux-capabilities":
      return printJson(await getJson("/runtime/linux/capabilities"));
    case "create":
      return handleCreate(args);
    case "runs":
      return printJson(await getJson("/runs"));
    case "run":
      return handleRun(args);
    case "events":
      return handleEvents(args);
    case "approvals":
      return printJson(await getJson("/approvals"));
    case "approve":
      return handleApprovalAction("approve", args);
    case "deny":
      return handleApprovalAction("deny", args);
    case "help":
    case undefined:
      return printHelp();
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleCreate(args) {
  const scenarioPath = args[0];
  if (!scenarioPath) {
    throw new Error("Usage: create <scenario-json-path>");
  }

  const resolvedPath = path.resolve(scenarioPath);
  const payload = replaceRepoRoot(
    JSON.parse(await readFile(resolvedPath, "utf-8")),
    process.cwd()
  );
  const result = await postJson("/runs", payload);
  printJson(result);
}

async function handleRun(args) {
  const runId = args[0];
  if (!runId) {
    throw new Error("Usage: run <runId>");
  }

  printJson(await getJson(`/runs/${runId}`));
}

async function handleEvents(args) {
  const runId = args[0];
  if (!runId) {
    throw new Error("Usage: events <runId>");
  }

  printJson(await getJson(`/runs/${runId}/events`));
}

async function handleApprovalAction(action, args) {
  const runId = args[0];
  if (!runId) {
    throw new Error(`Usage: ${action} <runId>`);
  }

  printJson(await postJson(`/approvals/${runId}/${action}`, {}));
}

async function getJson(resourcePath) {
  const response = await safeFetch(resourcePath, {
    method: "GET"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function postJson(resourcePath, payload) {
  const response = await safeFetch(resourcePath, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function safeFetch(resourcePath, options) {
  try {
    return await fetch(`${baseUrl}${resourcePath}`, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Request to ${baseUrl}${resourcePath} failed. ` +
        `Check that the server is running and reachable. Original error: ${detail}`
    );
  }
}

function printJson(value) {
  if (rawMode) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (presentMode) {
    presentPrint(value);
    return;
  }

  prettyPrint(value);
}

function printHelp() {
  console.log(`Usage:
  node scripts/demo.mjs health
  node scripts/demo.mjs linux-capabilities
  node scripts/demo.mjs create <scenario-json-path>
  node scripts/demo.mjs runs
  node scripts/demo.mjs run <runId>
  node scripts/demo.mjs events <runId>
  node scripts/demo.mjs approvals
  node scripts/demo.mjs approve <runId>
  node scripts/demo.mjs deny <runId>

Environment:
  DEMO_BASE_URL=http://127.0.0.1:4000

Linux examples:
  node scripts/demo.mjs create examples/linux-auto-run.json
  node scripts/demo.mjs create examples/linux-fallback-run.json
  node scripts/demo.mjs create examples/linux-container-rootful-run.json
  node scripts/demo.mjs create examples/linux-native-strict-run.json
`);
}

function prettyPrint(value) {
  if (isRecord(value) && Array.isArray(value.runs)) {
    printSection("Runs");
    for (const run of value.runs) {
      printRunSummary(run);
    }
    return;
  }

  if (isRecord(value) && isRecord(value.capabilities)) {
    printSection("Linux Capabilities");
    console.log(JSON.stringify(value.capabilities, null, 2));
    return;
  }

  if (isRecord(value) && Array.isArray(value.approvals)) {
    printSection("Approvals");
    if (value.approvals.length === 0) {
      console.log("No pending approvals.");
      return;
    }

    for (const approval of value.approvals) {
      printApprovalSummary(approval);
    }
    return;
  }

  if (isRecord(value) && Array.isArray(value.events) && typeof value.runId === "string") {
    printSection(`Events ${value.runId}`);
    for (const event of value.events) {
      console.log(`${event.timestamp}  ${formatEventType(event.type)}`);
      if (event.data && Object.keys(event.data).length > 0) {
        console.log(indent(JSON.stringify(event.data, null, 2), 2));
      }
    }
    return;
  }

  if (isRunRecord(value)) {
    printSection(`Run ${value.runId ?? value.result?.runId ?? "unknown"}`);
    printRunDetail(value);
    return;
  }

  printSection("Output");
  console.log(JSON.stringify(value, null, 2));
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

function printRunSummary(run) {
  console.log(`- ${run.runId}`);
  console.log(`  status   ${run.status}`);
  console.log(`  runner   ${run.runner}`);
  if (run.runtimeBackend) {
    console.log(`  backend  ${run.runtimeBackend}`);
  }
  if (run.runtimeEnforcementLevel) {
    console.log(`  enforce  ${run.runtimeEnforcementLevel}`);
  }
  console.log(`  command  ${formatCommand(run.command, run.args)}`);
  console.log(`  cwd      ${run.cwd}`);
  console.log(`  started  ${run.requestedAt ?? "-"}`);
  console.log(`  ended    ${run.finishedAt ?? "-"}`);
}

function printApprovalSummary(approval) {
  console.log(`- ${approval.runId}`);
  console.log(`  status   ${approval.status}`);
  console.log(`  command  ${formatCommand(approval.command, approval.args)}`);
  console.log(`  cwd      ${approval.cwd}`);
  console.log(`  category ${approval.category ?? "-"}`);
  console.log(`  severity ${approval.severity ?? "-"}`);
  console.log(`  intent   ${approval.intent ?? "-"}`);
  console.log(`  code     ${approval.code ?? "-"}`);
  console.log(`  summary  ${approval.summary ?? "-"}`);
  console.log(`  reason   ${approval.reason}`);
  console.log(`  asked    ${approval.requestedAt ?? "-"}`);
}

function printRunDetail(record) {
  const runId = record.runId ?? record.result?.runId ?? "unknown";
  console.log(`runId      ${runId}`);
  console.log(`status     ${record.result?.status ?? "-"}`);
  console.log(`runner     ${record.request.runner ?? "macos"}`);
  if (record.request.linuxBackend) {
    console.log(`requested  ${record.request.linuxBackend}`);
  }
  if (record.runtimeSelection?.backend) {
    console.log(`backend    ${record.runtimeSelection.backend}`);
  }
  if (record.runtimeSelection?.enforcementLevel) {
    console.log(`enforce    ${record.runtimeSelection.enforcementLevel}`);
  }
  if (record.runtimeSelection?.reason) {
    console.log(`runtime    ${record.runtimeSelection.reason}`);
  }
  if (record.runtimeSelection?.capabilities?.nativeStrictBlockers?.length) {
    console.log(`blockers   ${record.runtimeSelection.capabilities.nativeStrictBlockers.join(" | ")}`);
  }
  console.log(`sandbox    ${record.request.sandboxMode}`);
  console.log(`command    ${formatCommand(record.request.command, record.request.args)}`);
  console.log(`cwd        ${record.request.cwd}`);
  console.log(`policy     ${record.policyDecision.decision}`);
  console.log(`category   ${record.policyDecision.category ?? "-"}`);
  console.log(`severity   ${record.policyDecision.severity ?? "-"}`);
  console.log(`intent     ${record.policyDecision.intent ?? "-"}`);
  console.log(`code       ${record.policyDecision.code ?? "-"}`);
  console.log(`summary    ${record.policyDecision.summary ?? "-"}`);
  console.log(`reason     ${record.policyDecision.reason}`);
  console.log(`started    ${record.result?.startedAt ?? "-"}`);
  console.log(`finished   ${record.result?.finishedAt ?? "-"}`);

  const stageSummary = summarizeStages(record);
  if (stageSummary) {
    console.log(`stages     ${stageSummary}`);
  }

  if (record.result?.stdout) {
    console.log("\nstdout:");
    console.log(indent(trimTrailingNewline(record.result.stdout), 2));
  }

  if (record.result?.stderr) {
    console.log("\nstderr:");
    console.log(indent(trimTrailingNewline(record.result.stderr), 2));
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function indent(value, count) {
  const prefix = " ".repeat(count);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function trimTrailingNewline(value) {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function isRunRecord(value) {
  return (
    isRecord(value) &&
    isRecord(value.request) &&
    isRecord(value.policyDecision)
  );
}

function summarizeStages(record) {
  const hasSetup = Array.isArray(record.request.setupCommands) && record.request.setupCommands.length > 0;
  if (!hasSetup) {
    return record.request.runner === "docker" ? "agent-only" : "";
  }

  if (record.result?.status === "awaiting_approval") {
    return "pending-approval-before-setup";
  }

  return "setup -> agent";
}

function formatEventType(type) {
  switch (type) {
    case "setup_started":
      return "setup:start";
    case "setup_completed":
      return "setup:done";
    case "setup_failed":
      return "setup:fail";
    case "approval_requested":
      return "approval:requested";
    case "approval_granted":
      return "approval:granted";
    case "approval_denied":
      return "approval:denied";
    case "runtime_probe_started":
      return "runtime:probe:start";
    case "runtime_probe_completed":
      return "runtime:probe:done";
    case "runtime_selected":
      return "runtime:selected";
    case "sandbox_apply_started":
      return "sandbox:apply:start";
    case "sandbox_apply_failed":
      return "sandbox:apply:fail";
    case "sandbox_fallback_used":
      return "sandbox:fallback";
    default:
      return type;
  }
}

function presentPrint(value) {
  if (isRunRecord(value)) {
    printSection(`Run ${value.runId ?? value.result?.runId ?? "unknown"}`);
    console.log(`${value.request.command} ${value.request.args.join(" ")}`.trim());
    console.log(
      `status: ${value.result?.status ?? "-"} | policy: ${value.policyDecision.intent} (${value.policyDecision.code}) | severity: ${value.policyDecision.severity}`
    );
    if (value.runtimeSelection?.backend) {
      console.log(
        `runtime: ${value.runtimeSelection.backend} (${value.runtimeSelection.enforcementLevel ?? "-"})`
      );
    }
    console.log(`why: ${value.policyDecision.summary}`);
    const stages = summarizeStages(value);
    if (stages) {
      console.log(`flow: ${stages}`);
    }
    if (value.result?.stderr) {
      console.log(`stderr: ${firstNonEmptyLine(value.result.stderr)}`);
    }
    if (value.result?.stdout) {
      console.log(`stdout: ${firstNonEmptyLine(value.result.stdout)}`);
    }
    return;
  }

  if (isRecord(value) && Array.isArray(value.approvals)) {
    printSection("Approvals");
    for (const approval of value.approvals) {
      console.log(
        `${approval.runId} | ${approval.intent ?? "-"} | ${approval.severity ?? "-"} | ${approval.code ?? "-"} | ${approval.command} ${approval.args.join(" ")}`
      );
    }
    if (value.approvals.length === 0) {
      console.log("No pending approvals.");
    }
    return;
  }

  if (isRecord(value) && Array.isArray(value.runs)) {
    printSection("Runs");
    for (const run of value.runs) {
      console.log(
        `${run.runId} | ${run.status} | ${run.runner}${run.runtimeBackend ? `/${run.runtimeBackend}` : ""} | ${run.command} ${run.args.join(" ")}`
      );
    }
    return;
  }

  if (isRecord(value) && Array.isArray(value.events) && typeof value.runId === "string") {
    printSection(`Events ${value.runId}`);
    for (const event of value.events) {
      console.log(`${formatEventType(event.type)}`);
    }
    return;
  }

  prettyPrint(value);
}

function firstNonEmptyLine(value) {
  return value.split("\n").find((line) => line.trim().length > 0) ?? "";
}

function replaceRepoRoot(value, repoRoot) {
  if (typeof value === "string") {
    return value === "__REPO_ROOT__" ? repoRoot : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replaceRepoRoot(entry, repoRoot));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceRepoRoot(entry, repoRoot)])
    );
  }

  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
