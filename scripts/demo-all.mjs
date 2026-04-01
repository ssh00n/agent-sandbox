#!/usr/bin/env node

import { spawn } from "node:child_process";

async function main() {
  const scenario = process.argv[2];
  if (!scenario) {
    throw new Error("Usage: node scripts/demo-all.mjs <scenario-json-path>");
  }

  const created = await runDemo(["create", scenario]);
  const runId = created.runId ?? created?.result?.runId;

  if (!runId) {
    throw new Error("Could not determine runId from create response.");
  }

  console.log(`\n[demo-all] created runId=${runId}`);
  await runDemo(["run", runId]);

  const approvals = await runDemo(["approvals"]);
  const pending = approvals.approvals?.find((entry) => entry.runId === runId);

  if (pending) {
    console.log(`\n[demo-all] approving ${runId}`);
    await runDemo(["approve", runId]);
  }

  console.log(`\n[demo-all] events for ${runId}`);
  await runDemo(["events", runId]);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
