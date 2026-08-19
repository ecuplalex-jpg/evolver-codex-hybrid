#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function usage() {
  console.log(`Usage:
  node scripts/record_execution_feedback.js \\
    --task "Task name" \\
    --outcome success|failed|partial \\
    [--used-input stable-rules]... \\
    [--adopted "Guidance used"]... \\
    [--rejected "Guidance rejected"]... \\
    [--notes "Why it worked or failed"] \\
    [--base-dir DIR]

This is a thin wrapper over evolver_codex_bridge.js --record-feedback.
`);
}

function parseArgs(argv) {
  const args = {
    usedInputs: [],
    adoptedGuidance: [],
    rejectedGuidance: [],
    baseDir: path.resolve(process.cwd(), "evolver-hybrid"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--task":
        args.task = argv[index + 1];
        index += 1;
        break;
      case "--outcome":
        args.outcome = argv[index + 1];
        index += 1;
        break;
      case "--used-input":
        args.usedInputs.push(argv[index + 1]);
        index += 1;
        break;
      case "--adopted":
        args.adoptedGuidance.push(argv[index + 1]);
        index += 1;
        break;
      case "--rejected":
        args.rejectedGuidance.push(argv[index + 1]);
        index += 1;
        break;
      case "--notes":
        args.notes = argv[index + 1];
        index += 1;
        break;
      case "--base-dir":
        args.baseDir = path.resolve(argv[index + 1]);
        index += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!args.task) {
    throw new Error("Missing required argument: --task");
  }

  const allowedOutcomes = new Set(["success", "failed", "partial"]);
  const outcome = args.outcome || "partial";
  if (!allowedOutcomes.has(outcome)) {
    throw new Error(`Invalid --outcome value: ${outcome}`);
  }

  const payload = {
    timestamp: new Date().toISOString(),
    task: args.task,
    used_inputs: args.usedInputs,
    adopted_guidance: args.adoptedGuidance,
    rejected_guidance: args.rejectedGuidance,
    outcome,
    notes: args.notes || "",
  };

  const tempFile = path.join(
    os.tmpdir(),
    `evolver-feedback-${Date.now()}-${process.pid}.json`,
  );

  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    const bridgePath = path.join(__dirname, "evolver_codex_bridge.js");
    const result = spawnSync(
      process.execPath,
      [bridgePath, "--record-feedback", tempFile, "--base-dir", args.baseDir],
      { stdio: "inherit" },
    );

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch (error) {
      // Best-effort cleanup only.
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
