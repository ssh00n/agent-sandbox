#!/usr/bin/env node

import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const READ_ONLY_BINDS = ["/bin", "/dev", "/etc", "/lib", "/lib64", "/sbin", "/usr"];
const workspace = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

async function main() {
  printSection("Probe Target");
  console.log(`workspace ${workspace}`);

  printSection("Unshare");
  await runAndPrint("unshare", ["-Ur", "/bin/sh", "-lc", "id"]);

  printSection("Bubblewrap");
  const args = await buildBubblewrapArgs(workspace);
  console.log(`args      ${args.join(" ")}`);
  await runAndPrint("bwrap", args);
}

async function buildBubblewrapArgs(cwd) {
  const args = ["--die-with-parent", "--new-session", "--unshare-all", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];

  for (const targetPath of READ_ONLY_BINDS) {
    if (await pathExists(targetPath)) {
      args.push("--ro-bind", targetPath, targetPath);
    }
  }

  args.push("--bind", cwd, cwd, "--chdir", cwd, "/bin/pwd");
  return args;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runAndPrint(command, args) {
  const result = await execute(command, args);
  console.log(`exitCode  ${result.exitCode ?? "null"}`);
  if (result.stdout) {
    console.log(`stdout    ${firstNonEmptyLine(result.stdout)}`);
  }
  if (result.stderr) {
    console.log(`stderr    ${firstNonEmptyLine(result.stderr)}`);
  }
}

async function execute(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout,
        stderr: error.message
      });
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr
      });
    });
  });
}

function firstNonEmptyLine(value) {
  return value.split("\n").find((line) => line.trim().length > 0) ?? "";
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
