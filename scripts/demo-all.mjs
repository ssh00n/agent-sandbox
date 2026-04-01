#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function main() {
  const { scenario, action } = parseArgs(process.argv.slice(2));
  if (!scenario) {
    throw new Error(
      "Usage: node scripts/demo-all.mjs <scenario-json-path> [--approve|--deny|--leave-pending]"
    );
  }

  const scenarioSummary = await loadScenarioSummary(scenario);
  printSection("Scenario");
  console.log(`file      ${scenario}`);
  console.log(`command   ${scenarioSummary.command}`);
  console.log(`runner    ${scenarioSummary.runner}`);
  console.log(`sandbox   ${scenarioSummary.sandboxMode}`);
  console.log(`action    ${action}`);

  printStep(1, "Create Run");
  const created = await runDemo(["create", scenario]);
  const runId = created.runId ?? created?.result?.runId;

  if (!runId) {
    throw new Error("Could not determine runId from create response.");
  }

  console.log(`runId     ${runId}`);
  printStep(2, "Inspect Run");
  const initialRun = await runDemo(["run", runId]);
  printRunSummary(initialRun);

  printStep(3, "Check Approvals");
  const approvals = await runDemo(["approvals"]);
  const pending = approvals.approvals?.find((entry) => entry.runId === runId);

  if (pending) {
    console.log(`pending   yes`);
    console.log(`policy    ${pending.intent ?? "-"} (${pending.code ?? "-"})`);
    console.log(`severity  ${pending.severity ?? "-"}`);
    console.log(`summary   ${pending.summary ?? "-"}`);
    console.log(`reason    ${pending.reason}`);

    if (action === "approve") {
      printStep(4, "Approve Run");
      const approved = await runDemo(["approve", runId]);
      printRunSummary(approved);
    } else if (action === "deny") {
      printStep(4, "Deny Run");
      const denied = await runDemo(["deny", runId]);
      printRunSummary(denied);
    } else {
      printStep(4, "Leave Pending");
      console.log("approval left pending");
    }
  } else {
    console.log(`pending   no`);
  }

  printStep(5, "Event Timeline");
  const events = await runDemo(["events", runId]);
  printEventSummary(events);

  printStep(6, "Final Run State");
  const finalRun = await runDemo(["run", runId]);
  printRunSummary(finalRun);
}

function runDemo(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/demo.mjs", "--json", ...args], {
      stdio: ["ignore", "pipe", "inherit"]
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`demo command failed: ${args.join(" ")}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseArgs(args) {
  const scenario = args.find((arg) => !arg.startsWith("--"));
  const action = args.includes("--deny")
    ? "deny"
    : args.includes("--leave-pending")
      ? "leave-pending"
      : "approve";

  return { scenario, action };
}

async function loadScenarioSummary(scenarioPath) {
  const resolved = path.resolve(scenarioPath);
  const scenario = JSON.parse(await readFile(resolved, "utf-8"));
  return {
    command: [scenario.command, ...(scenario.args ?? [])].join(" "),
    runner: scenario.runner ?? "macos",
    sandboxMode: scenario.sandboxMode ?? "workspace_write"
  };
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

function printStep(index, title) {
  console.log(`\n[Step ${index}] ${title}`);
}

function printRunSummary(record) {
  console.log(`status    ${record.result?.status ?? "-"}`);
  console.log(`policy    ${record.policyDecision?.intent ?? "-"} (${record.policyDecision?.code ?? "-"})`);
  console.log(`severity  ${record.policyDecision?.severity ?? "-"}`);
  console.log(`summary   ${record.policyDecision?.summary ?? "-"}`);
  if (record.result?.exitCode !== null && record.result?.exitCode !== undefined) {
    console.log(`exitCode  ${record.result.exitCode}`);
  }
  if (record.result?.stdout) {
    console.log(`stdout    ${firstNonEmptyLine(record.result.stdout)}`);
  }
  if (record.result?.stderr) {
    console.log(`stderr    ${firstNonEmptyLine(record.result.stderr)}`);
  }
}

function printEventSummary(payload) {
  const events = payload.events ?? [];
  if (events.length === 0) {
    console.log("events    none");
    return;
  }

  for (const event of events) {
    console.log(`- ${formatEventType(event.type)}`);
  }
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
    default:
      return type;
  }
}

function firstNonEmptyLine(value) {
  return value.split("\n").find((line) => line.trim().length > 0) ?? "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
