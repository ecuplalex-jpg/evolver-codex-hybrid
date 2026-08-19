#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function usage() {
  console.log(`Usage:
  node scripts/evolver_codex_bridge.js [--input FILE] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --apply-approved-packet FILE --packet-sha256 HEX [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --record-feedback FILE [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --mark-candidate-handled <session_id|session_path> [--handled-reason TEXT] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --export-gene FILE [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --refresh-gene FILE [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-feedback-insights [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-task-session-index [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-debrief-reminder [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-candidate-promotion [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --run-maintenance [all|safe|candidate-promotion|feedback-insights|task-session-index|debrief-reminder] [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --query "search text" [--task-context TEXT] [--task-family NAME]... [--preset retrieval|post-task-debrief] [--source NAME]... [--outcome success|failed|partial]... [--used-input NAME]... [--task-contains TEXT] [--since-days N] [--limit N] [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --query-for-promotion [TEXT] [--preset promotion-review] [--outcome success|failed|partial]... [--used-input NAME]... [--task-contains TEXT] [--since-days N] [--limit N] [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-gene-candidate [TEXT] [--preset promotion-review] [--outcome success|failed|partial]... [--used-input NAME]... [--task-contains TEXT] [--since-days N] [--limit N] [--format json|markdown] [--base-dir DIR]
  node scripts/evolver_codex_bridge.js --build-promotion-packet [TEXT] [--preset promotion-review] [--outcome success|failed|partial]... [--used-input NAME]... [--task-contains TEXT] [--since-days N] [--limit N] [--format json|markdown] [--base-dir DIR]

Modes:
  ingest          Read Evolver output from --input or stdin, then generate Codex-friendly artifacts.
  apply-approved-packet
                  Apply one human-approved, hash-bound promotion packet to memory/stable-rules.md.
                  Legacy free-text --promote-rule is disabled and fails closed.
  record-feedback Append execution feedback JSON into memory/execution-feedback.ndjson.
  mark-candidate-handled
                  Mark a single Codex candidate (by session id or session path) as handled by editing
                  memory/codex-candidate-ignore.json directly. Safe clear path that never runs candidate-promotion.
  export-gene     Copy a validated agent gene JSON/MD into memory/agent-genes/.
  refresh-gene    Refresh an existing Gene JSON with current heuristic validation commands and feedback-backed preconditions.
  build-feedback-insights
                  Summarize stable rules, execution feedback, and exported genes into reusable artifacts.
  build-task-session-index
                  Rebuild a lightweight task/session index under memory/ from execution feedback for file-based recall.
  build-debrief-reminder
                  Generate a narrow reminder artifact for recording the next execution debrief.
  build-candidate-promotion
                  Classify current Codex session candidates, prepare stable-rule proposals, and mark only non-proposal handled items.
  run-maintenance
                  Run a narrow maintenance task suitable for cron/manual use without adding background services.
                  candidate-promotion is proposal-only and never mutates stable rules; safe remains the unattended default.
  query           Search stable rules, feedback insights, Codex history, execution feedback, and exported genes,
                  then return a task-usable summary without changing the hybrid architecture.
  query-for-promotion
                  Find evidence-backed stable-rule candidates from execution feedback without auto-promoting them.
  build-gene-candidate
                  Build a reviewable Gene scaffold from promotion evidence and write it to artifacts/gene-candidates/.
  build-promotion-packet
                  Build a review-pending packet with evidence, target pre-hash, linked Gene draft, and empty approval fields.

Presets:
  retrieval        Query stable rules + insights + recent feedback + genes with start-of-task defaults.
  promotion-review Narrow promotion / Gene review around recent evidence without auto-acting.
  post-task-debrief Query recent feedback first when summarizing what just worked or failed.
`);
}

function parseArgs(argv) {
  const args = {
    baseDir: path.resolve(process.cwd(), "evolver-hybrid"),
    querySources: [],
    outcomes: [],
    usedInputs: [],
    taskFamilies: [],
    limit: 8,
    limitExplicit: false,
    format: "json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--input":
        args.input = argv[index + 1];
        index += 1;
        break;
      case "--base-dir":
        args.baseDir = path.resolve(argv[index + 1]);
        index += 1;
        break;
      case "--apply-approved-packet":
        args.applyApprovedPacket = argv[index + 1];
        index += 1;
        break;
      case "--packet-sha256":
        args.packetSha256 = argv[index + 1];
        index += 1;
        break;
      case "--promote-rule":
        args.promoteRule = argv[index + 1];
        index += 1;
        break;
      case "--rule-source":
        args.ruleSource = argv[index + 1];
        index += 1;
        break;
      case "--record-feedback":
        args.recordFeedback = argv[index + 1];
        index += 1;
        break;
      case "--mark-candidate-handled":
        args.markCandidateHandled = argv[index + 1];
        index += 1;
        break;
      case "--handled-reason":
        args.handledReason = argv[index + 1];
        index += 1;
        break;
      case "--export-gene":
        args.exportGene = argv[index + 1];
        index += 1;
        break;
      case "--refresh-gene":
        args.refreshGene = argv[index + 1];
        index += 1;
        break;
      case "--build-feedback-insights":
        args.buildFeedbackInsights = true;
        break;
      case "--build-task-session-index":
        args.buildTaskSessionIndex = true;
        break;
      case "--build-debrief-reminder":
        args.buildDebriefReminder = true;
        break;
      case "--build-candidate-promotion":
        args.buildCandidatePromotion = true;
        break;
      case "--run-maintenance":
        if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          args.runMaintenance = argv[index + 1].trim() || "safe";
          index += 1;
        } else {
          args.runMaintenance = "safe";
        }
        break;
      case "--query":
        args.query = argv[index + 1];
        index += 1;
        break;
      case "--query-for-promotion":
        if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          args.queryForPromotion = argv[index + 1];
          index += 1;
        } else {
          args.queryForPromotion = "";
        }
        break;
      case "--build-gene-candidate":
        if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          args.buildGeneCandidate = argv[index + 1];
          index += 1;
        } else {
          args.buildGeneCandidate = "";
        }
        break;
      case "--build-promotion-packet":
        if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
          args.buildPromotionPacket = argv[index + 1];
          index += 1;
        } else {
          args.buildPromotionPacket = "";
        }
        break;
      case "--task-context":
        args.taskContext = argv[index + 1];
        index += 1;
        break;
      case "--preset":
        args.preset = argv[index + 1];
        index += 1;
        break;
      case "--task-contains":
        args.taskContains = argv[index + 1];
        index += 1;
        break;
      case "--task-family":
        args.taskFamilies.push(argv[index + 1]);
        index += 1;
        break;
      case "--source":
        args.querySources.push(argv[index + 1]);
        index += 1;
        break;
      case "--outcome":
        args.outcomes.push(argv[index + 1]);
        index += 1;
        break;
      case "--used-input":
        args.usedInputs.push(argv[index + 1]);
        index += 1;
        break;
      case "--since-days":
        args.sinceDays = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--limit":
        args.limit = Number.parseInt(argv[index + 1], 10);
        args.limitExplicit = true;
        index += 1;
        break;
      case "--format":
        args.format = argv[index + 1];
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readInput(inputPath) {
  if (inputPath) {
    return fs.readFileSync(path.resolve(inputPath), "utf8");
  }

  return fs.readFileSync(0, "utf8");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function splitFileName(fileName) {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return { baseName, extension };
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function extractSpawnDirectives(text) {
  const directives = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("sessions_spawn(", cursor);
    if (start === -1) {
      break;
    }

    let index = start + "sessions_spawn(".length;
    let depth = 1;
    let quote = null;
    let escaped = false;

    while (index < text.length && depth > 0) {
      const char = text[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        index += 1;
        continue;
      }

      if (char === "'" || char === '"' || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }

      index += 1;
    }

    directives.push({
      raw: text.slice(start, index).trim(),
      start,
      end: index,
    });
    cursor = index;
  }

  return directives;
}

function stripDirectives(text, directives) {
  if (directives.length === 0) {
    return text.trim();
  }

  let cursor = 0;
  let output = "";

  for (const directive of directives) {
    output += text.slice(cursor, directive.start);
    cursor = directive.end;
  }

  output += text.slice(cursor);
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBlockLines(lines, startIndex, options = {}) {
  const results = [];
  const maxLines = options.maxLines || 6;
  let inCodeBlock = false;

  for (let index = startIndex + 1; index < lines.length && results.length < maxLines; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && !line) {
      if (results.length > 0) {
        break;
      }
      continue;
    }

    if (!inCodeBlock && /^Context \[/.test(line)) {
      break;
    }

    if (!line) {
      continue;
    }

    results.push(line.replace(/^- /, ""));
  }

  return results;
}

function extractActionableSummaryLines(text, limit = 8) {
  const lines = text.split(/\r?\n/);
  const actionable = [];
  const seen = new Set();

  function addLine(line) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    actionable.push(normalized);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === "SKILL OVERLAP PREVENTION:") {
      extractBlockLines(lines, index, { maxLines: 5 }).forEach(addLine);
    }

    if (line === "Global memory (MEMORY.md):") {
      extractBlockLines(lines, index, { maxLines: 4 }).forEach(addLine);
    }

    if (line === "Recent memory snippet:") {
      extractBlockLines(lines, index, { maxLines: 6 }).forEach(addLine);
    }

    if (line === "[Signal Hints]") {
      extractBlockLines(lines, index, { maxLines: 4 }).forEach(addLine);
    }
  }

  if (actionable.length > 0) {
    return actionable.slice(0, limit);
  }

  const boilerplatePatterns = [
    /^Starting evolver/i,
    /^Scanning session logs/i,
    /^\[SearchFirst]/,
    /^GEP — /,
    /^You are a protocol-bound evolution engine/i,
    /^━━━━━━━━/,
    /^I\. Mandatory Evolution Object Model/i,
    /^Output separate JSON objects/i,
    /^DO NOT /i,
    /^Output RAW JSON ONLY/i,
    /^Missing any object/i,
    /^ENSURE VALID JSON SYNTAX/i,
  ];

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !boilerplatePatterns.some((pattern) => pattern.test(line)))
    .slice(0, limit);
}

function buildActionItems(summaryLines, directives, delegateSuggestions = []) {
  const actions = [];

  if (summaryLines.length > 0) {
    actions.push({
      type: "summarized_guidance",
      priority: "high",
      text: summaryLines[0],
    });
  }

  actions.push(...buildHostActionItems(directives, delegateSuggestions));

  if (actions.length === 0) {
    actions.push({
      type: "manual_review",
      priority: "medium",
      text: "No explicit sessions_spawn(...) directive was found. Review the Evolver output and decide whether a stable rule should be promoted.",
    });
  }

  return actions;
}

function stripDirectiveWrapper(rawDirective) {
  const trimmed = String(rawDirective || "").trim();
  if (!trimmed.startsWith("sessions_spawn(") || !trimmed.endsWith(")")) {
    return trimmed;
  }
  return trimmed.slice("sessions_spawn(".length, -1).trim();
}

function extractQuotedValues(text) {
  const values = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let match;

  while ((match = pattern.exec(String(text || ""))) !== null) {
    const value = String(match[2] || "").replace(/\\(["'`\\])/g, "$1").trim();
    if (value) {
      values.push(value);
    }
  }

  return uniqueStrings(values);
}

function extractStructuredDirectiveFields(rawDirective) {
  const body = stripDirectiveWrapper(rawDirective);
  const fields = {};
  const simpleKeys = [
    "task",
    "title",
    "name",
    "goal",
    "prompt",
    "message",
    "instructions",
    "agent",
    "agent_id",
    "model",
    "sandbox",
    "runtime",
    "thread",
  ];

  simpleKeys.forEach((key) => {
    const pattern = new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`, "i");
    const match = body.match(pattern);
    if (match) {
      fields[key] = String(match[2] || "").replace(/\\(["'\`\\])/g, "$1").trim();
    }
  });

  const numericKeys = ["timeout", "timeout_ms", "timeout_seconds", "max_files"];
  numericKeys.forEach((key) => {
    const pattern = new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*([0-9]+)`, "i");
    const match = body.match(pattern);
    if (match) {
      fields[key] = Number.parseInt(match[1], 10);
    }
  });

  if (!fields.task && !fields.prompt && !fields.goal && !fields.instructions) {
    const quotedValues = extractQuotedValues(body)
      .filter((value) => value.length >= 12)
      .filter((value) => !/^gene_[a-z0-9_-]+$/i.test(value));
    if (quotedValues[0]) {
      fields.task = quotedValues[0];
    }
  }

  const attachmentMatch = body.match(/\b(files|attachments|artifacts)\s*:\s*\[([^\]]*)\]/i);
  if (attachmentMatch) {
    const attachmentValues = extractQuotedValues(attachmentMatch[2]);
    if (attachmentValues.length > 0) {
      fields.attachments = attachmentValues;
    }
  }

  return fields;
}

function buildDelegatePromptFromFields(fields) {
  const objective = fields.task || fields.goal || fields.prompt || fields.message || fields.instructions || "";
  const lines = [
    "## Objective",
    objective || "Review the raw sessions_spawn directive and extract the smallest bounded subtask that still preserves intent.",
    "",
  ];

  if (fields.instructions && fields.instructions !== objective) {
    lines.push(`## Instructions`, fields.instructions, "");
  } else if (fields.prompt && fields.prompt !== objective) {
    lines.push(`## Prompt Emphasis`, fields.prompt, "");
  }

  lines.push("## Inputs");
  if (fields.attachments && fields.attachments.length > 0) {
    lines.push(`- Files/artifacts: ${fields.attachments.join(", ")}`);
  } else {
    lines.push("- (none extracted — check raw directive)");
  }

  lines.push("", "## Deliverable");
  lines.push("- A concrete, bounded result that can be verified locally.");

  lines.push("", "## Constraints");
  lines.push("- Keep the result explicit, auditable, and scoped.");
  lines.push("- Do not assume host-native sessions_spawn support.");
  lines.push("- Do not auto-execute — this is a translation, not a runtime dispatch.");

  return lines.join("\n");
}

function buildDelegateSuggestions(directives) {
  return directives.map((directive, index) => {
    const extracted = extractStructuredDirectiveFields(directive.raw);
    const primaryGoal = extracted.task
      || extracted.goal
      || extracted.prompt
      || extracted.message
      || extracted.instructions
      || "Review raw sessions_spawn directive and restate it as an explicit local subtask";
    const parseConfidence = Number(
      Math.min(0.95, 0.35 + (Object.keys(extracted).length * 0.1)).toFixed(2),
    );
    const suggestionId = `delegate-suggestion-${index + 1}`;

    const inputArtifacts = extracted.attachments || [];
    const deliverable = extracted.task
      ? `Completed subtask: ${extracted.task.slice(0, 120)}`
      : "A bounded, verifiable result restated from the raw directive.";

    return {
      id: suggestionId,
      type: "delegate_suggestion",
      priority: index === 0 ? "high" : "medium",
      primary_goal: primaryGoal,
      objective: primaryGoal,
      input_artifacts: inputArtifacts,
      deliverable,
      constraints: [
        "Do not assume host-native sessions_spawn support.",
        "Keep write scope explicit before delegating or editing.",
        "Do not auto-execute — this is a local translation only.",
      ],
      raw_directive: directive.raw,
      extracted_fields: extracted,
      parse_confidence: parseConfidence,
      local_execution_mode: "manual-or-local-worker",
      suggested_prompt: buildDelegatePromptFromFields(extracted),
      suggested_steps: [
        "Restate the spawn intent as a bounded Codex/Claude subtask or run it serially in the current session.",
        "Keep the write scope explicit before delegating or editing.",
        "Fold the result back into the current task and record execution feedback after real use.",
      ],
      limitations: [
        "This translation does not execute host-native sessions_spawn runtime behavior.",
        "Parallel delegation still requires an explicit local worker handoff or manual execution.",
      ],
    };
  });
}

function buildHostActionItems(directives, suggestions) {
  return suggestions.map((suggestion, index) => ({
    type: "delegate_suggestion",
    priority: suggestion.priority,
    text: `Translate host-only spawn into an explicit delegate suggestion: ${suggestion.primary_goal}`,
    raw_directive: directives[index] ? directives[index].raw : "",
    delegate_suggestion_id: suggestion.id,
    parse_confidence: suggestion.parse_confidence,
    local_execution_mode: suggestion.local_execution_mode,
    suggested_prompt: suggestion.suggested_prompt,
  }));
}

function ensureBaseLayout(baseDir) {
  ensureDir(baseDir);
  ensureDir(path.join(baseDir, "artifacts"));
  ensureDir(path.join(baseDir, "memory"));
  ensureDir(path.join(baseDir, "memory", "agent-genes"));
  ensureDir(path.join(baseDir, "memory", "task-sessions"));
  ensureDir(path.join(baseDir, "inbox"));
  ensureDir(path.join(baseDir, "raw"));
}

function maybeInitStableRules(baseDir) {
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  if (!fs.existsSync(stableRulesPath)) {
    fs.writeFileSync(
      stableRulesPath,
      [
        "# Stable Rules",
        "",
        "Promote only lessons that survived at least one real task.",
        "",
        "## Rules",
        "- None promoted yet.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

function maybeInitEventLog(baseDir) {
  const eventLogPath = path.join(baseDir, "memory", "evolution-events.ndjson");
  if (!fs.existsSync(eventLogPath)) {
    fs.writeFileSync(eventLogPath, "", "utf8");
  }
}

function maybeInitFeedbackLog(baseDir) {
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  if (!fs.existsSync(feedbackPath)) {
    fs.writeFileSync(feedbackPath, "", "utf8");
  }
}

function maybeInitTaskSessionIndex(baseDir) {
  const indexPath = path.join(baseDir, "memory", "task-session-index.ndjson");
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, "", "utf8");
  }
}

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function defaultCandidatePromotionRules() {
  return {
    generated_at: new Date().toISOString(),
    source: "portable-empty-default",
    note: "Add workspace-specific deterministic rules only after local review. With no rules configured, every candidate stays review-first.",
    rules: [],
  };
}

function loadCandidatePromotionRules(baseDir) {
  const filePath = path.join(baseDir, "memory", "codex-candidate-promotion-rules.json");
  if (!fs.existsSync(filePath)) {
    const defaults = defaultCandidatePromotionRules();
    writeJsonFile(filePath, defaults);
    return { filePath, rules: defaults.rules };
  }

  const parsed = readJsonFile(filePath);
  return {
    filePath,
    rules: Array.isArray(parsed.rules) ? parsed.rules : [],
  };
}

function loadCandidateIgnoreRegistry(baseDir) {
  const filePath = path.join(baseDir, "memory", "codex-candidate-ignore.json");
  if (!fs.existsSync(filePath)) {
    const empty = {
      ignored_session_ids: [],
      ignored_paths: [],
      ignored_task_substrings: [],
      entries: [],
    };
    writeJsonFile(filePath, empty);
    return { filePath, ...empty };
  }

  const parsed = readJsonFile(filePath);
  return {
    filePath,
    ignored_session_ids: Array.isArray(parsed.ignored_session_ids) ? parsed.ignored_session_ids : [],
    ignored_paths: Array.isArray(parsed.ignored_paths) ? parsed.ignored_paths : [],
    ignored_task_substrings: Array.isArray(parsed.ignored_task_substrings) ? parsed.ignored_task_substrings : [],
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

function saveCandidateIgnoreRegistry(registry) {
  writeJsonFile(registry.filePath, {
    ignored_session_ids: registry.ignored_session_ids,
    ignored_paths: registry.ignored_paths,
    ignored_task_substrings: registry.ignored_task_substrings,
    entries: registry.entries,
  });
}

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeComparableText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function candidateSessionId(candidate) {
  return candidate.session_id || candidate.id || "";
}

function candidateCombinedText(candidate) {
  return [candidate.first_user_message || "", candidate.last_user_message || ""]
    .filter(Boolean)
    .join("\n");
}

function candidateMatchesPromotionRule(candidate, rule) {
  const text = candidateCombinedText(candidate);
  const normalizedText = normalizeComparableText(text);
  const families = Array.isArray(candidate.task_families) ? candidate.task_families : [];
  const containsAny = Array.isArray(rule.contains_any) ? rule.contains_any : [];
  const containsAll = Array.isArray(rule.contains_all) ? rule.contains_all : [];
  const familiesAny = Array.isArray(rule.families_any) ? rule.families_any : [];
  const familiesAll = Array.isArray(rule.families_all) ? rule.families_all : [];

  if (familiesAny.length > 0 && !familiesAny.some((item) => families.includes(item))) {
    return false;
  }
  if (familiesAll.length > 0 && !familiesAll.every((item) => families.includes(item))) {
    return false;
  }
  if (containsAny.length > 0 && !containsAny.some((item) => normalizedText.includes(normalizeComparableText(item)))) {
    return false;
  }
  if (containsAll.length > 0 && !containsAll.every((item) => normalizedText.includes(normalizeComparableText(item)))) {
    return false;
  }
  return true;
}

function findMatchedPromotionRule(candidate, rules) {
  return rules
    .filter((rule) => candidateMatchesPromotionRule(candidate, rule))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0))[0] || null;
}

function isCandidateIgnored(candidate, ignoreRegistry) {
  const sessionId = candidateSessionId(candidate);
  if (sessionId && ignoreRegistry.ignored_session_ids.includes(sessionId)) {
    return true;
  }
  if (candidate.path && ignoreRegistry.ignored_paths.includes(candidate.path)) {
    return true;
  }
  if (candidate.relative_path && ignoreRegistry.ignored_paths.includes(candidate.relative_path)) {
    return true;
  }
  const text = candidateCombinedText(candidate);
  return ignoreRegistry.ignored_task_substrings.some((item) => item && text.includes(item));
}

function addHandledCandidate(ignoreRegistry, candidate, reason) {
  const sessionId = candidateSessionId(candidate);
  if (sessionId && !ignoreRegistry.ignored_session_ids.includes(sessionId)) {
    ignoreRegistry.ignored_session_ids.push(sessionId);
  }
  if (candidate.path && !ignoreRegistry.ignored_paths.includes(candidate.path)) {
    ignoreRegistry.ignored_paths.push(candidate.path);
  }
  const existing = ignoreRegistry.entries.find((entry) => entry.session_id === sessionId);
  if (existing) {
    existing.reason = reason;
    existing.updated_at = new Date().toISOString();
    return;
  }
  ignoreRegistry.entries.push({
    session_id: sessionId,
    path: candidate.path || "",
    reason,
    added_at: new Date().toISOString(),
  });
}

// Safe, human-gated clear of a single candidate. Edits codex-candidate-ignore.json directly
// (same registry mutation as candidate-promotion's addHandledCandidate) but NEVER runs
// candidate-promotion or prepares unrelated stable-rule proposals.
function markCandidateHandled(baseDir, selector, reason) {
  const key = String(selector || "").trim();
  if (!key) {
    throw new Error("--mark-candidate-handled requires a session id or session path.");
  }

  const ignoreRegistry = loadCandidateIgnoreRegistry(baseDir);

  // Enrich from the latest classification snapshot so both session_id and path land in the registry.
  let candidate = null;
  let matchedSnapshot = false;
  const classificationPath = path.join(baseDir, "artifacts", "codex-candidate-classification.json");
  if (fs.existsSync(classificationPath)) {
    try {
      const snapshot = readJsonFile(classificationPath);
      const list = Array.isArray(snapshot.classifications) ? snapshot.classifications : [];
      candidate = list.find((item) => {
        const sid = candidateSessionId(item);
        return (sid && sid === key) || item.path === key || item.relative_path === key;
      }) || null;
      matchedSnapshot = Boolean(candidate);
    } catch (error) {
      candidate = null;
    }
  }

  // Fall back to a minimal candidate inferred from the selector shape.
  if (!candidate) {
    const looksLikePath = key.includes("/") || key.includes("\\");
    candidate = looksLikePath ? { path: key } : { session_id: key };
  }

  const alreadyHandled = isCandidateIgnored(candidate, ignoreRegistry);
  const effectiveReason = reason && String(reason).trim()
    ? String(reason).trim()
    : "manually marked handled via --mark-candidate-handled";
  addHandledCandidate(ignoreRegistry, candidate, effectiveReason);
  saveCandidateIgnoreRegistry(ignoreRegistry);

  return {
    selector: key,
    matched_snapshot_candidate: matchedSnapshot,
    already_handled_before: alreadyHandled,
    session_id: candidateSessionId(candidate) || null,
    path: candidate.path || null,
    reason: effectiveReason,
    ignore_registry_path: ignoreRegistry.filePath,
    ignored_session_ids_count: ignoreRegistry.ignored_session_ids.length,
    ignored_paths_count: ignoreRegistry.ignored_paths.length,
  };
}

function extractStableRuleTexts(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, ""))
    .map((line) => line.replace(/\s+\(source: .*; promoted: .*?\)\s*$/, "").trim())
    .filter(Boolean);
}

function createOutcomeCounts() {
  return {
    success: 0,
    partial: 0,
    failed: 0,
  };
}

function collectGuidanceStats(feedbackEntries, fieldName) {
  const stats = new Map();

  for (const entry of feedbackEntries) {
    const items = Array.isArray(entry[fieldName]) ? entry[fieldName] : [];
    const outcome = entry.outcome || "partial";
    const task = entry.task || "unspecified task";
    const timestamp = entry.timestamp || "";

    for (const rawItem of items) {
      const text = String(rawItem || "").trim();
      const key = normalizeComparableText(text);
      if (!key) {
        continue;
      }

      const existing = stats.get(key) || {
        text,
        count: 0,
        outcomes: createOutcomeCounts(),
        tasks: [],
        last_seen: timestamp,
      };

      existing.count += 1;
      if (!(outcome in existing.outcomes)) {
        existing.outcomes[outcome] = 0;
      }
      existing.outcomes[outcome] += 1;
      if (timestamp && (!existing.last_seen || timestamp > existing.last_seen)) {
        existing.last_seen = timestamp;
      }
      if (!existing.tasks.includes(task)) {
        existing.tasks.push(task);
      }
      if (text.length > existing.text.length) {
        existing.text = text;
      }

      stats.set(key, existing);
    }
  }

  return Array.from(stats.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    if (right.outcomes.success !== left.outcomes.success) {
      return right.outcomes.success - left.outcomes.success;
    }
    return left.text.localeCompare(right.text);
  });
}

function formatGuidanceStat(stat) {
  return `${stat.text} — ${stat.count}x (success ${stat.outcomes.success || 0}, partial ${stat.outcomes.partial || 0}, failed ${stat.outcomes.failed || 0})`;
}

function buildFeedbackInsights(baseDir, options = {}) {
  const now = new Date().toISOString();
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  const eventLogPath = path.join(baseDir, "memory", "evolution-events.ndjson");
  const geneDir = path.join(baseDir, "memory", "agent-genes");
  const insightsJsonPath = path.join(baseDir, "artifacts", "feedback-insights.json");
  const insightsMarkdownPath = path.join(baseDir, "artifacts", "feedback-insights.md");

  const feedbackEntries = readNdjson(feedbackPath);
  const evolutionEvents = readNdjson(eventLogPath);
  const stableRulesContent = fs.existsSync(stableRulesPath)
    ? fs.readFileSync(stableRulesPath, "utf8")
    : "";
  const stableRules = extractStableRuleTexts(stableRulesContent);
  const stableRuleKeys = new Set(stableRules.map((rule) => normalizeComparableText(rule)));
  const geneFiles = fs.existsSync(geneDir)
    ? fs.readdirSync(geneDir).filter((name) => !name.startsWith("."))
    : [];

  const outcomes = createOutcomeCounts();
  for (const entry of feedbackEntries) {
    const outcome = entry.outcome || "partial";
    if (!(outcome in outcomes)) {
      outcomes[outcome] = 0;
    }
    outcomes[outcome] += 1;
  }

  const adoptedStats = collectGuidanceStats(feedbackEntries, "adopted_guidance");
  const rejectedStats = collectGuidanceStats(feedbackEntries, "rejected_guidance");
  const promotableGuidance = adoptedStats
    .filter((stat) => (stat.outcomes.success || 0) >= 2)
    .filter((stat) => !stableRuleKeys.has(normalizeComparableText(stat.text)))
    .slice(0, 8)
    .map((stat) => ({
      rule_text: stat.text,
      support_count: stat.count,
      successful_runs: stat.outcomes.success || 0,
      recent_tasks: stat.tasks.slice(0, 3),
      last_seen: stat.last_seen,
    }));
  const watchlist = rejectedStats
    .concat(
      adoptedStats.filter((stat) => (stat.outcomes.failed || 0) > 0),
    )
    .sort((left, right) => {
      const leftRisk = (left.outcomes.failed || 0) + (left.outcomes.partial || 0);
      const rightRisk = (right.outcomes.failed || 0) + (right.outcomes.partial || 0);
      if (rightRisk !== leftRisk) {
        return rightRisk - leftRisk;
      }
      return right.count - left.count;
    })
    .filter((stat, index, array) => array.findIndex((item) => item.text === stat.text) === index)
    .slice(0, 6);

  const totalFeedback = feedbackEntries.length;
  const successRate = totalFeedback === 0
    ? 0
    : Number((((outcomes.success || 0) / totalFeedback) * 100).toFixed(1));

  const recentFeedback = feedbackEntries
    .slice(-5)
    .reverse()
    .map((entry) => ({
      timestamp: entry.timestamp || "",
      task: entry.task || "unspecified task",
      outcome: entry.outcome || "partial",
      used_inputs: Array.isArray(entry.used_inputs) ? entry.used_inputs : [],
      adopted_guidance: Array.isArray(entry.adopted_guidance) ? entry.adopted_guidance : [],
      rejected_guidance: Array.isArray(entry.rejected_guidance) ? entry.rejected_guidance : [],
      notes: entry.notes || "",
    }));

  const insightsPayload = {
    generated_at: now,
    snapshot: {
      feedback_entries: totalFeedback,
      stable_rules: stableRules.length,
      exported_genes: geneFiles.length,
      evolution_events: evolutionEvents.length,
    },
    outcomes,
    success_rate: successRate,
    top_adopted_guidance: adoptedStats.slice(0, 8),
    top_rejected_guidance: rejectedStats.slice(0, 8),
    promotable_guidance: promotableGuidance,
    watchlist,
    recent_feedback: recentFeedback,
  };
  fs.writeFileSync(insightsJsonPath, `${JSON.stringify(insightsPayload, null, 2)}\n`, "utf8");

  const markdownLines = [
    "# Feedback Insights",
    "",
    `Generated: ${now}`,
    "",
    "## Snapshot",
    `- Feedback entries: ${totalFeedback}`,
    `- Success rate: ${successRate}%`,
    `- Stable rules: ${stableRules.length}`,
    `- Exported genes: ${geneFiles.length}`,
    `- Evolution events: ${evolutionEvents.length}`,
    "",
    "## Promotable Guidance",
  ];

  if (promotableGuidance.length === 0) {
    markdownLines.push("- No guidance has cleared the auto-promotion threshold yet. Threshold: at least 2 successful feedback entries and not already promoted.");
  } else {
    promotableGuidance.forEach((item) => {
      markdownLines.push(`- ${item.rule_text} (successful runs: ${item.successful_runs}, total support: ${item.support_count})`);
    });
  }

  markdownLines.push("", "## High-Value Adopted Guidance");
  if (adoptedStats.length === 0) {
    markdownLines.push("- No adopted guidance recorded yet.");
  } else {
    adoptedStats.slice(0, 6).forEach((stat) => {
      markdownLines.push(`- ${formatGuidanceStat(stat)}`);
    });
  }

  markdownLines.push("", "## Rejected Or Risky Guidance");
  if (watchlist.length === 0) {
    markdownLines.push("- No repeated rejected or risky guidance detected yet.");
  } else {
    watchlist.forEach((stat) => {
      markdownLines.push(`- ${formatGuidanceStat(stat)}`);
    });
  }

  markdownLines.push("", "## Recent Feedback");
  if (recentFeedback.length === 0) {
    markdownLines.push("- No execution feedback has been recorded yet.");
  } else {
    recentFeedback.forEach((entry, index) => {
      const adoptedPreview = entry.adopted_guidance.length > 0
        ? entry.adopted_guidance.join("; ")
        : "none";
      const rejectedPreview = entry.rejected_guidance.length > 0
        ? entry.rejected_guidance.join("; ")
        : "none";
      markdownLines.push(`${index + 1}. ${entry.task} [${entry.outcome}]`);
      markdownLines.push(`   - adopted: ${adoptedPreview}`);
      markdownLines.push(`   - rejected: ${rejectedPreview}`);
      if (entry.notes) {
        markdownLines.push(`   - notes: ${entry.notes}`);
      }
    });
  }

  markdownLines.push(
    "",
    "## How To Use",
    "- Read this after next-actions when you need a compact view of what guidance is actually surviving contact with reality.",
    "- Verify promotable guidance against the underlying execution-feedback.ndjson before promoting a new stable rule.",
    "- Use the watchlist to avoid reusing advice that is repeatedly rejected or correlated with failed runs.",
    "",
  );

  fs.writeFileSync(insightsMarkdownPath, markdownLines.join("\n"), "utf8");

  if (options.appendEvent !== false) {
    appendEvent(baseDir, {
      type: "feedback_insights_built",
      timestamp: now,
      feedback_entries: totalFeedback,
      promotable_guidance_count: promotableGuidance.length,
    });
  }

  return {
    insightsJsonPath,
    insightsMarkdownPath,
    generatedAt: now,
    feedbackCount: totalFeedback,
    promotableGuidanceCount: promotableGuidance.length,
  };
}

const QUERY_SOURCE_ALIASES = {
  "stable-rules": "stable-rules",
  stable_rules: "stable-rules",
  stable: "stable-rules",
  rules: "stable-rules",
  "feedback-insights": "feedback-insights",
  feedback_insights: "feedback-insights",
  feedback: "feedback-insights",
  insights: "feedback-insights",
  "execution-feedback": "execution-feedback",
  execution_feedback: "execution-feedback",
  "feedback-log": "execution-feedback",
  feedback_log: "execution-feedback",
  executions: "execution-feedback",
  "agent-genes": "genes",
  agent_genes: "genes",
  genes: "genes",
  gene: "genes",
  "task-sessions": "task-sessions",
  task_sessions: "task-sessions",
  "task-session-index": "task-sessions",
  task_session_index: "task-sessions",
  sessions: "task-sessions",
  session: "task-sessions",
  "codex-sessions": "codex-sessions",
  codex_sessions: "codex-sessions",
  "codex-session-index": "codex-sessions",
  codex_session_index: "codex-sessions",
  history: "codex-sessions",
  "history-sessions": "codex-sessions",
  "claude-sessions": "claude-sessions",
  claude_sessions: "claude-sessions",
  "claude-session-index": "claude-sessions",
  claude_session_index: "claude-sessions",
  "claude-history": "claude-sessions",
  claude_history: "claude-sessions",
  "claude-memories": "claude-memories",
  claude_memories: "claude-memories",
  "claude-memory": "claude-memories",
  claude_memory: "claude-memories",
  "claude-memory-index": "claude-memories",
  claude_memory_index: "claude-memories",
  "delegate-suggestions": "delegate-suggestions",
  delegate_suggestions: "delegate-suggestions",
  delegates: "delegate-suggestions",
  delegate: "delegate-suggestions",
};

const QUERY_SOURCE_WEIGHTS = {
  "stable-rules": 30,
  "feedback-insights": 24,
  "codex-sessions": 23,
  "claude-sessions": 22,
  "claude-memories": 20,
  "task-sessions": 22,
  "execution-feedback": 18,
  genes: 16,
  "delegate-suggestions": 14,
};

const QUERY_KIND_WEIGHTS = {
  stable_rule: 8,
  insight_promotable: 7,
  insight_adopted: 6,
  insight_watchlist: 5,
  insight_recent_feedback: 4,
  insight_markdown: 2,
  task_session: 6,
  task_session_overview: 2,
  codex_session: 5,
  codex_session_overview: 2,
  claude_session: 5,
  claude_memory: 4,
  feedback_entry: 4,
  gene: 5,
  delegate_suggestion: 4,
  delegate_suggestion_overview: 1,
};

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "use",
  "with",
  "current",
  "task",
  "find",
]);

const QUERY_PRESET_DEFINITIONS = {
  retrieval: {
    modes: ["query"],
    description: "Start-of-task retrieval across validated rules, compressed feedback, Codex and Claude history, migrated Claude memories, raw feedback, and exported genes.",
    defaults: {
      sources: ["stable-rules", "feedback-insights", "codex-sessions", "claude-memories", "claude-sessions", "task-sessions", "execution-feedback", "genes", "delegate-suggestions"],
      sinceDays: 45,
      limit: 6,
    },
  },
  "promotion-review": {
    modes: ["query-for-promotion", "build-gene-candidate", "build-promotion-packet"],
    description: "Promotion / Gene review around recent evidence without auto-promoting or auto-exporting.",
    defaults: {
      sinceDays: 45,
      limit: 10,
    },
  },
  "post-task-debrief": {
    modes: ["query"],
    description: "Recent feedback-first lookup for post-task reflection and evidence gathering.",
    defaults: {
      sources: ["task-sessions", "codex-sessions", "claude-sessions", "claude-memories", "feedback-insights", "execution-feedback", "stable-rules", "genes", "delegate-suggestions"],
      sinceDays: 14,
      limit: 10,
    },
  },
};

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeTextArray(items) {
  return uniqueStrings(
    (items || []).map((item) => normalizeComparableText(item)).filter(Boolean),
  );
}

function normalizeQuerySource(sourceName) {
  const normalized = String(sourceName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return QUERY_SOURCE_ALIASES[normalized] || null;
}

function resolveQuerySources(rawSources) {
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    return ["stable-rules", "feedback-insights", "codex-sessions", "claude-memories", "claude-sessions", "task-sessions", "execution-feedback", "genes", "delegate-suggestions"];
  }

  const resolved = rawSources.map(normalizeQuerySource);
  const invalidSources = rawSources.filter((source, index) => !resolved[index]);

  if (invalidSources.length > 0) {
    throw new Error(
      `Unknown --source value(s): ${invalidSources.join(", ")}. Allowed sources: stable-rules, feedback-insights, codex-sessions, claude-sessions, claude-memories, task-sessions, execution-feedback, genes, delegate-suggestions.`,
    );
  }

  return uniqueStrings(resolved);
}

function normalizePresetName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function resolveQueryPreset(presetName, mode) {
  if (!presetName) {
    return null;
  }

  const normalized = normalizePresetName(presetName);
  const preset = QUERY_PRESET_DEFINITIONS[normalized];
  if (!preset) {
    throw new Error(
      `Unknown --preset value: ${presetName}. Allowed presets: ${Object.keys(QUERY_PRESET_DEFINITIONS).join(", ")}.`,
    );
  }

  if (!preset.modes.includes(mode)) {
    throw new Error(`Preset "${normalized}" is not supported for mode ${mode}.`);
  }

  return {
    name: normalized,
    ...preset,
  };
}

function applyQueryPreset(rawArgs, mode) {
  const preset = resolveQueryPreset(rawArgs.preset, mode);
  if (!preset) {
    return {
      ...rawArgs,
      appliedPreset: null,
    };
  }

  const defaults = preset.defaults || {};
  return {
    ...rawArgs,
    querySources: rawArgs.querySources.length > 0
      ? rawArgs.querySources
      : Array.isArray(defaults.sources)
        ? defaults.sources.slice()
        : rawArgs.querySources,
    sinceDays: rawArgs.sinceDays !== undefined
      ? rawArgs.sinceDays
      : defaults.sinceDays,
    limit: rawArgs.limitExplicit
      ? rawArgs.limit
      : defaults.limit || rawArgs.limit,
    appliedPreset: preset.name,
  };
}

function extractQuotedPhrases(text) {
  const phrases = [];
  const pattern = /"([^"]+)"/g;
  let match;

  while ((match = pattern.exec(String(text || ""))) !== null) {
    const phrase = normalizeSearchText(match[1]);
    if (phrase) {
      phrases.push(phrase);
    }
  }

  return uniqueStrings(phrases);
}

function normalizeOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized;
}

function normalizeOutcomeFilters(values) {
  const allowed = new Set(["success", "failed", "partial"]);
  const normalized = values.map((value) => normalizeOutcome(value)).filter(Boolean);
  const invalid = normalized.filter((value) => !allowed.has(value));
  if (invalid.length > 0) {
    throw new Error(`Invalid --outcome value(s): ${invalid.join(", ")}. Allowed values: success, failed, partial.`);
  }
  return uniqueStrings(normalized);
}

function parseFilterOptions(options = {}) {
  const sinceDays = options.sinceDays;
  if (sinceDays !== undefined && (!Number.isInteger(sinceDays) || sinceDays < 0)) {
    throw new Error(`Invalid --since-days value: ${sinceDays}. Use a non-negative integer.`);
  }

  return {
    outcomes: normalizeOutcomeFilters(Array.isArray(options.outcomes) ? options.outcomes : []),
    usedInputs: normalizeTextArray(Array.isArray(options.usedInputs) ? options.usedInputs : []),
    taskContains: normalizeComparableText(options.taskContains || ""),
    sinceDays,
  };
}

function extractSearchTerms(text) {
  const normalized = normalizeSearchText(text);
  const latinTerms = normalized.match(/[a-z0-9][a-z0-9._/-]*/g) || [];
  const hanChunks = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const terms = [];

  latinTerms.forEach((term) => {
    if (term.length >= 2 && !QUERY_STOP_WORDS.has(term)) {
      terms.push(term);
    }
  });

  hanChunks.forEach((chunk) => {
    terms.push(chunk);
    if (chunk.length > 2) {
      for (let index = 0; index <= chunk.length - 2; index += 1) {
        terms.push(chunk.slice(index, index + 2));
      }
    }
  });

  return uniqueStrings(terms);
}

function buildQuerySpec(queryText, taskContext) {
  const normalizedQuery = normalizeSearchText(queryText);
  const normalizedTaskContext = normalizeSearchText(taskContext);
  const combined = [normalizedQuery, normalizedTaskContext].filter(Boolean).join(" ");

  return {
    rawQuery: String(queryText || "").trim(),
    rawTaskContext: String(taskContext || "").trim(),
    normalizedQuery,
    phrases: extractQuotedPhrases(`${queryText || ""} ${taskContext || ""}`),
    terms: extractSearchTerms(combined),
  };
}

function slugifyGeneId(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return "gene_candidate";
  }

  return `gene_${normalized}`.slice(0, 80);
}

function slugifySessionId(text, index) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = normalized || `session-${index + 1}`;
  return `task_session_${suffix}`.slice(0, 96);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function parseStableRuleLine(line) {
  const match = line.match(/^- (.+?)(?: \(source: (.*?); promoted: (.*?)\))?$/);
  if (!match) {
    return null;
  }

  const [, ruleText, source = "", promotedAt = ""] = match;
  return {
    ruleText: ruleText.trim(),
    source: source.trim(),
    promotedAt: promotedAt.trim(),
  };
}

function walkFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function normalizeTaskFamily(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_\u4e00-\u9fff]/g, "");
}

function normalizeTaskFamilies(values) {
  return uniqueStrings((Array.isArray(values) ? values : [values])
    .map(normalizeTaskFamily)
    .filter(Boolean));
}

function parseRoutingFamilies(cell) {
  return normalizeTaskFamilies(String(cell || "")
    .split(";")
    .map((item) => item.trim()));
}

function readStableRuleRouting(baseDir) {
  const routingPath = path.join(baseDir, "memory", "stable-rules-routing.md");
  const byFamily = new Map();

  if (!fs.existsSync(routingPath)) {
    return { routingPath, byFamily };
  }

  const lines = fs.readFileSync(routingPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("| ")) {
      return;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) {
      return;
    }

    const lineNumber = Number.parseInt(cells[0], 10);
    parseRoutingFamilies(cells[2]).forEach((family) => {
      if (!byFamily.has(family)) {
        byFamily.set(family, new Set());
      }
      byFamily.get(family).add(lineNumber);
    });
  });

  return { routingPath, byFamily };
}

function resolveStableRuleLineFilter(baseDir, taskFamilies = []) {
  const normalizedFamilies = normalizeTaskFamilies(taskFamilies);
  if (normalizedFamilies.length === 0) {
    return {
      selectedFamilies: [],
      matchedFamilies: [],
      matchedLines: null,
      routingPath: path.join(baseDir, "memory", "stable-rules-routing.md"),
      availableFamilies: [],
    };
  }

  const routing = readStableRuleRouting(baseDir);
  const matchedLines = new Set();
  const matchedFamilies = [];

  normalizedFamilies.forEach((family) => {
    const lines = routing.byFamily.get(family);
    if (!lines) {
      return;
    }
    matchedFamilies.push(family);
    lines.forEach((lineNumber) => matchedLines.add(lineNumber));
  });

  return {
    selectedFamilies: normalizedFamilies,
    matchedFamilies,
    matchedLines,
    routingPath: routing.routingPath,
    availableFamilies: Array.from(routing.byFamily.keys()).sort(),
  };
}

function summarizeStableRuleRouting(lineFilter) {
  const selectedFamilies = Array.isArray(lineFilter.selectedFamilies) ? lineFilter.selectedFamilies : [];
  const matchedFamilies = Array.isArray(lineFilter.matchedFamilies) ? lineFilter.matchedFamilies : [];
  const availableFamilies = Array.isArray(lineFilter.availableFamilies) ? lineFilter.availableFamilies : [];
  const unmatchedFamilies = selectedFamilies.filter((family) => !matchedFamilies.includes(family));
  const warnings = [];

  if (selectedFamilies.length > 0 && availableFamilies.length === 0) {
    warnings.push([
      `No stable-rule task-family routing entries were found at ${lineFilter.routingPath}.`,
      `No stable rules were eligible for the requested task families: ${selectedFamilies.join(", ")}.`,
      "Configure routing mappings or omit --task-family.",
    ].join(" "));
  } else if (unmatchedFamilies.length > 0) {
    warnings.push([
      `Unknown stable-rule task family: ${unmatchedFamilies.join(", ")}.`,
      `Available task families: ${availableFamilies.join(", ")}.`,
      "No stable rules were eligible for the unmatched families.",
    ].join(" "));
  }

  return {
    selected_families: selectedFamilies,
    matched_families: matchedFamilies,
    unmatched_families: unmatchedFamilies,
    available_families: availableFamilies,
    routing_path: lineFilter.routingPath,
    warnings,
  };
}

function collectStableRuleDocs(baseDir, options = {}) {
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  if (!fs.existsSync(stableRulesPath)) {
    return [];
  }

  const lineFilter = options.lineFilter || resolveStableRuleLineFilter(baseDir, options.taskFamilies);
  return fs.readFileSync(stableRulesPath, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().startsWith("- "))
    .filter(({ index }) => {
      if (!lineFilter.matchedLines) {
        return true;
      }
      return lineFilter.matchedLines.has(index + 1);
    })
    .map(({ line, index }) => {
      const parsed = parseStableRuleLine(line.trim());
      if (!parsed) {
        return null;
      }

      return {
        id: `stable-rule-${index + 1}`,
        source: "stable-rules",
        kind: "stable_rule",
        title: parsed.ruleText,
        text: [
          parsed.ruleText,
          parsed.source ? `source: ${parsed.source}` : "",
          parsed.promotedAt ? `promoted: ${parsed.promotedAt}` : "",
        ].filter(Boolean).join("\n"),
        path: stableRulesPath,
        timestamp: parsed.promotedAt || "",
        metadata: {
          rule_source: parsed.source,
          promoted_at: parsed.promotedAt,
          stable_rule_line: index + 1,
          selected_task_families: lineFilter.selectedFamilies,
          matched_task_families: lineFilter.matchedFamilies,
          routing_path: lineFilter.routingPath,
        },
      };
    })
    .filter(Boolean);
}

function collectFeedbackInsightDocs(baseDir) {
  const insightDocs = [];
  const insightsJsonPath = path.join(baseDir, "artifacts", "feedback-insights.json");
  const insightsMarkdownPath = path.join(baseDir, "artifacts", "feedback-insights.md");

  if (fs.existsSync(insightsJsonPath)) {
    const insightsPayload = safeJsonParse(fs.readFileSync(insightsJsonPath, "utf8"));
    if (insightsPayload) {
      const sections = [
        {
          items: Array.isArray(insightsPayload.promotable_guidance) ? insightsPayload.promotable_guidance : [],
          kind: "insight_promotable",
          title: (item) => item.rule_text || "promotable guidance",
          text: (item) => [
            item.rule_text,
            `successful runs: ${item.successful_runs || 0}`,
            `support count: ${item.support_count || 0}`,
            Array.isArray(item.recent_tasks) && item.recent_tasks.length > 0
              ? `recent tasks: ${item.recent_tasks.join("; ")}`
              : "",
          ].filter(Boolean).join("\n"),
          timestamp: (item) => item.last_seen || "",
        },
        {
          items: Array.isArray(insightsPayload.top_adopted_guidance) ? insightsPayload.top_adopted_guidance : [],
          kind: "insight_adopted",
          title: (item) => item.text || "adopted guidance",
          text: (item) => [
            item.text,
            `count: ${item.count || 0}`,
            `success: ${(item.outcomes || {}).success || 0}`,
            `partial: ${(item.outcomes || {}).partial || 0}`,
            `failed: ${(item.outcomes || {}).failed || 0}`,
            Array.isArray(item.tasks) && item.tasks.length > 0
              ? `tasks: ${item.tasks.join("; ")}`
              : "",
          ].filter(Boolean).join("\n"),
          timestamp: (item) => item.last_seen || "",
        },
        {
          items: Array.isArray(insightsPayload.watchlist) ? insightsPayload.watchlist : [],
          kind: "insight_watchlist",
          title: (item) => item.text || "watchlist guidance",
          text: (item) => [
            item.text,
            `count: ${item.count || 0}`,
            `success: ${(item.outcomes || {}).success || 0}`,
            `partial: ${(item.outcomes || {}).partial || 0}`,
            `failed: ${(item.outcomes || {}).failed || 0}`,
            Array.isArray(item.tasks) && item.tasks.length > 0
              ? `tasks: ${item.tasks.join("; ")}`
              : "",
          ].filter(Boolean).join("\n"),
          timestamp: (item) => item.last_seen || "",
        },
        {
          items: Array.isArray(insightsPayload.recent_feedback) ? insightsPayload.recent_feedback : [],
          kind: "insight_recent_feedback",
          title: (item) => item.task || "recent feedback",
          text: (item) => [
            item.task,
            `outcome: ${item.outcome || "partial"}`,
            Array.isArray(item.used_inputs) && item.used_inputs.length > 0
              ? `used inputs: ${item.used_inputs.join(", ")}`
              : "",
            Array.isArray(item.adopted_guidance) && item.adopted_guidance.length > 0
              ? `adopted: ${item.adopted_guidance.join("; ")}`
              : "",
            Array.isArray(item.rejected_guidance) && item.rejected_guidance.length > 0
              ? `rejected: ${item.rejected_guidance.join("; ")}`
              : "",
            item.notes || "",
          ].filter(Boolean).join("\n"),
          timestamp: (item) => item.timestamp || "",
        },
      ];

      sections.forEach((section) => {
        section.items.forEach((item, index) => {
          insightDocs.push({
            id: `${section.kind}-${index + 1}`,
            source: "feedback-insights",
            kind: section.kind,
            title: section.title(item),
            text: section.text(item),
            path: insightsJsonPath,
            timestamp: section.timestamp(item),
            metadata: item,
          });
        });
      });
    }
  }

  if (fs.existsSync(insightsMarkdownPath)) {
    insightDocs.push({
      id: "insight-markdown-overview",
      source: "feedback-insights",
      kind: "insight_markdown",
      title: "Feedback Insights overview",
      text: fs.readFileSync(insightsMarkdownPath, "utf8"),
      path: insightsMarkdownPath,
      timestamp: "",
      metadata: {
        format: "markdown",
      },
    });
  }

  return insightDocs;
}

function collectExecutionFeedbackDocs(baseDir) {
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  return readNdjson(feedbackPath).map((entry, index) => ({
    id: `execution-feedback-${index + 1}`,
    source: "execution-feedback",
    kind: "feedback_entry",
    title: entry.task || "unspecified task",
    text: [
      entry.task || "unspecified task",
      `outcome: ${entry.outcome || "partial"}`,
      Array.isArray(entry.used_inputs) && entry.used_inputs.length > 0
        ? `used inputs: ${entry.used_inputs.join(", ")}`
        : "",
      Array.isArray(entry.adopted_guidance) && entry.adopted_guidance.length > 0
        ? `adopted: ${entry.adopted_guidance.join("; ")}`
        : "",
      Array.isArray(entry.rejected_guidance) && entry.rejected_guidance.length > 0
        ? `rejected: ${entry.rejected_guidance.join("; ")}`
        : "",
      entry.notes || "",
    ].filter(Boolean).join("\n"),
    path: feedbackPath,
    timestamp: entry.timestamp || "",
    metadata: entry,
  }));
}

function extractGuidanceKeys(guidanceItems) {
  return uniqueStrings(
    guidanceItems.map((item) => {
      const normalized = normalizeComparableText(item);
      const words = normalized.split(/\s+/).filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));
      return words.slice(0, 4).join(" ");
    }).filter(Boolean),
  ).slice(0, 6);
}

function extractTaskKeywords(task) {
  return uniqueStrings(
    extractSearchTerms(task).filter((term) => term.length >= 3),
  ).slice(0, 6);
}

function buildTaskSessionRecord(baseDir, entry, index) {
  const timestamp = entry.timestamp || "";
  const task = entry.task || `unspecified task ${index + 1}`;
  const adoptedGuidance = Array.isArray(entry.adopted_guidance) ? entry.adopted_guidance : [];
  const rejectedGuidance = Array.isArray(entry.rejected_guidance) ? entry.rejected_guidance : [];
  const usedInputs = Array.isArray(entry.used_inputs) ? entry.used_inputs : [];
  const outcome = entry.outcome || "partial";
  const notes = entry.notes || "";
  const combinedText = [
    task,
    notes,
    adoptedGuidance.join(" "),
    rejectedGuidance.join(" "),
    usedInputs.join(" "),
  ].join(" ");

  const taskKeywords = extractTaskKeywords(task);
  const guidanceKeys = extractGuidanceKeys(adoptedGuidance.concat(rejectedGuidance));
  const outcomeReasoning = notes
    ? `${outcome}: ${notes.slice(0, 160)}`
    : outcome;
  const retrievalHints = uniqueStrings(
    taskKeywords.concat(guidanceKeys).concat(usedInputs),
  ).slice(0, 10);

  return {
    id: slugifySessionId(`${timestamp}-${task}`, index),
    timestamp,
    task,
    outcome,
    used_inputs: usedInputs,
    adopted_guidance: adoptedGuidance,
    rejected_guidance: rejectedGuidance,
    notes,
    task_keywords: taskKeywords,
    guidance_keys: guidanceKeys,
    outcome_reasoning: outcomeReasoning,
    retrieval_hints: retrievalHints,
    labels: uniqueStrings(
      [outcome].concat(usedInputs).concat(taskKeywords.slice(0, 4)),
    ),
    search_terms: extractSearchTerms(combinedText).slice(0, 14),
    recall_text: [
      task,
      `outcome: ${outcome}`,
      usedInputs.length > 0 ? `used inputs: ${usedInputs.join(", ")}` : "",
      adoptedGuidance.length > 0 ? `adopted: ${adoptedGuidance.join("; ")}` : "",
      rejectedGuidance.length > 0 ? `rejected: ${rejectedGuidance.join("; ")}` : "",
      notes,
      retrievalHints.length > 0 ? `hints: ${retrievalHints.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    source_refs: [
      getWorkspaceRelativePath(baseDir, path.join(baseDir, "memory", "execution-feedback.ndjson")),
    ],
  };
}

function buildTaskSessionIndex(baseDir, options = {}) {
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  const ndjsonPath = path.join(baseDir, "memory", "task-session-index.ndjson");
  const jsonPath = path.join(baseDir, "memory", "task-session-index.json");
  const feedbackEntries = readNdjson(feedbackPath);
  const generatedAt = new Date().toISOString();
  const sessionRecords = feedbackEntries.map((entry, index) => buildTaskSessionRecord(baseDir, entry, index));
  const outcomes = createOutcomeCounts();
  const usedInputStats = new Map();

  sessionRecords.forEach((record) => {
    const outcome = record.outcome || "partial";
    if (!(outcome in outcomes)) {
      outcomes[outcome] = 0;
    }
    outcomes[outcome] += 1;

    record.used_inputs.forEach((input) => {
      usedInputStats.set(input, (usedInputStats.get(input) || 0) + 1);
    });
  });

  fs.writeFileSync(
    ndjsonPath,
    sessionRecords.map((record) => JSON.stringify(record)).join("\n") + (sessionRecords.length > 0 ? "\n" : ""),
    "utf8",
  );

  const overviewPayload = {
    generated_at: generatedAt,
    total_sessions: sessionRecords.length,
    outcomes,
    top_used_inputs: Array.from(usedInputStats.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
    recent_sessions: sessionRecords.slice(-5).reverse().map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      task: record.task,
      outcome: record.outcome,
      used_inputs: record.used_inputs,
    })),
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(overviewPayload, null, 2)}\n`, "utf8");

  if (options.appendEvent !== false) {
    appendEvent(baseDir, {
      type: "task_session_index_built",
      timestamp: generatedAt,
      session_count: sessionRecords.length,
    });
  }

  return {
    generatedAt,
    ndjsonPath,
    jsonPath,
    sessionCount: sessionRecords.length,
    outcomes,
    recentSessions: overviewPayload.recent_sessions,
  };
}

function collectTaskSessionDocs(baseDir) {
  const ndjsonPath = path.join(baseDir, "memory", "task-session-index.ndjson");
  const jsonPath = path.join(baseDir, "memory", "task-session-index.json");
  const docs = readNdjson(ndjsonPath).map((entry, index) => {
    const retrievalHints = Array.isArray(entry.retrieval_hints) ? entry.retrieval_hints : [];
    const guidanceKeys = Array.isArray(entry.guidance_keys) ? entry.guidance_keys : [];
    const taskKeywords = Array.isArray(entry.task_keywords) ? entry.task_keywords : [];
    const extraText = uniqueStrings(retrievalHints.concat(guidanceKeys).concat(taskKeywords)).join(", ");
    return {
      id: entry.id || `task-session-${index + 1}`,
      source: "task-sessions",
      kind: "task_session",
      title: entry.task || `task session ${index + 1}`,
      text: [
        entry.recall_text || entry.task || "",
        entry.outcome_reasoning ? `reasoning: ${entry.outcome_reasoning}` : "",
        extraText ? `retrieval hints: ${extraText}` : "",
      ].filter(Boolean).join("\n"),
      path: ndjsonPath,
      timestamp: entry.timestamp || "",
      metadata: entry,
    };
  });

  if (fs.existsSync(jsonPath)) {
    const overview = safeJsonParse(fs.readFileSync(jsonPath, "utf8"));
    if (overview) {
      docs.push({
        id: "task-session-overview",
        source: "task-sessions",
        kind: "task_session_overview",
        title: "Task session overview",
        text: [
          `total sessions: ${overview.total_sessions || 0}`,
          `success: ${(overview.outcomes || {}).success || 0}`,
          `partial: ${(overview.outcomes || {}).partial || 0}`,
          `failed: ${(overview.outcomes || {}).failed || 0}`,
          Array.isArray(overview.top_used_inputs) && overview.top_used_inputs.length > 0
            ? `top inputs: ${overview.top_used_inputs.map((item) => `${item.name} ${item.count}x`).join("; ")}`
            : "",
        ].filter(Boolean).join("\n"),
        path: jsonPath,
        timestamp: overview.generated_at || "",
        metadata: overview,
      });
    }
  }

  return docs;
}

function collectCodexSessionDocs(baseDir) {
  const ndjsonPath = path.join(baseDir, "memory", "codex-session-index.ndjson");
  const jsonPath = path.join(baseDir, "memory", "codex-session-index.json");
  const docs = readNdjson(ndjsonPath).map((entry, index) => {
    const families = Array.isArray(entry.task_families) ? entry.task_families : [];
    const frictionSignals = Array.isArray(entry.friction_signals) ? entry.friction_signals : [];
    const learningNotes = Array.isArray(entry.learning_notes) ? entry.learning_notes : [];
    return {
      id: entry.id || `codex-session-${index + 1}`,
      source: "codex-sessions",
      kind: "codex_session",
      title: entry.first_user_message || entry.last_user_message || `Codex session ${index + 1}`,
      text: [
        entry.retrieval_text || "",
        entry.cwd ? `cwd: ${entry.cwd}` : "",
        families.length > 0 ? `families: ${families.join(", ")}` : "",
        frictionSignals.length > 0 ? `friction signals: ${frictionSignals.join(", ")}` : "",
        learningNotes.length > 0 ? `learning notes: ${learningNotes.join("; ")}` : "",
        entry.is_change_task ? "change task: yes" : "",
      ].filter(Boolean).join("\n"),
      path: entry.path || ndjsonPath,
      timestamp: entry.updated_at || entry.started_at || "",
      metadata: entry,
    };
  });

  if (fs.existsSync(jsonPath)) {
    const overview = safeJsonParse(fs.readFileSync(jsonPath, "utf8"));
    if (overview) {
      docs.push({
        id: "codex-session-overview",
        source: "codex-sessions",
        kind: "codex_session_overview",
        title: "Codex all-history session overview",
        text: [
          `total sessions: ${overview.total_sessions || 0}`,
          Array.isArray(overview.top_task_families) && overview.top_task_families.length > 0
            ? `top families: ${overview.top_task_families.map((item) => `${item.name} ${item.count}x`).join("; ")}`
            : "",
          Array.isArray(overview.top_friction_signals) && overview.top_friction_signals.length > 0
            ? `friction signals: ${overview.top_friction_signals.map((item) => `${item.name} ${item.count}x`).join("; ")}`
            : "",
        ].filter(Boolean).join("\n"),
        path: jsonPath,
        timestamp: overview.generated_at || "",
        metadata: overview,
      });
    }
  }

  return docs;
}

function collectClaudeSessionDocs(baseDir) {
  const indexPaths = [
    path.join(baseDir, "memory", "claude-session-index.ndjson"),
    path.join(baseDir, "memory", "claude-code-archive-session-index.ndjson"),
    path.join(baseDir, "memory", "claude-export-session-index.ndjson"),
  ];
  const entriesById = new Map();

  indexPaths.forEach((indexPath) => {
    readNdjson(indexPath).forEach((entry, index) => {
      const id = entry.id || `claude-session:${path.basename(indexPath)}:${index + 1}`;
      entriesById.set(id, { entry, indexPath });
    });
  });

  return Array.from(entriesById.entries()).map(([id, item], index) => {
    const entry = item.entry;
    const families = Array.isArray(entry.task_families) ? entry.task_families : [];
    const frictionSignals = Array.isArray(entry.friction_signals) ? entry.friction_signals : [];
    const learningNotes = Array.isArray(entry.learning_notes) ? entry.learning_notes : [];
    return {
      id,
      source: "claude-sessions",
      kind: "claude_session",
      title: entry.first_user_message || entry.last_user_message || entry.title || `Claude session ${index + 1}`,
      text: [
        entry.retrieval_text || "",
        entry.cwd ? `cwd: ${entry.cwd}` : "",
        families.length > 0 ? `families: ${families.join(", ")}` : "",
        frictionSignals.length > 0 ? `friction signals: ${frictionSignals.join(", ")}` : "",
        learningNotes.length > 0 ? `learning notes: ${learningNotes.join("; ")}` : "",
        entry.privacy_class ? `privacy: ${entry.privacy_class}` : "",
      ].filter(Boolean).join("\n"),
      path: entry.path || item.indexPath,
      timestamp: entry.updated_at || entry.started_at || "",
      metadata: entry,
    };
  });
}

function collectClaudeMemoryDocs(baseDir) {
  const indexPath = path.join(baseDir, "memory", "claude-export-memory-index.ndjson");
  return readNdjson(indexPath).map((entry, index) => ({
    id: entry.id || `claude-memory-${index + 1}`,
    source: "claude-memories",
    kind: "claude_memory",
    title: entry.title || entry.virtual_path || `Claude memory ${index + 1}`,
    text: [
      entry.retrieval_text || entry.content || "",
      entry.virtual_path ? `virtual path: ${entry.virtual_path}` : "",
      entry.privacy_class ? `privacy: ${entry.privacy_class}` : "",
    ].filter(Boolean).join("\n"),
    path: entry.path || indexPath,
    timestamp: entry.updated_at || "",
    metadata: entry,
  }));
}

function collectDelegateSuggestionDocs(baseDir) {
  const delegateJsonPath = path.join(baseDir, "artifacts", "delegate-suggestions.json");
  const docs = [];

  if (!fs.existsSync(delegateJsonPath)) {
    return docs;
  }

  const payload = safeJsonParse(fs.readFileSync(delegateJsonPath, "utf8"));
  if (!payload) {
    return docs;
  }

  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
  suggestions.forEach((suggestion, index) => {
    docs.push({
      id: suggestion.id || `delegate-suggestion-${index + 1}`,
      source: "delegate-suggestions",
      kind: "delegate_suggestion",
      title: suggestion.primary_goal || `delegate suggestion ${index + 1}`,
      text: [
        suggestion.primary_goal || "",
        suggestion.suggested_prompt ? `prompt: ${suggestion.suggested_prompt}` : "",
        Array.isArray(suggestion.suggested_steps) && suggestion.suggested_steps.length > 0
          ? `steps: ${suggestion.suggested_steps.join("; ")}`
          : "",
      ].filter(Boolean).join("\n"),
      path: delegateJsonPath,
      timestamp: payload.generated_at || "",
      metadata: suggestion,
    });
  });

  docs.push({
    id: "delegate-suggestions-overview",
    source: "delegate-suggestions",
    kind: "delegate_suggestion_overview",
    title: "Delegate suggestion overview",
    text: [
      `suggestion count: ${suggestions.length}`,
      payload.generated_at ? `generated: ${payload.generated_at}` : "",
      suggestions[0] ? `first suggestion: ${suggestions[0].primary_goal || ""}` : "",
    ].filter(Boolean).join("\n"),
    path: delegateJsonPath,
    timestamp: payload.generated_at || "",
    metadata: payload,
  });

  return docs;
}

function collectGeneDocs(baseDir) {
  const geneDir = path.join(baseDir, "memory", "agent-genes");
  return walkFiles(geneDir).map((filePath, index) => {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = path.extname(filePath).toLowerCase() === ".json"
      ? safeJsonParse(content)
      : null;

    const title = parsed && parsed.id
      ? parsed.id
      : path.basename(filePath);
    const text = parsed
      ? [
        parsed.id || "",
        parsed.summary || "",
        parsed.category ? `category: ${parsed.category}` : "",
        Array.isArray(parsed.signals_match) && parsed.signals_match.length > 0
          ? `signals: ${parsed.signals_match.join("; ")}`
          : "",
        Array.isArray(parsed.preconditions) && parsed.preconditions.length > 0
          ? `preconditions: ${parsed.preconditions.join("; ")}`
          : "",
        Array.isArray(parsed.strategy) && parsed.strategy.length > 0
          ? `strategy: ${parsed.strategy.join("; ")}`
          : "",
        Array.isArray(parsed.validation) && parsed.validation.length > 0
          ? `validation: ${parsed.validation.join("; ")}`
          : "",
      ].filter(Boolean).join("\n")
      : content;

    return {
      id: `gene-${index + 1}`,
      source: "genes",
      kind: "gene",
      title,
      text,
      path: filePath,
      timestamp: "",
      metadata: parsed || {
        file_name: path.basename(filePath),
      },
    };
  });
}

function collectQueryDocuments(baseDir, sourceNames, options = {}) {
  const documents = [];
  const stats = {};

  sourceNames.forEach((sourceName) => {
    let sourceDocs = [];

    if (sourceName === "stable-rules") {
      sourceDocs = collectStableRuleDocs(baseDir, {
        taskFamilies: options.taskFamilies,
        lineFilter: options.stableRuleLineFilter,
      });
    } else if (sourceName === "feedback-insights") {
      sourceDocs = collectFeedbackInsightDocs(baseDir);
    } else if (sourceName === "codex-sessions") {
      sourceDocs = collectCodexSessionDocs(baseDir);
    } else if (sourceName === "claude-sessions") {
      sourceDocs = collectClaudeSessionDocs(baseDir);
    } else if (sourceName === "claude-memories") {
      sourceDocs = collectClaudeMemoryDocs(baseDir);
    } else if (sourceName === "task-sessions") {
      sourceDocs = collectTaskSessionDocs(baseDir);
    } else if (sourceName === "execution-feedback") {
      sourceDocs = collectExecutionFeedbackDocs(baseDir);
    } else if (sourceName === "genes") {
      sourceDocs = collectGeneDocs(baseDir);
    } else if (sourceName === "delegate-suggestions") {
      sourceDocs = collectDelegateSuggestionDocs(baseDir);
    }

    stats[sourceName] = sourceDocs.length;
    documents.push(...sourceDocs);
  });

  return { documents, stats };
}

function timestampWithinDays(timestamp, sinceDays) {
  if (sinceDays === undefined) {
    return true;
  }

  const parsed = Date.parse(timestamp || "");
  if (Number.isNaN(parsed)) {
    return false;
  }

  const ageMs = Date.now() - parsed;
  return ageMs <= (sinceDays * 24 * 60 * 60 * 1000);
}

function documentMatchesOutcome(doc, outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return true;
  }

  const metadata = doc.metadata || {};
  const singleOutcome = normalizeOutcome(metadata.outcome);
  if (singleOutcome) {
    return outcomes.includes(singleOutcome);
  }

  if (metadata.outcomes && typeof metadata.outcomes === "object") {
    return outcomes.some((outcome) => Number(metadata.outcomes[outcome] || 0) > 0);
  }

  if (doc.kind === "insight_promotable") {
    return outcomes.includes("success") && Number(metadata.successful_runs || 0) > 0;
  }

  return false;
}

function documentMatchesUsedInputs(doc, usedInputs) {
  if (!Array.isArray(usedInputs) || usedInputs.length === 0) {
    return true;
  }

  const metadata = doc.metadata || {};
  const docInputs = normalizeTextArray(metadata.used_inputs);
  if (docInputs.length === 0) {
    return false;
  }

  return usedInputs.every((input) => docInputs.includes(input));
}

function documentMatchesTask(doc, taskContains) {
  if (!taskContains) {
    return true;
  }

  const metadata = doc.metadata || {};
  const directTask = normalizeComparableText(metadata.task || doc.title || "");
  if (directTask.includes(taskContains)) {
    return true;
  }

  const tasks = Array.isArray(metadata.tasks) ? metadata.tasks : [];
  return tasks.some((task) => normalizeComparableText(task).includes(taskContains));
}

function documentMatchesFilters(doc, filters) {
  if (!timestampWithinDays(doc.timestamp, filters.sinceDays)) {
    return false;
  }

  if (!documentMatchesOutcome(doc, filters.outcomes)) {
    return false;
  }

  if (!documentMatchesUsedInputs(doc, filters.usedInputs)) {
    return false;
  }

  if (!documentMatchesTask(doc, filters.taskContains)) {
    return false;
  }

  return true;
}

function recencyBoost(timestamp) {
  const parsed = Date.parse(timestamp || "");
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
  if (ageDays <= 7) {
    return 6;
  }
  if (ageDays <= 30) {
    return 4;
  }
  if (ageDays <= 90) {
    return 2;
  }

  return 0;
}

function buildExcerpt(text, querySpec, maxLength = 220) {
  const rawText = String(text || "").replace(/\s+/g, " ").trim();
  if (!rawText) {
    return "";
  }

  const candidates = uniqueStrings([
    querySpec.normalizedQuery,
    ...querySpec.phrases,
    ...querySpec.terms,
  ]).sort((left, right) => right.length - left.length);

  const lowerText = rawText.toLowerCase();
  let matchIndex = -1;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    matchIndex = lowerText.indexOf(candidate);
    if (matchIndex !== -1) {
      break;
    }
  }

  if (matchIndex === -1 || rawText.length <= maxLength) {
    return rawText.slice(0, maxLength);
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(rawText.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < rawText.length ? "..." : "";
  return `${prefix}${rawText.slice(start, end)}${suffix}`;
}

function scoreDocument(doc, querySpec) {
  const title = normalizeSearchText(doc.title);
  const body = normalizeSearchText(doc.text);
  const metadataText = normalizeSearchText(JSON.stringify(doc.metadata || {}));
  const haystack = [title, body, metadataText].filter(Boolean).join(" ");
  const matchedTerms = [];
  let matchScore = 0;

  if (querySpec.normalizedQuery && haystack.includes(querySpec.normalizedQuery)) {
    matchScore += 26;
    matchedTerms.push(querySpec.normalizedQuery);
  }

  querySpec.phrases.forEach((phrase) => {
    if (haystack.includes(phrase)) {
      matchScore += 18;
      matchedTerms.push(phrase);
    }
  });

  querySpec.terms.forEach((term) => {
    if (!term) {
      return;
    }

    if (title.includes(term)) {
      matchScore += term.length >= 6 ? 12 : 8;
      matchedTerms.push(term);
      return;
    }

    if (body.includes(term) || metadataText.includes(term)) {
      matchScore += term.length >= 6 ? 7 : 5;
      matchedTerms.push(term);
    }
  });

  const uniqueMatchedTerms = uniqueStrings(matchedTerms);
  if (matchScore === 0 || uniqueMatchedTerms.length === 0) {
    return null;
  }

  const score = matchScore
    + (QUERY_SOURCE_WEIGHTS[doc.source] || 0)
    + (QUERY_KIND_WEIGHTS[doc.kind] || 0)
    + recencyBoost(doc.timestamp);

  return {
    ...doc,
    score,
    matched_terms: uniqueMatchedTerms,
    excerpt: buildExcerpt(doc.text, querySpec),
  };
}

function uniqueByNormalizedTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeComparableText(item.title);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatAppliedFilters(filters) {
  const parts = [];
  if (filters.outcomes.length > 0) {
    parts.push(`outcome=${filters.outcomes.join(",")}`);
  }
  if (filters.usedInputs.length > 0) {
    parts.push(`used-input=${filters.usedInputs.join(",")}`);
  }
  if (filters.taskContains) {
    parts.push(`task-contains=${filters.taskContains}`);
  }
  if (filters.sinceDays !== undefined) {
    parts.push(`since-days=${filters.sinceDays}`);
  }
  return parts;
}

function buildQuerySummary(querySpec, results, filters, presetName, options = {}) {
  const stableRules = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "stable-rules"),
  ).slice(0, 3);
  const highSignalGuidance = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "feedback-insights")
      .filter((item) => item.kind === "insight_promotable" || item.kind === "insight_adopted"),
  ).slice(0, 3);
  const riskChecks = uniqueByNormalizedTitle(
    results.filter((item) => {
      const outcome = (item.metadata || {}).outcome || "";
      return item.kind === "insight_watchlist" || outcome === "failed" || outcome === "partial";
    }),
  ).slice(0, 3);
  const supportingFeedback = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "execution-feedback" || item.kind === "insight_recent_feedback"),
  ).slice(0, 3);
  const pastSessions = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "task-sessions" && item.kind === "task_session"),
  ).slice(0, 3);
  const codexSessions = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "codex-sessions" && item.kind === "codex_session"),
  ).slice(0, 3);
  const geneCandidates = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "genes"),
  ).slice(0, 3);
  const delegateSuggestions = uniqueByNormalizedTitle(
    results.filter((item) => item.source === "delegate-suggestions" && item.kind === "delegate_suggestion"),
  ).slice(0, 3);

  const suggestedNextSteps = uniqueStrings([
    stableRules[0] ? `Apply the validated rule first: ${stableRules[0].title}` : "",
    highSignalGuidance[0] ? `Cross-check this high-signal guidance against the current task: ${highSignalGuidance[0].title}` : "",
    pastSessions[0] ? `Reuse the closest past task/session before starting from scratch: ${pastSessions[0].title}` : "",
    codexSessions[0] ? `Inspect the closest all-history Codex session before assuming this is new: ${codexSessions[0].title}` : "",
    riskChecks[0] ? `Verify or avoid this risky guidance before reuse: ${riskChecks[0].title}` : "",
    geneCandidates[0] ? `Inspect the closest existing gene before inventing a new pattern: ${geneCandidates[0].title}` : "",
    delegateSuggestions[0] ? `Translate the nearest delegate suggestion into an explicit local worker prompt: ${delegateSuggestions[0].title}` : "",
  ]).slice(0, 4);

  const markdownLines = [
    "# Hybrid Query Summary",
    "",
    `Query: ${querySpec.rawQuery || "(empty)"}`,
  ];

  if (presetName) {
    markdownLines.push(`Preset: ${presetName}`);
  }
  if (options.taskFamilies && options.taskFamilies.length > 0) {
    markdownLines.push(`Task Families: ${options.taskFamilies.join(", ")}`);
  }

  if (querySpec.rawTaskContext) {
    markdownLines.push(`Task Context: ${querySpec.rawTaskContext}`);
  }

  const appliedFilters = formatAppliedFilters(filters);
  if (appliedFilters.length > 0) {
    markdownLines.push(`Filters: ${appliedFilters.join(" | ")}`);
  }

  const warnings = Array.isArray(options.warnings) ? options.warnings : [];
  if (warnings.length > 0) {
    markdownLines.push("", "## Warnings");
    warnings.forEach((warning) => {
      markdownLines.push(`- ${warning}`);
    });
  }

  markdownLines.push("", "## Layer A — Validated Stable Guidance");
  markdownLines.push("Trust level: HIGH — survived real tasks and explicit human promotion.");
  if (stableRules.length === 0) {
    markdownLines.push("- No matching stable rule was found.");
  } else {
    stableRules.forEach((item) => {
      markdownLines.push(`- [stable-rule] ${item.title}`);
    });
  }

  markdownLines.push("", "## Layer B — Compressed High-Signal Guidance");
  markdownLines.push("Trust level: MEDIUM — repeated success in feedback but not yet promoted to stable.");
  if (highSignalGuidance.length === 0) {
    markdownLines.push("- No high-signal guidance matched.");
  } else {
    highSignalGuidance.forEach((item) => {
      const count = (item.metadata || {}).count || "?";
      markdownLines.push(`- [high-signal ${count}x] ${item.title}`);
    });
  }

  markdownLines.push("", "## Layer C — Verify / Avoid");
  markdownLines.push("Trust level: LOW — rejected or correlated with failures.");
  if (riskChecks.length === 0) {
    markdownLines.push("- No repeated risky guidance was matched.");
  } else {
    riskChecks.forEach((item) => {
      markdownLines.push(`- ${item.title}`);
    });
  }

  markdownLines.push("", "## Analogous Past Sessions");
  markdownLines.push("Trust level: CONTEXTUAL — similar tasks, not direct rules.");
  if (pastSessions.length === 0) {
    markdownLines.push("- No matching task/session recall entry was found.");
  } else {
    pastSessions.forEach((item) => {
      const outcome = (item.metadata || {}).outcome || "n/a";
      const hints = Array.isArray((item.metadata || {}).retrieval_hints)
        ? (item.metadata || {}).retrieval_hints.slice(0, 4).join(", ")
        : "";
      markdownLines.push(`- ${item.title} [${outcome}]${hints ? " — hints: " + hints : ""}`);
    });
  }

  markdownLines.push("", "## All-History Codex Sessions");
  markdownLines.push("Trust level: RECALL — compressed historical sessions, not promoted rules.");
  if (codexSessions.length === 0) {
    markdownLines.push("- No matching all-history Codex session entry was found.");
  } else {
    codexSessions.forEach((item) => {
      const families = Array.isArray((item.metadata || {}).task_families)
        ? (item.metadata || {}).task_families.slice(0, 4).join(", ")
        : "";
      const signals = Array.isArray((item.metadata || {}).friction_signals)
        ? (item.metadata || {}).friction_signals.slice(0, 4).join(", ")
        : "";
      markdownLines.push(`- ${item.title}${families ? " — families: " + families : ""}${signals ? " — signals: " + signals : ""}`);
    });
  }

  markdownLines.push("", "## Supporting Evidence");
  if (supportingFeedback.length === 0) {
    markdownLines.push("- No matching execution feedback entry was found.");
  } else {
    supportingFeedback.forEach((item) => {
      const outcome = (item.metadata || {}).outcome || "n/a";
      markdownLines.push(`- ${item.title} [${outcome}]`);
    });
  }

  markdownLines.push("", "## Gene Candidates");
  if (geneCandidates.length === 0) {
    markdownLines.push("- No matching exported gene was found.");
  } else {
    geneCandidates.forEach((item) => {
      markdownLines.push(`- ${item.title}`);
    });
  }

  markdownLines.push("", "## Delegate Suggestions");
  markdownLines.push("Trust level: TRANSLATION — local restatement of host-only directives, not executed.");
  if (delegateSuggestions.length === 0) {
    markdownLines.push("- No matching delegate suggestion was found.");
  } else {
    delegateSuggestions.forEach((item) => {
      markdownLines.push(`- ${item.title}`);
    });
  }

  markdownLines.push("", "## Suggested Next Steps");
  if (suggestedNextSteps.length === 0) {
    markdownLines.push("- No direct next step could be synthesized from the current hits.");
  } else {
    suggestedNextSteps.forEach((step) => {
      markdownLines.push(`- ${step}`);
    });
  }

  return {
    apply_first: uniqueStrings(
      stableRules.map((item) => item.title).concat(highSignalGuidance.map((item) => item.title)),
    ),
    verify_or_avoid: riskChecks.map((item) => item.title),
    supporting_feedback: supportingFeedback.map((item) => ({
      task: item.title,
      outcome: (item.metadata || {}).outcome || "n/a",
    })),
    past_sessions: pastSessions.map((item) => ({
      task: item.title,
      outcome: (item.metadata || {}).outcome || "n/a",
    })),
    codex_sessions: codexSessions.map((item) => ({
      task: item.title,
      families: (item.metadata || {}).task_families || [],
      signals: (item.metadata || {}).friction_signals || [],
    })),
    gene_candidates: geneCandidates.map((item) => item.title),
    delegate_suggestions: delegateSuggestions.map((item) => item.title),
    suggested_next_steps: suggestedNextSteps,
    applied_filters: appliedFilters,
    warnings,
    markdown: markdownLines.join("\n"),
  };
}

function queryHybridMemory(baseDir, queryText, options = {}) {
  const query = String(queryText || "").trim();
  if (!query) {
    throw new Error("Missing required argument: --query");
  }

  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, 20)
    : 8;
  const sourceNames = resolveQuerySources(options.sources);
  const filters = parseFilterOptions(options);
  const taskFamilies = normalizeTaskFamilies(options.taskFamilies || []);
  const stableRuleLineFilter = sourceNames.includes("stable-rules")
    ? resolveStableRuleLineFilter(baseDir, taskFamilies)
    : resolveStableRuleLineFilter(baseDir, []);
  const taskFamilyRouting = summarizeStableRuleRouting(stableRuleLineFilter);
  const warnings = taskFamilyRouting.warnings;
  const querySpec = buildQuerySpec(query, options.taskContext || "");
  const { documents, stats } = collectQueryDocuments(baseDir, sourceNames, {
    taskFamilies,
    stableRuleLineFilter,
  });
  const scoredResults = documents
    .filter((doc) => documentMatchesFilters(doc, filters))
    .map((doc) => scoreDocument(doc, querySpec))
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    });
  const results = scoredResults.slice(0, limit).map((item) => ({
    id: item.id,
    source: item.source,
    kind: item.kind,
    title: item.title,
    score: item.score,
    matched_terms: item.matched_terms,
    path: item.path,
    timestamp: item.timestamp || "",
    excerpt: item.excerpt,
    metadata: item.metadata,
  }));
  const summary = buildQuerySummary(querySpec, results, filters, options.preset || "", {
    taskFamilies,
    warnings,
  });
  const queriedAt = new Date().toISOString();

  appendEvent(baseDir, {
    type: "memory_query",
    timestamp: queriedAt,
    query,
    task_context: options.taskContext || "",
    preset: options.preset || "",
    task_families: taskFamilies,
    task_family_routing: taskFamilyRouting,
    warnings,
    sources: sourceNames,
    filters,
    result_count: results.length,
  });

  return {
    queried_at: queriedAt,
    query,
    task_context: options.taskContext || "",
    preset: options.preset || "",
    task_families: taskFamilies,
    task_family_routing: taskFamilyRouting,
    warnings,
    sources: sourceNames,
    indexed_documents: stats,
    filters,
    result_count: results.length,
    results,
    summary,
  };
}

function scorePromotionCandidate(candidate, querySpec) {
  if (!querySpec || (!querySpec.normalizedQuery && querySpec.terms.length === 0 && querySpec.phrases.length === 0)) {
    return (
      (candidate.successful_runs * 20)
      + (candidate.support_count * 10)
      - (candidate.failed_runs * 8)
      - (candidate.partial_runs * 4)
      + recencyBoost(candidate.last_seen)
    );
  }

  const doc = {
    source: "feedback-insights",
    kind: "insight_promotable",
    title: candidate.rule_text,
    text: [
      candidate.rule_text,
      candidate.reasoning,
      candidate.recent_tasks.join("; "),
      candidate.evidence.map((item) => `${item.task} ${item.outcome} ${item.notes}`).join("\n"),
    ].join("\n"),
    metadata: {
      successful_runs: candidate.successful_runs,
      outcomes: {
        success: candidate.successful_runs,
        partial: candidate.partial_runs,
        failed: candidate.failed_runs,
      },
      tasks: candidate.recent_tasks,
    },
    timestamp: candidate.last_seen,
  };

  const scored = scoreDocument(doc, querySpec);
  if (!scored) {
    return null;
  }

  return scored.score
    + (candidate.successful_runs * 8)
    - (candidate.failed_runs * 6)
    - (candidate.partial_runs * 3);
}

function classifyPromotionCandidate(candidate) {
  if (candidate.already_promoted) {
    return "already-promoted";
  }

  if (candidate.failed_runs > 0 || candidate.partial_runs > 0) {
    return "review-first";
  }

  if (candidate.successful_runs >= 2) {
    return "ready-now";
  }

  return "needs-more-validation";
}

function buildPromotionSummary(queryText, filters, candidates, presetName) {
  const readyNow = candidates.filter((candidate) => candidate.status === "ready-now").slice(0, 5);
  const reviewFirst = candidates.filter((candidate) => candidate.status === "review-first").slice(0, 5);
  const needsMoreValidation = candidates.filter((candidate) => candidate.status === "needs-more-validation").slice(0, 5);

  const markdownLines = [
    "# Promotion Query Summary",
    "",
    `Query: ${queryText || "(all promotable guidance)"}`,
  ];

  if (presetName) {
    markdownLines.push(`Preset: ${presetName}`);
  }

  const appliedFilters = formatAppliedFilters(filters);
  if (appliedFilters.length > 0) {
    markdownLines.push(`Filters: ${appliedFilters.join(" | ")}`);
  }

  markdownLines.push("", "## Ready Now");
  if (readyNow.length === 0) {
    markdownLines.push("- No candidate cleared the current promotion threshold.");
  } else {
    readyNow.forEach((candidate) => {
      markdownLines.push(`- ${candidate.rule_text} (success ${candidate.successful_runs}, support ${candidate.support_count})`);
    });
  }

  markdownLines.push("", "## Review First");
  if (reviewFirst.length === 0) {
    markdownLines.push("- No risky candidate was matched.");
  } else {
    reviewFirst.forEach((candidate) => {
      markdownLines.push(`- ${candidate.rule_text} (success ${candidate.successful_runs}, partial ${candidate.partial_runs}, failed ${candidate.failed_runs})`);
    });
  }

  markdownLines.push("", "## Needs More Validation");
  if (needsMoreValidation.length === 0) {
    markdownLines.push("- No candidate is sitting in the single-win holding area.");
  } else {
    needsMoreValidation.forEach((candidate) => {
      markdownLines.push(`- ${candidate.rule_text} (success ${candidate.successful_runs}, support ${candidate.support_count})`);
    });
  }

  markdownLines.push("", "## Suggested Next Steps");
  if (readyNow.length > 0) {
    markdownLines.push(`- Review the evidence for "${readyNow[0].rule_text}" and promote it manually if the underlying tasks still generalize.`);
  } else if (reviewFirst.length > 0) {
    markdownLines.push(`- Do not promote "${reviewFirst[0].rule_text}" yet; inspect the mixed outcomes first.`);
  } else if (needsMoreValidation.length > 0) {
    markdownLines.push(`- Reuse "${needsMoreValidation[0].rule_text}" in another real task before promoting it.`);
  } else {
    markdownLines.push("- No promotion action is recommended yet.");
  }

  return {
    ready_now: readyNow.map((candidate) => candidate.rule_text),
    review_first: reviewFirst.map((candidate) => candidate.rule_text),
    needs_more_validation: needsMoreValidation.map((candidate) => candidate.rule_text),
    applied_filters: appliedFilters,
    markdown: markdownLines.join("\n"),
  };
}

function queryPromotionCandidates(baseDir, queryText, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, 20)
    : 8;
  const filters = parseFilterOptions(options);
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  const feedbackEntries = readNdjson(feedbackPath);
  const stableRulesContent = fs.existsSync(stableRulesPath)
    ? fs.readFileSync(stableRulesPath, "utf8")
    : "";
  const stableRuleKeys = new Set(
    extractStableRuleTexts(stableRulesContent).map((rule) => normalizeComparableText(rule)),
  );
  const filteredEntries = feedbackEntries.filter((entry) => documentMatchesFilters({
    metadata: entry,
    timestamp: entry.timestamp || "",
    title: entry.task || "",
    kind: "feedback_entry",
    source: "execution-feedback",
  }, filters));
  const adoptedStats = collectGuidanceStats(filteredEntries, "adopted_guidance");
  const querySpec = buildQuerySpec(queryText || "", "");

  const candidates = adoptedStats.map((stat) => {
    const normalizedRule = normalizeComparableText(stat.text);
    const evidence = filteredEntries
      .filter((entry) => Array.isArray(entry.adopted_guidance)
        && entry.adopted_guidance.some((item) => normalizeComparableText(item) === normalizedRule))
      .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
      .slice(0, 5)
      .map((entry) => ({
        timestamp: entry.timestamp || "",
        task: entry.task || "unspecified task",
        outcome: entry.outcome || "partial",
        used_inputs: Array.isArray(entry.used_inputs) ? entry.used_inputs : [],
        notes: entry.notes || "",
      }));

    const candidate = {
      rule_text: stat.text,
      support_count: stat.count,
      successful_runs: stat.outcomes.success || 0,
      partial_runs: stat.outcomes.partial || 0,
      failed_runs: stat.outcomes.failed || 0,
      last_seen: stat.last_seen || "",
      recent_tasks: stat.tasks.slice(0, 5),
      already_promoted: stableRuleKeys.has(normalizedRule),
      evidence,
      reasoning: evidence.length > 0
        ? evidence.map((item) => `${item.task} [${item.outcome}]`).join("; ")
        : "",
    };

    candidate.status = classifyPromotionCandidate(candidate);
    candidate.score = scorePromotionCandidate(candidate, querySpec);
    return candidate;
  }).filter((candidate) => !candidate.already_promoted)
    .filter((candidate) => candidate.score !== null);

  candidates.sort((left, right) => {
    const statusOrder = {
      "ready-now": 0,
      "review-first": 1,
      "needs-more-validation": 2,
    };
    const leftOrder = statusOrder[left.status] ?? 99;
    const rightOrder = statusOrder[right.status] ?? 99;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    if ((right.score || 0) !== (left.score || 0)) {
      return (right.score || 0) - (left.score || 0);
    }
    return left.rule_text.localeCompare(right.rule_text);
  });

  const results = candidates.slice(0, limit);
  const summary = buildPromotionSummary(queryText || "", filters, results, options.preset || "");
  const queriedAt = new Date().toISOString();

  appendEvent(baseDir, {
    type: "promotion_query",
    timestamp: queriedAt,
    query: queryText || "",
    preset: options.preset || "",
    filters,
    result_count: results.length,
  });

  return {
    queried_at: queriedAt,
    query: queryText || "",
    preset: options.preset || "",
    filters,
    scanned_feedback_entries: filteredEntries.length,
    stable_rules_count: stableRuleKeys.size,
    result_count: results.length,
    results,
    summary,
  };
}

function inferGeneCategory(candidate) {
  const text = normalizeComparableText([
    candidate.rule_text,
    candidate.reasoning,
    candidate.recent_tasks.join(" "),
  ].join(" "));

  if (/(fix|error|repair|failed|corrupt|collision|rollback|稳定|修复|报错|失败)/.test(text)) {
    return "repair";
  }

  if (/(keep|read|query|review|narrow|bridge|hybrid|retrieve|retrieval|filter|harden|optimize|refine|复盘|收敛|检索|桥接|读取|查询|增强)/.test(text)) {
    return "optimize";
  }

  if (/(new|innovate|feature|opportunity|create|新增|创新|能力)/.test(text)) {
    return "innovate";
  }

  return "optimize";
}

function buildGeneSignals(candidate) {
  const combined = [
    candidate.rule_text,
    candidate.reasoning,
    candidate.recent_tasks.join(" "),
  ].join(" ");
  const terms = extractSearchTerms(combined)
    .filter((term) => term.length >= 3 || /[\u4e00-\u9fff]/.test(term))
    .slice(0, 8);

  if (terms.length > 0) {
    return terms;
  }

  return [candidate.rule_text].filter(Boolean);
}

function buildGenePreconditions(candidate) {
  const preconditions = ["hybrid artifacts already exist and can be queried"];
  const usedInputs = uniqueStrings(candidate.evidence.flatMap((item) => item.used_inputs || []));

  if (usedInputs.includes("stable-rules")) {
    preconditions.push("stable-rules.md has been reviewed before applying fresh guidance");
  }
  if (usedInputs.includes("feedback-insights")) {
    preconditions.push("feedback-insights confirm repeated success or useful compression");
  }
  if (usedInputs.includes("execution-feedback")) {
    preconditions.push("underlying execution-feedback entries support the guidance");
  }

  if (candidate.successful_runs >= 2) {
    preconditions.push("the guidance has survived at least two successful real tasks");
  }

  return preconditions.slice(0, 5);
}

function buildGeneStrategy(candidate) {
  return [
    "Query hybrid memory and review stable rules before acting on fresh guidance",
    `Apply this guidance in the current task: ${candidate.rule_text}`,
    "Keep the change narrow, reversible, and grounded in current repository reality",
    "Validate with the smallest relevant repo-specific checks before concluding success",
    "Record execution feedback and only export the Gene after the pattern remains reusable",
  ];
}

function shellQuote(text) {
  return JSON.stringify(String(text || ""));
}

function getBridgeWorkspaceDir(baseDir) {
  return path.resolve(baseDir, "..");
}

function getWorkspaceRelativePath(baseDir, targetPath) {
  const workspaceDir = getBridgeWorkspaceDir(baseDir);
  const relativePath = path.relative(workspaceDir, targetPath).replace(/\\/g, "/");
  return relativePath || path.basename(targetPath);
}

function buildGeneValidation(baseDir, candidate, geneId) {
  const bridgeScriptPath = path.join(getBridgeWorkspaceDir(baseDir), "scripts", "evolver_codex_bridge.js");
  const bridgeScript = getWorkspaceRelativePath(baseDir, bridgeScriptPath);
  const commands = [];
  const combinedText = normalizeComparableText([
    candidate.rule_text,
    candidate.reasoning,
    candidate.recent_tasks.join(" "),
  ].join(" "));

  if (fs.existsSync(bridgeScriptPath)) {
    commands.push(`node --check ${bridgeScript}`);
  }

  commands.push(
    `node ${bridgeScript} --query-for-promotion ${shellQuote(candidate.rule_text)} --preset promotion-review --since-days 45`,
  );

  if (/(query|retrieve|retrieval|filter|feedback|insight|hybrid|bridge|memory|读取|查询|检索|桥接)/.test(combinedText)) {
    commands.push(
      `node ${bridgeScript} --query ${shellQuote(candidate.rule_text)} --preset retrieval --task-context ${shellQuote("reuse this guidance in the current hybrid bridge task")} --format markdown`,
    );
  }

  if (candidate.successful_runs >= 1) {
    commands.push(
      `node ${bridgeScript} --build-promotion-packet ${shellQuote(candidate.rule_text)} --preset promotion-review --format markdown`,
    );
  }

  return uniqueStrings(commands).slice(0, 4).concat(
    commands.length === 0
      ? [`# Add a repo-specific validation command before exporting ${geneId}`]
      : [],
  );
}

function createEvidenceRowsFromEntries(entries) {
  return entries
    .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
    .slice(0, 5)
    .map((entry) => ({
      timestamp: entry.timestamp || "",
      task: entry.task || "unspecified task",
      outcome: entry.outcome || "partial",
      used_inputs: Array.isArray(entry.used_inputs) ? entry.used_inputs : [],
      notes: entry.notes || "",
    }));
}

function buildCandidateFromGuidanceText(baseDir, guidanceText) {
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  const normalizedGuidance = normalizeComparableText(guidanceText);
  const feedbackEntries = readNdjson(feedbackPath);
  const matchingEntries = feedbackEntries.filter((entry) => Array.isArray(entry.adopted_guidance)
    && entry.adopted_guidance.some((item) => normalizeComparableText(item) === normalizedGuidance));
  const outcomes = createOutcomeCounts();

  matchingEntries.forEach((entry) => {
    const outcome = normalizeOutcome(entry.outcome || "partial") || "partial";
    if (!(outcome in outcomes)) {
      outcomes[outcome] = 0;
    }
    outcomes[outcome] += 1;
  });

  const evidence = createEvidenceRowsFromEntries(matchingEntries);
  return {
    rule_text: guidanceText,
    support_count: matchingEntries.length,
    successful_runs: outcomes.success || 0,
    partial_runs: outcomes.partial || 0,
    failed_runs: outcomes.failed || 0,
    last_seen: evidence[0] ? evidence[0].timestamp : "",
    recent_tasks: uniqueStrings(evidence.map((item) => item.task)).slice(0, 5),
    evidence,
    reasoning: evidence.length > 0
      ? evidence.map((item) => `${item.task} [${item.outcome}]`).join("; ")
      : "",
  };
}

function buildGeneRefreshMarkdown(refreshedGene, candidate, refreshedAt, sourcePath) {
  const markdownLines = [
    "# Gene Refresh",
    "",
    `Gene ID: ${refreshedGene.id || "unknown"}`,
    `Summary: ${refreshedGene.summary || ""}`,
    `Refreshed: ${refreshedAt}`,
    `Path: ${sourcePath}`,
    "",
    "## Evidence Snapshot",
    `- Successful runs: ${candidate.successful_runs}`,
    `- Partial runs: ${candidate.partial_runs}`,
    `- Failed runs: ${candidate.failed_runs}`,
    `- Support count: ${candidate.support_count}`,
    "",
    "## Updated Validation",
  ];

  (refreshedGene.validation || []).forEach((command) => {
    markdownLines.push(`- ${command}`);
  });

  return markdownLines.join("\n");
}

function refreshGene(baseDir, geneFile) {
  const sourcePath = path.resolve(geneFile);
  if (path.extname(sourcePath).toLowerCase() !== ".json") {
    throw new Error("refresh-gene currently supports JSON Gene files only.");
  }

  const existingGene = safeJsonParse(fs.readFileSync(sourcePath, "utf8"));
  if (!existingGene || existingGene.type !== "Gene") {
    throw new Error(`Invalid Gene JSON: ${sourcePath}`);
  }

  const summary = String(existingGene.summary || existingGene.id || "").trim();
  if (!summary) {
    throw new Error(`Gene is missing summary/id text: ${sourcePath}`);
  }

  const geneId = existingGene.id || slugifyGeneId(summary);
  const candidate = buildCandidateFromGuidanceText(baseDir, summary);
  const refreshedGene = {
    ...existingGene,
    id: geneId,
    summary,
    category: existingGene.category || inferGeneCategory(candidate),
    signals_match: Array.isArray(existingGene.signals_match) && existingGene.signals_match.length > 0
      ? existingGene.signals_match
      : buildGeneSignals(candidate),
    preconditions: uniqueStrings(
      []
        .concat(Array.isArray(existingGene.preconditions) ? existingGene.preconditions : [])
        .concat(buildGenePreconditions(candidate)),
    ).slice(0, 6),
    strategy: Array.isArray(existingGene.strategy) && existingGene.strategy.length > 0
      ? existingGene.strategy
      : buildGeneStrategy(candidate),
    validation: buildGeneValidation(baseDir, candidate, geneId),
  };

  fs.writeFileSync(sourcePath, `${JSON.stringify(refreshedGene, null, 2)}\n`, "utf8");
  const refreshedAt = new Date().toISOString();

  appendEvent(baseDir, {
    type: "gene_refreshed",
    timestamp: refreshedAt,
    gene_id: geneId,
    source_path: sourcePath,
    matched_feedback_entries: candidate.evidence.length,
  });

  return {
    refreshed_at: refreshedAt,
    source_path: sourcePath,
    gene: refreshedGene,
    evidence: candidate.evidence,
    markdown: buildGeneRefreshMarkdown(refreshedGene, candidate, refreshedAt, sourcePath),
  };
}

function writeGeneCandidateArtifacts(baseDir, geneId, payload, markdown) {
  const candidateDir = path.join(baseDir, "artifacts", "gene-candidates");
  ensureDir(candidateDir);

  const jsonPath = path.join(candidateDir, `${geneId}.json`);
  const markdownPath = path.join(candidateDir, `${geneId}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  return { jsonPath, markdownPath };
}

function readGeneCandidateArtifacts(baseDir, geneId) {
  const candidateDir = path.join(baseDir, "artifacts", "gene-candidates");
  const jsonPath = path.join(candidateDir, `${geneId}.json`);
  const markdownPath = path.join(candidateDir, `${geneId}.md`);

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    return null;
  }

  return {
    jsonPath,
    markdownPath,
    gene: safeJsonParse(fs.readFileSync(jsonPath, "utf8")),
    markdown: fs.readFileSync(markdownPath, "utf8"),
  };
}

function buildGeneCandidate(baseDir, queryText, options = {}) {
  const promotionQuery = queryPromotionCandidates(baseDir, queryText || "", {
    outcomes: options.outcomes,
    preset: options.preset,
    usedInputs: options.usedInputs,
    taskContains: options.taskContains,
    sinceDays: options.sinceDays,
    limit: Math.max(options.limit || 8, 8),
  });

  const candidates = promotionQuery.results;
  let selectedCandidate = null;

  if (queryText) {
    const normalizedQuery = normalizeComparableText(queryText);
    selectedCandidate = candidates.find((candidate) => normalizeComparableText(candidate.rule_text) === normalizedQuery)
      || candidates.find((candidate) => normalizeComparableText(candidate.rule_text).includes(normalizedQuery));
  }

  if (!selectedCandidate) {
    selectedCandidate = candidates[0] || null;
  }

  if (!selectedCandidate) {
    throw new Error("No promotion candidate matched the current filters, so no Gene scaffold could be built.");
  }

  const geneId = slugifyGeneId(selectedCandidate.rule_text);
  const genePayload = {
    type: "Gene",
    schema_version: "1.5.0",
    id: geneId,
    summary: selectedCandidate.rule_text,
    category: inferGeneCategory(selectedCandidate),
    signals_match: buildGeneSignals(selectedCandidate),
    preconditions: buildGenePreconditions(selectedCandidate),
    strategy: buildGeneStrategy(selectedCandidate),
    constraints: {
      max_files: 12,
      forbidden_paths: [
        ".git",
        "node_modules",
      ],
    },
    validation: buildGeneValidation(baseDir, selectedCandidate, geneId),
  };

  const markdownLines = [
    "# Gene Candidate",
    "",
    `Candidate: ${selectedCandidate.rule_text}`,
    `Gene ID: ${geneId}`,
    `Status: ${selectedCandidate.status}`,
    `Category: ${genePayload.category}`,
    "",
    "## Why This Candidate",
    `- Successful runs: ${selectedCandidate.successful_runs}`,
    `- Partial runs: ${selectedCandidate.partial_runs}`,
    `- Failed runs: ${selectedCandidate.failed_runs}`,
    `- Support count: ${selectedCandidate.support_count}`,
    "",
    "## Evidence",
  ];

  if (selectedCandidate.evidence.length === 0) {
    markdownLines.push("- No evidence rows were found.");
  } else {
    selectedCandidate.evidence.forEach((item) => {
      markdownLines.push(`- ${item.task} [${item.outcome}] (${item.timestamp || "no timestamp"})`);
      if (item.notes) {
        markdownLines.push(`  Notes: ${item.notes}`);
      }
    });
  }

  markdownLines.push(
    "",
    "## Review Notes",
    "- This scaffold is written to artifacts only; review it before exporting to memory/agent-genes/.",
    "- Validation commands are heuristic suggestions generated from the current bridge workspace; review them if the task scope or working directory changes.",
    "",
    "## Gene JSON",
    JSON.stringify(genePayload, null, 2),
  );

  const artifacts = writeGeneCandidateArtifacts(baseDir, geneId, genePayload, markdownLines.join("\n"));
  const builtAt = new Date().toISOString();

  appendEvent(baseDir, {
    type: "gene_candidate_built",
    timestamp: builtAt,
    gene_id: geneId,
    source_rule: selectedCandidate.rule_text,
    preset: options.preset || "",
    status: selectedCandidate.status,
    evidence_count: selectedCandidate.evidence.length,
  });

  return {
    built_at: builtAt,
    query: queryText || "",
    preset: options.preset || "",
    selected_rule: selectedCandidate.rule_text,
    candidate_status: selectedCandidate.status,
    promotion_query: promotionQuery.summary,
    gene: genePayload,
    evidence: selectedCandidate.evidence,
    artifacts,
    markdown: markdownLines.join("\n"),
  };
}

function escapeShellDoubleQuotes(text) {
  return String(text || "").replace(/(["\\$`])/g, "\\$1");
}

function buildSuggestedRuleSource(candidate) {
  const taskPreview = candidate.recent_tasks.slice(0, 2).join(" + ");
  return `validated across ${candidate.successful_runs} successful tasks: ${taskPreview}`.slice(0, 220);
}

function writePromotionPacketArtifacts(baseDir, packetId, payload, markdown) {
  const packetDir = path.join(baseDir, "artifacts", "promotion-packets");
  ensureDir(packetDir);

  const jsonPath = path.join(packetDir, `${packetId}.json`);
  const markdownPath = path.join(packetDir, `${packetId}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  return { jsonPath, markdownPath };
}

function buildPromotionPacket(baseDir, queryText, options = {}) {
  const promotionQuery = queryPromotionCandidates(baseDir, queryText || "", {
    outcomes: options.outcomes,
    preset: options.preset,
    usedInputs: options.usedInputs,
    taskContains: options.taskContains,
    sinceDays: options.sinceDays,
    limit: Math.max(options.limit || 8, 8),
  });

  const selectedCandidate = promotionQuery.results[0] || null;
  if (!selectedCandidate) {
    throw new Error("No promotion candidate matched the current filters, so no promotion packet could be built.");
  }

  const packetId = slugifyGeneId(selectedCandidate.rule_text).replace(/^gene_/, "promotion_");
  const geneId = slugifyGeneId(selectedCandidate.rule_text);
  let geneCandidate = readGeneCandidateArtifacts(baseDir, geneId);

  if (!geneCandidate) {
    const builtGeneCandidate = buildGeneCandidate(baseDir, selectedCandidate.rule_text, options);
    geneCandidate = {
      jsonPath: builtGeneCandidate.artifacts.jsonPath,
      markdownPath: builtGeneCandidate.artifacts.markdownPath,
      gene: builtGeneCandidate.gene,
      markdown: builtGeneCandidate.markdown,
    };
  }

  const suggestedRuleSource = buildSuggestedRuleSource(selectedCandidate);
  const exportGeneCommand = `node scripts/evolver_codex_bridge.js --export-gene "${escapeShellDoubleQuotes(geneCandidate.jsonPath)}"`;
  const recommendPromote = selectedCandidate.status === "ready-now";
  const recommendExportGene = recommendPromote;
  const builtAt = new Date().toISOString();
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  const stableRulesPreHash = hashContent(fs.readFileSync(stableRulesPath));

  const packetPayload = {
    schema_version: 1,
    packet_id: packetId,
    status: "review_pending",
    rule: {
      text: selectedCandidate.rule_text,
      source: suggestedRuleSource,
    },
    privacy_class: "unclassified",
    target_surface: {
      kind: "stable_rules",
      path: "memory/stable-rules.md",
      pre_sha256: stableRulesPreHash,
    },
    human_approval: {
      approved: false,
      approved_by: "",
      approved_at: "",
      approval_reference: "",
    },
    generated_at: builtAt,
    query: queryText || "",
    candidate: {
      rule_text: selectedCandidate.rule_text,
      status: selectedCandidate.status,
      successful_runs: selectedCandidate.successful_runs,
      partial_runs: selectedCandidate.partial_runs,
      failed_runs: selectedCandidate.failed_runs,
      support_count: selectedCandidate.support_count,
      recent_tasks: selectedCandidate.recent_tasks,
      evidence: selectedCandidate.evidence,
    },
    recommended_actions: {
      recommend_apply_after_approval: recommendPromote,
      recommend_export_gene: recommendExportGene,
      export_gene_command: exportGeneCommand,
    },
    linked_gene_candidate: {
      id: geneCandidate.gene ? geneCandidate.gene.id : geneId,
      json_path: geneCandidate.jsonPath,
      markdown_path: geneCandidate.markdownPath,
    },
    review_notes: [
      "This packet is review_pending and cannot be applied as generated.",
      "A human must classify privacy, set status=approved, complete all human_approval fields, and preserve the target pre-hash.",
      "After approval, compute SHA-256 over the final packet bytes and pass that digest through --packet-sha256.",
      "Review the suggested validation commands in the Gene draft before running --export-gene.",
    ],
  };

  const markdownLines = [
    "# Promotion Packet",
    "",
    `Candidate: ${selectedCandidate.rule_text}`,
    "Packet Status: review_pending",
    `Candidate Status: ${selectedCandidate.status}`,
    "Privacy Class: unclassified",
    `Stable Rules Pre-SHA256: ${stableRulesPreHash}`,
    `Generated: ${builtAt}`,
    "",
    "## Evidence Snapshot",
    `- Successful runs: ${selectedCandidate.successful_runs}`,
    `- Partial runs: ${selectedCandidate.partial_runs}`,
    `- Failed runs: ${selectedCandidate.failed_runs}`,
    `- Support count: ${selectedCandidate.support_count}`,
    "",
    "## Evidence Rows",
  ];

  selectedCandidate.evidence.forEach((item) => {
    markdownLines.push(`- ${item.task} [${item.outcome}] (${item.timestamp || "no timestamp"})`);
    if (item.notes) {
      markdownLines.push(`  Notes: ${item.notes}`);
    }
  });

  markdownLines.push(
    "",
    "## Suggested Rule Source",
    suggestedRuleSource,
    "",
    "## Linked Gene Draft",
    `- JSON: ${geneCandidate.jsonPath}`,
    `- Markdown: ${geneCandidate.markdownPath}`,
    "",
    "## Approval and Apply",
    "- Review the evidence and rule wording.",
    "- Replace `privacy_class: unclassified` with an allowed non-confidential class.",
    "- Set `status` to `approved` and complete every `human_approval` field.",
    "- Compute SHA-256 over the final JSON bytes, then apply with `--apply-approved-packet <packet.json> --packet-sha256 <sha256>`.",
    "- Any edit after hashing, target drift, duplicate rule, or missing approval causes a fail-closed rejection.",
    "",
    "## Optional Gene Command",
    `- Export gene: \`${exportGeneCommand}\``,
    "",
    "## Review Notes",
    "- This generated packet is deliberately non-applicable until a human approves its final contents.",
    "- If the rule feels too task-specific, stop here and refine the wording first.",
    "- Review the linked Gene draft's validation commands before export, especially if the working directory or task scope changed.",
  );

  const artifacts = writePromotionPacketArtifacts(baseDir, packetId, packetPayload, markdownLines.join("\n"));

  appendEvent(baseDir, {
    type: "promotion_packet_built",
    timestamp: builtAt,
    packet_id: packetId,
    source_rule: selectedCandidate.rule_text,
    preset: options.preset || "",
    status: selectedCandidate.status,
  });

  return {
    built_at: builtAt,
    query: queryText || "",
    preset: options.preset || "",
    selected_rule: selectedCandidate.rule_text,
    candidate_status: selectedCandidate.status,
    suggested_rule_source: suggestedRuleSource,
    linked_gene_candidate: packetPayload.linked_gene_candidate,
    recommended_actions: packetPayload.recommended_actions,
    evidence: selectedCandidate.evidence,
    artifacts,
    markdown: markdownLines.join("\n"),
  };
}

function buildCandidatePromotion(baseDir, options = {}) {
  const reviewPath = path.join(baseDir, "artifacts", "codex-history-review.json");
  const classificationJsonPath = path.join(baseDir, "artifacts", "codex-candidate-classification.json");
  const classificationMarkdownPath = path.join(baseDir, "artifacts", "codex-candidate-classification.md");
  const generatedAt = new Date().toISOString();

  if (!fs.existsSync(reviewPath)) {
    const emptyPayload = {
      generated_at: generatedAt,
      review_path: reviewPath,
      review_found: false,
      summary: {
        total_candidates: 0,
        auto_promoted: 0,
        proposed_stable_rule: 0,
        matched_existing_rule: 0,
        marked_handled: 0,
        review_first: 0,
        skipped: 0,
        already_ignored: 0,
      },
      classifications: [],
    };
    writeJsonFile(classificationJsonPath, emptyPayload);
    fs.writeFileSync(
      classificationMarkdownPath,
      "# Candidate Classification\n\n- No codex-history-review.json was found, so candidate promotion was skipped.\n",
      "utf8",
    );
    return {
      generatedAt,
      classificationJsonPath,
      classificationMarkdownPath,
      reviewFound: false,
      promotedCount: 0,
      handledCount: 0,
      classifications: [],
    };
  }

  const review = readJsonFile(reviewPath);
  const rulesConfig = loadCandidatePromotionRules(baseDir);
  const ignoreRegistry = loadCandidateIgnoreRegistry(baseDir);
  const stableRulesPath = path.join(baseDir, "memory", "stable-rules.md");
  const stableRulesContent = fs.existsSync(stableRulesPath) ? fs.readFileSync(stableRulesPath, "utf8") : "";
  const stableRuleKeys = new Set(extractStableRuleTexts(stableRulesContent).map((rule) => normalizeComparableText(rule)));
  const candidates = Array.isArray(review.recent_change_learning_queue) ? review.recent_change_learning_queue : [];
  const classifications = [];
  let promotedCount = 0;
  let handledCount = 0;

  candidates.forEach((candidate) => {
    const baseInfo = {
      session_id: candidateSessionId(candidate),
      updated_at: candidate.updated_at || "",
      first_user_message: candidate.first_user_message || "",
      path: candidate.path || "",
      task_families: Array.isArray(candidate.task_families) ? candidate.task_families : [],
    };

    if (isCandidateIgnored(candidate, ignoreRegistry)) {
      classifications.push({
        ...baseInfo,
        status: "already-ignored",
        action_taken: "none",
        reason: "Candidate is already in the handled skip registry.",
      });
      return;
    }

    const matchedRule = findMatchedPromotionRule(candidate, rulesConfig.rules);
    if (!matchedRule) {
      classifications.push({
        ...baseInfo,
        status: "review-first",
        action_taken: "none",
        reason: "No deterministic promotion rule matched this candidate.",
      });
      return;
    }

    if (matchedRule.action === "skip") {
      addHandledCandidate(ignoreRegistry, candidate, matchedRule.reason || matchedRule.id);
      handledCount += 1;
      classifications.push({
        ...baseInfo,
        matched_rule_id: matchedRule.id,
        status: "skipped",
        action_taken: "added-to-ignore",
        reason: matchedRule.reason || "Skipped by classifier rule.",
      });
      return;
    }

    if (matchedRule.action === "mark-handled") {
      addHandledCandidate(ignoreRegistry, candidate, matchedRule.reason || matchedRule.id);
      handledCount += 1;
      classifications.push({
        ...baseInfo,
        matched_rule_id: matchedRule.id,
        status: "marked-handled",
        action_taken: "added-to-ignore",
        reason: matchedRule.reason || "Handled by overlap rule.",
      });
      return;
    }

    if (["propose-stable-rule", "promote-stable-rule"].includes(matchedRule.action)) {
      const normalizedRule = normalizeComparableText(matchedRule.rule_text || "");
      if (stableRuleKeys.has(normalizedRule)) {
        addHandledCandidate(ignoreRegistry, candidate, `matched existing stable rule: ${matchedRule.id}`);
        handledCount += 1;
        classifications.push({
          ...baseInfo,
          matched_rule_id: matchedRule.id,
          status: "matched-existing-rule",
          action_taken: "added-to-ignore",
          promoted_rule_text: matchedRule.rule_text,
          reason: "Matched an existing stable rule; no duplicate promotion performed.",
        });
        return;
      }

      classifications.push({
        ...baseInfo,
        matched_rule_id: matchedRule.id,
        status: "proposed-stable-rule",
        action_taken: "prepared-for-review",
        proposed_rule_text: matchedRule.rule_text,
        rule_source: matchedRule.rule_source || `proposed by ${matchedRule.id}`,
        candidate_kind: matchedRule.candidate_kind || "stable_rule",
        target_surface: matchedRule.target_surface || "stable_rules",
        privacy_class: matchedRule.privacy_class || "unclassified",
        reason: matchedRule.action === "promote-stable-rule"
          ? "Legacy mutating classifier action was downgraded to a review-only proposal."
          : (matchedRule.reason || "Candidate matched a stable-rule proposal pattern; human approval is still required."),
      });
      return;
    }

    classifications.push({
      ...baseInfo,
      matched_rule_id: matchedRule.id,
      status: "review-first",
      action_taken: "none",
      reason: matchedRule.reason || "Classifier left this candidate for manual review.",
    });
  });

  saveCandidateIgnoreRegistry(ignoreRegistry);

  const summary = {
    total_candidates: candidates.length,
    auto_promoted: classifications.filter((item) => item.status === "auto-promoted").length,
    proposed_stable_rule: classifications.filter((item) => item.status === "proposed-stable-rule").length,
    matched_existing_rule: classifications.filter((item) => item.status === "matched-existing-rule").length,
    marked_handled: classifications.filter((item) => item.status === "marked-handled").length,
    review_first: classifications.filter((item) => item.status === "review-first").length,
    skipped: classifications.filter((item) => item.status === "skipped").length,
    already_ignored: classifications.filter((item) => item.status === "already-ignored").length,
  };

  const payload = {
    generated_at: generatedAt,
    review_path: reviewPath,
    rules_path: rulesConfig.filePath,
    ignore_registry_path: ignoreRegistry.filePath,
    review_found: true,
    summary,
    classifications,
  };

  const markdownLines = [
    "# Candidate Classification",
    "",
    `Generated: ${generatedAt}`,
    `Review Source: ${reviewPath}`,
    `Promotion Rules: ${rulesConfig.filePath}`,
    `Ignore Registry: ${ignoreRegistry.filePath}`,
    "",
    "## Summary",
    `- Total candidates: ${summary.total_candidates}`,
    `- Auto-promoted: ${summary.auto_promoted}`,
    `- Proposed stable rules: ${summary.proposed_stable_rule}`,
    `- Matched existing rule: ${summary.matched_existing_rule}`,
    `- Marked handled: ${summary.marked_handled}`,
    `- Review first: ${summary.review_first}`,
    `- Skipped: ${summary.skipped}`,
    `- Already ignored: ${summary.already_ignored}`,
    "",
    "## Classifications",
  ];

  if (classifications.length === 0) {
    markdownLines.push("- No current 3-day candidate-window candidates were available.");
  } else {
    classifications.forEach((item) => {
      markdownLines.push(`- [${item.status}] ${item.first_user_message || item.session_id}`);
      if (item.matched_rule_id) {
        markdownLines.push(`  rule: ${item.matched_rule_id}`);
      }
      if (item.promoted_rule_text) {
        markdownLines.push(`  promoted: ${item.promoted_rule_text}`);
      }
      if (item.proposed_rule_text) {
        markdownLines.push(`  proposed: ${item.proposed_rule_text}`);
        markdownLines.push(`  candidate kind: ${item.candidate_kind}`);
        markdownLines.push(`  target surface: ${item.target_surface}`);
        markdownLines.push(`  privacy class: ${item.privacy_class}`);
      }
      markdownLines.push(`  action: ${item.action_taken}`);
      markdownLines.push(`  reason: ${item.reason}`);
      markdownLines.push(`  path: ${item.path}`);
    });
  }

  markdownLines.push("");

  writeJsonFile(classificationJsonPath, payload);
  fs.writeFileSync(classificationMarkdownPath, `${markdownLines.join("\n")}\n`, "utf8");

  if (options.appendEvent !== false) {
    appendEvent(baseDir, {
      type: "candidate_promotion_built",
      timestamp: generatedAt,
      total_candidates: summary.total_candidates,
      auto_promoted: summary.auto_promoted,
      proposed_stable_rule: summary.proposed_stable_rule,
      matched_existing_rule: summary.matched_existing_rule,
      marked_handled: summary.marked_handled,
    });
  }

  return {
    generatedAt,
    classificationJsonPath,
    classificationMarkdownPath,
    reviewFound: true,
    promotedCount,
    handledCount,
    summary,
    classifications,
  };
}

function buildDebriefReminder(baseDir, options = {}) {
  const feedbackEntries = readNdjson(path.join(baseDir, "memory", "execution-feedback.ndjson"));
  const events = readNdjson(path.join(baseDir, "memory", "evolution-events.ndjson"));
  const reminderJsonPath = path.join(baseDir, "artifacts", "debrief-reminder.json");
  const reminderMarkdownPath = path.join(baseDir, "artifacts", "debrief-reminder.md");
  const generatedAt = new Date().toISOString();
  const latestFeedback = feedbackEntries[feedbackEntries.length - 1] || null;
  const latestEvent = events[events.length - 1] || null;
  const latestFeedbackTime = latestFeedback ? Date.parse(latestFeedback.timestamp || "") : Number.NaN;
  const newerEvents = events.filter((event) => {
    const eventTime = Date.parse(event.timestamp || "");
    if (Number.isNaN(eventTime)) {
      return false;
    }
    if (Number.isNaN(latestFeedbackTime)) {
      return true;
    }
    return eventTime > latestFeedbackTime;
  }).filter((event) => ![
    "feedback_insights_built",
    "task_session_index_built",
    "debrief_reminder_built",
  ].includes(event.type));

  const reminderNeeded = newerEvents.length > 0 || feedbackEntries.length === 0;
  const payload = {
    generated_at: generatedAt,
    reminder_needed: reminderNeeded,
    last_feedback: latestFeedback ? {
      timestamp: latestFeedback.timestamp || "",
      task: latestFeedback.task || "",
      outcome: latestFeedback.outcome || "partial",
    } : null,
    latest_event: latestEvent ? {
      timestamp: latestEvent.timestamp || "",
      type: latestEvent.type || "",
    } : null,
    pending_events: newerEvents.slice(-6).reverse(),
    reminder_text: reminderNeeded
      ? "Record execution feedback for the latest real hybrid work before trusting the new guidance as durable."
      : "Execution feedback is caught up with the latest tracked work. Record a fresh debrief after the next substantive task.",
    suggested_feedback_fields: [
      "task",
      "used_inputs",
      "adopted_guidance",
      "rejected_guidance",
      "outcome",
      "notes",
    ],
  };

  const markdownLines = [
    "# Debrief Reminder",
    "",
    `Generated: ${generatedAt}`,
    `Reminder Needed: ${reminderNeeded ? "yes" : "no"}`,
    "",
    "## Why",
    `- ${payload.reminder_text}`,
  ];

  if (latestFeedback) {
    markdownLines.push(`- Last feedback: ${latestFeedback.task || "unspecified task"} [${latestFeedback.outcome || "partial"}] (${latestFeedback.timestamp || "no timestamp"})`);
  } else {
    markdownLines.push("- No execution feedback has been recorded yet.");
  }

  if (newerEvents.length > 0) {
    markdownLines.push("", "## Newer Tracked Events");
    newerEvents.slice(-6).reverse().forEach((event) => {
      markdownLines.push(`- ${event.type || "unknown"} (${event.timestamp || "no timestamp"})`);
    });
  }

  markdownLines.push(
    "",
    "## When You Debrief",
    "- Capture what hybrid inputs you actually used, not just what was available.",
    "- Record which guidance survived contact with reality and which did not.",
    "- Keep the note short but specific enough to support later promotion review.",
    "",
  );

  fs.writeFileSync(reminderJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(reminderMarkdownPath, `${markdownLines.join("\n")}\n`, "utf8");

  if (options.appendEvent !== false) {
    appendEvent(baseDir, {
      type: "debrief_reminder_built",
      timestamp: generatedAt,
      reminder_needed: reminderNeeded,
      pending_event_count: newerEvents.length,
    });
  }

  return {
    generatedAt,
    reminderJsonPath,
    reminderMarkdownPath,
    reminderNeeded,
    pendingEventCount: newerEvents.length,
  };
}

function runMaintenance(baseDir, target = "safe") {
  const normalizedTarget = String(target || "safe").trim().toLowerCase();
  const allowedTargets = new Set(["all", "safe", "candidate-promotion", "feedback-insights", "task-session-index", "debrief-reminder"]);
  if (!allowedTargets.has(normalizedTarget)) {
    throw new Error(`Unknown maintenance target: ${target}. Allowed targets: all, safe, candidate-promotion, feedback-insights, task-session-index, debrief-reminder.`);
  }

  const result = {
    target: normalizedTarget,
    ran_at: new Date().toISOString(),
    steps: [],
  };

  if (normalizedTarget === "all" || normalizedTarget === "candidate-promotion") {
    result.candidate_promotion = buildCandidatePromotion(baseDir, { appendEvent: false });
    result.steps.push("candidate-promotion");
  }

  if (normalizedTarget === "all" || normalizedTarget === "safe" || normalizedTarget === "feedback-insights") {
    result.feedback_insights = buildFeedbackInsights(baseDir, { appendEvent: false });
    result.steps.push("feedback-insights");
  }

  if (normalizedTarget === "all" || normalizedTarget === "safe" || normalizedTarget === "task-session-index") {
    result.task_session_index = buildTaskSessionIndex(baseDir, { appendEvent: false });
    result.steps.push("task-session-index");
  }

  if (normalizedTarget === "all" || normalizedTarget === "safe" || normalizedTarget === "debrief-reminder") {
    result.debrief_reminder = buildDebriefReminder(baseDir, { appendEvent: false });
    result.steps.push("debrief-reminder");
  }

  appendEvent(baseDir, {
    type: "maintenance_run",
    timestamp: result.ran_at,
    target: normalizedTarget,
    steps: result.steps,
  });

  const stepDetails = [];
  if (result.candidate_promotion) {
    stepDetails.push({
      step: "candidate-promotion",
      status: result.candidate_promotion.reviewFound ? "refreshed" : "skipped",
      auto_promoted: result.candidate_promotion.summary ? result.candidate_promotion.summary.auto_promoted : 0,
      proposed_stable_rule: result.candidate_promotion.summary ? result.candidate_promotion.summary.proposed_stable_rule : 0,
      matched_existing_rule: result.candidate_promotion.summary ? result.candidate_promotion.summary.matched_existing_rule : 0,
      marked_handled: result.candidate_promotion.summary ? result.candidate_promotion.summary.marked_handled : 0,
      review_first: result.candidate_promotion.summary ? result.candidate_promotion.summary.review_first : 0,
    });
  }
  if (result.feedback_insights) {
    stepDetails.push({
      step: "feedback-insights",
      status: "refreshed",
      feedback_entries: result.feedback_insights.feedbackCount || 0,
      promotable_count: result.feedback_insights.promotableGuidanceCount || 0,
    });
  }
  if (result.task_session_index) {
    stepDetails.push({
      step: "task-session-index",
      status: "refreshed",
      session_count: result.task_session_index.sessionCount || 0,
    });
  }
  if (result.debrief_reminder) {
    stepDetails.push({
      step: "debrief-reminder",
      status: "refreshed",
      debrief_needed: result.debrief_reminder.reminderNeeded || false,
      pending_events: result.debrief_reminder.pendingEventCount || 0,
    });
  }
  result.step_details = stepDetails;
  result.debrief_needed = result.debrief_reminder ? result.debrief_reminder.reminderNeeded : false;

  result.markdown = [
    "# Maintenance Run",
    "",
    `Target: ${normalizedTarget}`,
    `Ran At: ${result.ran_at}`,
    `Debrief Needed: ${result.debrief_needed ? "yes" : "no"}`,
    "",
    "## Steps",
    ...stepDetails.map((detail) => {
      const extras = Object.entries(detail)
        .filter(([key]) => key !== "step" && key !== "status")
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      return `- ${detail.step}: ${detail.status}${extras ? " (" + extras + ")" : ""}`;
    }),
  ].join("\n");

  return result;
}

function acquireExclusiveLock(lockPath, label) {
  try {
    return fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`${label} lock already exists: ${lockPath}`);
    }
    throw error;
  }
}

function releaseExclusiveLock(lockHandle, lockPath) {
  if (lockHandle === undefined) {
    return;
  }
  fs.closeSync(lockHandle);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

function writeBufferFully(fileHandle, bytes) {
  let written = 0;
  while (written < bytes.length) {
    const chunkSize = fs.writeSync(fileHandle, bytes, written, bytes.length - written);
    if (chunkSize <= 0) {
      throw new Error("event log write made no progress");
    }
    written += chunkSize;
  }
}

function appendEvent(baseDir, payload) {
  const requestedEventLogPath = path.join(baseDir, "memory", "evolution-events.ndjson");
  const eventStats = fs.lstatSync(requestedEventLogPath);
  if (eventStats.isSymbolicLink() || !eventStats.isFile()) {
    throw new Error("Event log must be a regular non-symlink file.");
  }
  const eventLogPath = fs.realpathSync(requestedEventLogPath);
  const lockPath = `${eventLogPath}.append.lock`;
  let lockHandle;
  let eventHandle;
  try {
    lockHandle = acquireExclusiveLock(lockPath, "Event log append");
    eventHandle = fs.openSync(
      eventLogPath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    );
    const openedStats = fs.fstatSync(eventHandle);
    if (!openedStats.isFile() || openedStats.dev !== eventStats.dev || openedStats.ino !== eventStats.ino) {
      throw new Error("Event log target changed during append validation.");
    }
    writeBufferFully(eventHandle, Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"));
    fs.fsyncSync(eventHandle);
  } finally {
    if (eventHandle !== undefined) {
      fs.closeSync(eventHandle);
    }
    releaseExclusiveLock(lockHandle, lockPath);
  }
}

function writeArtifacts(baseDir, rawText, summaryText, directives, actions, delegateSuggestions) {
  const now = new Date().toISOString();
  const rawOutputPath = path.join(baseDir, "raw", "latest-evolver-output.txt");
  const actionsPath = path.join(baseDir, "artifacts", "next-actions.json");
  const promptPath = path.join(baseDir, "artifacts", "next-prompt.md");
  const feedbackInsightsPath = path.join(baseDir, "artifacts", "feedback-insights.md");
  const delegateJsonPath = path.join(baseDir, "artifacts", "delegate-suggestions.json");
  const delegateMarkdownPath = path.join(baseDir, "artifacts", "delegate-suggestions.md");
  const inboxPath = path.join(baseDir, "inbox", "next-task.md");

  fs.writeFileSync(rawOutputPath, rawText, "utf8");

  const summaryLines = extractActionableSummaryLines(summaryText, 12);
  const actionsPayload = {
    generated_at: now,
    host: "codex",
    directive_count: directives.length,
    read_order: [
      "memory/stable-rules.md",
      "artifacts/next-prompt.md",
      "artifacts/next-actions.json",
      "artifacts/delegate-suggestions.json",
      "artifacts/feedback-insights.md",
      "memory/task-session-index.ndjson",
      "memory/execution-feedback.ndjson",
      "raw/latest-evolver-output.txt",
    ],
    derived_artifacts: [
      "artifacts/delegate-suggestions.json",
      "artifacts/delegate-suggestions.md",
      "artifacts/feedback-insights.md",
      "artifacts/feedback-insights.json",
      "memory/task-session-index.ndjson",
      "memory/task-session-index.json",
    ],
    summary_lines: summaryLines,
    actions,
    delegate_suggestions: delegateSuggestions,
    limitations: [
      "sessions_spawn(...) is host-specific output and will not auto-execute in Codex.",
      "Translate directives into explicit local work, tool usage, or stable rules after review.",
      "Fresh bridge output is proposed guidance, not self-applying truth.",
    ],
  };
  fs.writeFileSync(actionsPath, `${JSON.stringify(actionsPayload, null, 2)}\n`, "utf8");

  const delegatePayload = {
    generated_at: now,
    suggestion_count: delegateSuggestions.length,
    suggestions: delegateSuggestions,
  };
  fs.writeFileSync(delegateJsonPath, `${JSON.stringify(delegatePayload, null, 2)}\n`, "utf8");

  const delegateMarkdownLines = [
    "# Delegate Suggestions",
    "",
    `Generated: ${now}`,
    "",
    "These are local translations of host-only `sessions_spawn(...)` directives. They do not execute automatically.",
    "",
  ];
  if (delegateSuggestions.length === 0) {
    delegateMarkdownLines.push("- No delegate suggestion was extracted from the latest Evolver output.");
  } else {
    delegateSuggestions.forEach((suggestion, index) => {
      delegateMarkdownLines.push(`## Suggestion ${index + 1}`);
      delegateMarkdownLines.push(`- Goal: ${suggestion.primary_goal}`);
      delegateMarkdownLines.push(`- Mode: ${suggestion.local_execution_mode}`);
      delegateMarkdownLines.push(`- Confidence: ${suggestion.parse_confidence}`);
      delegateMarkdownLines.push(`- Prompt: ${suggestion.suggested_prompt}`);
      suggestion.suggested_steps.forEach((step) => {
        delegateMarkdownLines.push(`- Step: ${step}`);
      });
      delegateMarkdownLines.push("");
    });
  }
  fs.writeFileSync(delegateMarkdownPath, `${delegateMarkdownLines.join("\n")}\n`, "utf8");

  const promptLines = [
    "# Evolver Hybrid Prompt",
    "",
    `Generated: ${now}`,
    "",
    "## Required Read Order",
    "1. `../memory/stable-rules.md`",
    "2. `../artifacts/next-prompt.md`",
    "3. `../artifacts/next-actions.json`",
    "4. `../artifacts/delegate-suggestions.json`",
    "5. `../artifacts/feedback-insights.md`",
    "6. `../memory/task-session-index.ndjson`",
    "7. `../memory/execution-feedback.ndjson`",
    "8. `../raw/latest-evolver-output.txt` (only if needed)",
    "",
    "## How To Use",
    "- Treat the items below as proposed guidance, not self-applying truth.",
    "- Convert any host-only directive into a concrete Codex action, file change, or explicit user-facing recommendation.",
    "- Use delegate-suggestions.json when the Evolver output hints at parallel or child-session work.",
    "- Promote only lessons that remain useful after real execution.",
    `- Use \`${path.basename(feedbackInsightsPath)}\` to quickly scan which guidance is actually working before opening the raw feedback log.`,
    "- After using this guidance in a real task, record feedback into execution-feedback.ndjson.",
    "",
    "## Fresh Evolver Signal",
  ];

  if (summaryLines.length === 0) {
    promptLines.push("- No plain-language guidance was detected in the latest Evolver output.");
  } else {
    for (const line of summaryLines) {
      promptLines.push(`- ${line}`);
    }
  }

  promptLines.push("", "## Host-Only Directives");
  if (directives.length === 0) {
    promptLines.push("- None detected.");
  } else {
    directives.forEach((directive, index) => {
      promptLines.push(`${index + 1}. \`${directive.raw}\``);
      promptLines.push("   Translate this into a concrete Codex-side task before acting.");
    });
  }

  promptLines.push("", "## Proposed Next Actions");
  actions.forEach((action, index) => {
    promptLines.push(`${index + 1}. [${action.priority}] ${action.text}`);
  });
  promptLines.push("");

  fs.writeFileSync(promptPath, `${promptLines.join("\n")}\n`, "utf8");

  const inboxLines = [
    "# Next Evolver Review",
    "",
    `Created: ${now}`,
    "",
    "Review `../memory/stable-rules.md` first, then `../artifacts/next-prompt.md`, then `../artifacts/next-actions.json`.",
    "Use `../artifacts/delegate-suggestions.json` if the latest Evolver output included host-only delegation hints.",
    "Before opening the raw feedback log, scan `../artifacts/feedback-insights.md` for repeated successes, failures, and promotion candidates.",
    "Query `../memory/task-session-index.ndjson` before starting from scratch if the task smells similar to prior hybrid work.",
    "Execute only the parts that still make sense in the current task.",
    "Promote validated lessons into `../memory/stable-rules.md` and write task outcomes into `../memory/execution-feedback.ndjson`.",
    "",
  ];
  fs.writeFileSync(inboxPath, inboxLines.join("\n"), "utf8");

  appendEvent(baseDir, {
    type: "bridge_ingest",
    timestamp: now,
    directive_count: directives.length,
    delegate_suggestion_count: delegateSuggestions.length,
    summary_preview: summaryLines.slice(0, 3),
  });

  return {
    rawOutputPath,
    actionsPath,
    promptPath,
    delegateJsonPath,
    delegateMarkdownPath,
    inboxPath,
    generatedAt: now,
  };
}

const APPROVED_PROMOTION_PRIVACY_CLASSES = new Set([
  "public",
  "workspace",
  "user-preference-abstract",
]);

function requirePacketText(value, fieldName, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Approved promotion packet requires non-empty ${fieldName}.`);
  }
  if (/\r|\n/.test(value)) {
    throw new Error(`Approved promotion packet ${fieldName} must be a single line.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`Approved promotion packet ${fieldName} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function requireSha256(value, fieldName) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`Approved promotion packet requires ${fieldName} as a 64-character SHA-256 digest.`);
  }
  return value.toLowerCase();
}

function applyApprovedPromotionPacket(baseDir, packetFile, expectedPacketHash) {
  if (typeof packetFile !== "string" || !packetFile.trim()) {
    throw new Error("--apply-approved-packet requires a packet file.");
  }
  const expectedHash = requireSha256(expectedPacketHash, "--packet-sha256");
  const packetPath = path.resolve(packetFile);
  const packetBytes = fs.readFileSync(packetPath);
  const actualPacketHash = hashContent(packetBytes);
  if (actualPacketHash !== expectedHash) {
    throw new Error(`Approved promotion packet hash mismatch: expected ${expectedHash}, got ${actualPacketHash}.`);
  }

  let packet;
  try {
    packet = JSON.parse(packetBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Approved promotion packet is not valid JSON: ${error.message}`);
  }

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new Error("Approved promotion packet must be a JSON object.");
  }
  if (packet.schema_version !== 1) {
    throw new Error("Approved promotion packet schema_version must be 1.");
  }
  const packetId = requirePacketText(packet.packet_id, "packet_id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packetId)) {
    throw new Error("Approved promotion packet packet_id contains unsupported characters.");
  }
  if (packet.status !== "approved") {
    throw new Error("Approved promotion packet status must be approved.");
  }
  if (!APPROVED_PROMOTION_PRIVACY_CLASSES.has(packet.privacy_class)) {
    throw new Error(`Approved promotion packet privacy_class is not allowed: ${packet.privacy_class || "missing"}.`);
  }

  const rule = packet.rule && typeof packet.rule === "object" ? packet.rule : {};
  const ruleText = requirePacketText(rule.text, "rule.text", 2000);
  const ruleSource = requirePacketText(rule.source, "rule.source", 500);

  const approval = packet.human_approval && typeof packet.human_approval === "object"
    ? packet.human_approval
    : {};
  if (approval.approved !== true || approval.approved_by !== "user") {
    throw new Error("Approved promotion packet requires human_approval.approved=true and approved_by=user.");
  }
  const approvedAt = requirePacketText(approval.approved_at, "human_approval.approved_at", 100);
  if (Number.isNaN(Date.parse(approvedAt))) {
    throw new Error("Approved promotion packet human_approval.approved_at must be a valid timestamp.");
  }
  const approvalReference = requirePacketText(
    approval.approval_reference,
    "human_approval.approval_reference",
    500,
  );

  const target = packet.target_surface && typeof packet.target_surface === "object"
    ? packet.target_surface
    : {};
  if (target.kind !== "stable_rules" || target.path !== "memory/stable-rules.md") {
    throw new Error("Approved promotion packet target_surface must be the canonical memory/stable-rules.md surface.");
  }
  const expectedTargetHash = requireSha256(target.pre_sha256, "target_surface.pre_sha256");
  const requestedBasePath = path.resolve(baseDir);
  const requestedMemoryPath = path.join(requestedBasePath, "memory");
  const requestedStableRulesPath = path.join(requestedMemoryPath, "stable-rules.md");
  const requestedEventLogPath = path.join(requestedMemoryPath, "evolution-events.ndjson");
  const resolvedTargetPath = path.resolve(baseDir, target.path);
  if (resolvedTargetPath !== requestedStableRulesPath) {
    throw new Error("Approved promotion packet target path escaped the canonical stable-rules surface.");
  }

  const realBasePath = fs.realpathSync(requestedBasePath);
  const memoryStats = fs.lstatSync(requestedMemoryPath);
  if (memoryStats.isSymbolicLink() || !memoryStats.isDirectory()) {
    throw new Error("Approved promotion packet requires memory to be a real directory, not a symlink.");
  }
  const realMemoryPath = fs.realpathSync(requestedMemoryPath);
  if (realMemoryPath !== path.join(realBasePath, "memory")) {
    throw new Error("Approved promotion packet memory directory escaped the real base directory.");
  }

  const stableStats = fs.lstatSync(requestedStableRulesPath);
  if (stableStats.isSymbolicLink() || !stableStats.isFile()) {
    throw new Error("Approved promotion packet requires stable-rules.md to be a regular non-symlink file.");
  }
  const eventStats = fs.lstatSync(requestedEventLogPath);
  if (eventStats.isSymbolicLink() || !eventStats.isFile()) {
    throw new Error("Approved promotion packet requires evolution-events.ndjson to be a regular non-symlink file.");
  }

  const stableRulesPath = fs.realpathSync(requestedStableRulesPath);
  const eventLogPath = fs.realpathSync(requestedEventLogPath);
  if (stableRulesPath !== path.join(realMemoryPath, "stable-rules.md")) {
    throw new Error("Approved promotion packet stable-rules real path escaped the canonical memory directory.");
  }
  if (eventLogPath !== path.join(realMemoryPath, "evolution-events.ndjson")) {
    throw new Error("Approved promotion packet event-log real path escaped the canonical memory directory.");
  }

  const lockPath = `${stableRulesPath}.promotion.lock`;
  const eventLockPath = `${eventLogPath}.append.lock`;
  let lockHandle;
  let eventLockHandle;
  let eventHandle;
  let tempPath = "";
  let rollbackPath = "";
  try {
    lockHandle = acquireExclusiveLock(lockPath, "Stable-rule promotion");
    eventLockHandle = acquireExclusiveLock(eventLockPath, "Event log append");
    const stableHandle = fs.openSync(stableRulesPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const openedStableStats = fs.fstatSync(stableHandle);
    if (openedStableStats.dev !== stableStats.dev || openedStableStats.ino !== stableStats.ino) {
      fs.closeSync(stableHandle);
      throw new Error("Approved promotion packet stable-rules target changed during validation.");
    }
    const currentBytes = fs.readFileSync(stableHandle);
    fs.closeSync(stableHandle);
    const currentTargetHash = hashContent(currentBytes);
    if (currentTargetHash !== expectedTargetHash) {
      throw new Error(`Approved promotion packet target pre-hash mismatch: expected ${expectedTargetHash}, got ${currentTargetHash}.`);
    }

    const content = currentBytes.toString("utf8");
    const existingRuleKeys = new Set(
      extractStableRuleTexts(content).map((existingRule) => normalizeComparableText(existingRule)),
    );
    if (existingRuleKeys.has(normalizeComparableText(ruleText))) {
      throw new Error("Approved promotion packet rule duplicates an existing stable rule.");
    }

    eventHandle = fs.openSync(
      eventLogPath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    );
    const openedEventStats = fs.fstatSync(eventHandle);
    if (!openedEventStats.isFile() || openedEventStats.dev !== eventStats.dev || openedEventStats.ino !== eventStats.ino) {
      throw new Error("Approved promotion packet event-log target changed during validation.");
    }
    const eventOriginalSize = openedEventStats.size;
    const promotedAt = new Date().toISOString();
    const bullet = `- ${ruleText} (source: ${ruleSource}; promoted: ${promotedAt})`;
    const nextContent = content.includes("- None promoted yet.")
      ? content.replace("- None promoted yet.", bullet)
      : `${content.trimEnd()}\n${bullet}\n`;
    tempPath = `${stableRulesPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, nextContent, {
      encoding: "utf8",
      mode: stableStats.mode & 0o777,
      flag: "wx",
    });
    fs.renameSync(tempPath, stableRulesPath);
    tempPath = "";
    const postSha256 = hashContent(Buffer.from(nextContent, "utf8"));

    const eventPayload = {
      type: "stable_rule_promoted",
      timestamp: promotedAt,
      source: ruleSource,
      rule: ruleText,
      packet_id: packetId,
      packet_sha256: actualPacketHash,
      approval_reference: approvalReference,
      approved_at: approvedAt,
      privacy_class: packet.privacy_class,
      target_pre_sha256: currentTargetHash,
      target_post_sha256: postSha256,
    };
    const eventBytes = Buffer.from(`${JSON.stringify(eventPayload)}\n`, "utf8");
    try {
      writeBufferFully(eventHandle, eventBytes);
      fs.fsyncSync(eventHandle);
    } catch (eventError) {
      const recoveryErrors = [];
      try {
        fs.ftruncateSync(eventHandle, eventOriginalSize);
        fs.fsyncSync(eventHandle);
      } catch (truncateError) {
        recoveryErrors.push(`event rollback failed: ${truncateError.message}`);
      }
      try {
        rollbackPath = `${stableRulesPath}.rollback-${process.pid}-${Date.now()}`;
        fs.writeFileSync(rollbackPath, currentBytes, {
          mode: stableStats.mode & 0o777,
          flag: "wx",
        });
        fs.renameSync(rollbackPath, stableRulesPath);
        rollbackPath = "";
      } catch (stableRollbackError) {
        recoveryErrors.push(`stable-rule rollback failed: ${stableRollbackError.message}`);
      }
      const recoverySuffix = recoveryErrors.length > 0 ? ` ${recoveryErrors.join("; ")}` : " Stable rule was rolled back.";
      throw new Error(`Approved promotion packet audit write failed: ${eventError.message}.${recoverySuffix}`);
    }

    return {
      packetPath,
      packetId,
      packetSha256: actualPacketHash,
      stableRulesPath,
      targetPreSha256: currentTargetHash,
      targetPostSha256: postSha256,
      promotedAt,
    };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    if (rollbackPath && fs.existsSync(rollbackPath)) {
      fs.unlinkSync(rollbackPath);
    }
    if (eventHandle !== undefined) {
      fs.closeSync(eventHandle);
    }
    releaseExclusiveLock(eventLockHandle, eventLockPath);
    releaseExclusiveLock(lockHandle, lockPath);
  }
}

function recordFeedback(baseDir, feedbackFile) {
  const feedbackPath = path.join(baseDir, "memory", "execution-feedback.ndjson");
  const payload = readJsonFile(feedbackFile);
  const normalized = {
    timestamp: payload.timestamp || new Date().toISOString(),
    task: payload.task || "unspecified task",
    used_inputs: Array.isArray(payload.used_inputs) ? payload.used_inputs : [],
    adopted_guidance: Array.isArray(payload.adopted_guidance) ? payload.adopted_guidance : [],
    rejected_guidance: Array.isArray(payload.rejected_guidance) ? payload.rejected_guidance : [],
    outcome: payload.outcome || "partial",
    notes: payload.notes || "",
  };
  fs.appendFileSync(feedbackPath, `${JSON.stringify(normalized)}\n`, "utf8");
  appendEvent(baseDir, {
    type: "execution_feedback_recorded",
    timestamp: normalized.timestamp,
    task: normalized.task,
    outcome: normalized.outcome,
  });
  return { feedbackPath, recordedAt: normalized.timestamp };
}

function exportGene(baseDir, geneFile) {
  const sourcePath = path.resolve(geneFile);
  const fileName = path.basename(sourcePath);
  const sourceContent = fs.readFileSync(sourcePath);
  const sourceHash = hashContent(sourceContent);
  const geneDir = path.join(baseDir, "memory", "agent-genes");
  const initialDestPath = path.join(geneDir, fileName);
  let destPath = initialDestPath;
  let exportMode = "created";

  if (fs.existsSync(initialDestPath)) {
    const existingHash = hashContent(fs.readFileSync(initialDestPath));
    if (existingHash === sourceHash) {
      exportMode = "unchanged";
    } else {
      const { baseName, extension } = splitFileName(fileName);
      const stampedName = `${baseName}__${timestampForFile()}__${sourceHash.slice(0, 8)}${extension}`;
      destPath = path.join(geneDir, stampedName);
      exportMode = "versioned_copy";
    }
  }

  if (exportMode !== "unchanged") {
    fs.writeFileSync(destPath, sourceContent);
  }

  appendEvent(baseDir, {
    type: "agent_gene_exported",
    timestamp: new Date().toISOString(),
    source: sourcePath,
    destination: destPath,
    export_mode: exportMode,
    content_hash: sourceHash,
  });
  return { sourcePath, destPath, exportMode, contentHash: sourceHash };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (Object.prototype.hasOwnProperty.call(args, "promoteRule")) {
    throw new Error("Legacy --promote-rule is disabled. Use --apply-approved-packet with --packet-sha256 after explicit human approval.");
  }
  if (Object.prototype.hasOwnProperty.call(args, "ruleSource")) {
    throw new Error("--rule-source belonged to disabled --promote-rule and is no longer accepted.");
  }
  const hasApprovedPacket = Object.prototype.hasOwnProperty.call(args, "applyApprovedPacket");
  if (hasApprovedPacket && (!args.applyApprovedPacket || !args.packetSha256)) {
    throw new Error("--apply-approved-packet requires both a packet file and --packet-sha256.");
  }
  if (args.packetSha256 && !hasApprovedPacket) {
    throw new Error("--packet-sha256 is only valid with --apply-approved-packet.");
  }

  if (hasApprovedPacket) {
    const result = applyApprovedPromotionPacket(args.baseDir, args.applyApprovedPacket, args.packetSha256);
    console.log(JSON.stringify({ ok: true, mode: "apply-approved-packet", ...result }, null, 2));
    return;
  }

  ensureBaseLayout(args.baseDir);
  maybeInitStableRules(args.baseDir);
  maybeInitEventLog(args.baseDir);
  maybeInitFeedbackLog(args.baseDir);
  maybeInitTaskSessionIndex(args.baseDir);

  if (args.recordFeedback) {
    const result = recordFeedback(args.baseDir, args.recordFeedback);
    const taskSessionIndex = buildTaskSessionIndex(args.baseDir);
    const insights = buildFeedbackInsights(args.baseDir);
    const debriefReminder = buildDebriefReminder(args.baseDir);
    console.log(JSON.stringify({ ok: true, mode: "record-feedback", ...result, taskSessionIndex, insights, debriefReminder }, null, 2));
    return;
  }

  if (args.markCandidateHandled) {
    const result = markCandidateHandled(args.baseDir, args.markCandidateHandled, args.handledReason);
    console.log(JSON.stringify({ ok: true, mode: "mark-candidate-handled", ...result }, null, 2));
    return;
  }

  if (args.exportGene) {
    const result = exportGene(args.baseDir, args.exportGene);
    const insights = buildFeedbackInsights(args.baseDir);
    console.log(JSON.stringify({ ok: true, mode: "export-gene", ...result, insights }, null, 2));
    return;
  }

  if (args.refreshGene) {
    const result = refreshGene(args.baseDir, args.refreshGene);
    const insights = buildFeedbackInsights(args.baseDir);
    if (args.format === "markdown") {
      console.log(result.markdown);
    } else {
      console.log(JSON.stringify({ ok: true, mode: "refresh-gene", ...result, insights }, null, 2));
    }
    return;
  }

  if (args.buildFeedbackInsights) {
    const result = buildFeedbackInsights(args.baseDir);
    console.log(JSON.stringify({ ok: true, mode: "build-feedback-insights", ...result }, null, 2));
    return;
  }

  if (args.buildTaskSessionIndex) {
    const result = buildTaskSessionIndex(args.baseDir);
    if (args.format === "markdown") {
      console.log([
        "# Task Session Index",
        "",
        `Generated: ${result.generatedAt}`,
        `Session Count: ${result.sessionCount}`,
        "",
        "## Recent Sessions",
        ...(result.recentSessions.length > 0
          ? result.recentSessions.map((item) => `- ${item.task} [${item.outcome}]`)
          : ["- No task/session entries were found."]),
      ].join("\n"));
    } else {
      console.log(JSON.stringify({ ok: true, mode: "build-task-session-index", ...result }, null, 2));
    }
    return;
  }

  if (args.buildDebriefReminder) {
    const result = buildDebriefReminder(args.baseDir);
    if (args.format === "markdown") {
      console.log(fs.readFileSync(result.reminderMarkdownPath, "utf8"));
    } else {
      console.log(JSON.stringify({ ok: true, mode: "build-debrief-reminder", ...result }, null, 2));
    }
    return;
  }

  if (args.buildCandidatePromotion) {
    const result = buildCandidatePromotion(args.baseDir);
    if (args.format === "markdown") {
      console.log(fs.readFileSync(result.classificationMarkdownPath, "utf8"));
    } else {
      console.log(JSON.stringify({ ok: true, mode: "build-candidate-promotion", ...result }, null, 2));
    }
    return;
  }

  if (args.runMaintenance) {
    const result = runMaintenance(args.baseDir, args.runMaintenance);
    if (args.format === "markdown") {
      console.log(result.markdown);
    } else {
      console.log(JSON.stringify({ ok: true, mode: "run-maintenance", ...result }, null, 2));
    }
    return;
  }

  if (
    args.query
    || args.queryForPromotion !== undefined
    || args.buildGeneCandidate !== undefined
    || args.buildPromotionPacket !== undefined
  ) {
    const mode = args.query
      ? "query"
      : args.queryForPromotion !== undefined
        ? "query-for-promotion"
        : args.buildGeneCandidate !== undefined
          ? "build-gene-candidate"
          : "build-promotion-packet";
    const effectiveArgs = applyQueryPreset(args, mode);
    const allowedFormats = new Set(["json", "markdown"]);
    if (!allowedFormats.has(effectiveArgs.format)) {
      throw new Error(`Invalid --format value: ${effectiveArgs.format}. Allowed values: json, markdown.`);
    }
    if (!Number.isInteger(effectiveArgs.limit) || effectiveArgs.limit <= 0) {
      throw new Error(`Invalid --limit value: ${effectiveArgs.limit}. Use a positive integer.`);
    }
    parseFilterOptions({
      outcomes: effectiveArgs.outcomes,
      usedInputs: effectiveArgs.usedInputs,
      taskContains: effectiveArgs.taskContains,
      sinceDays: effectiveArgs.sinceDays,
    });

    const result = effectiveArgs.query
      ? queryHybridMemory(effectiveArgs.baseDir, effectiveArgs.query, {
        taskContext: effectiveArgs.taskContext,
        sources: effectiveArgs.querySources,
        limit: effectiveArgs.limit,
        outcomes: effectiveArgs.outcomes,
        usedInputs: effectiveArgs.usedInputs,
        taskContains: effectiveArgs.taskContains,
        taskFamilies: effectiveArgs.taskFamilies,
        sinceDays: effectiveArgs.sinceDays,
        preset: effectiveArgs.appliedPreset,
      })
        : effectiveArgs.queryForPromotion !== undefined
          ? queryPromotionCandidates(effectiveArgs.baseDir, effectiveArgs.queryForPromotion, {
          limit: effectiveArgs.limit,
          outcomes: effectiveArgs.outcomes,
          usedInputs: effectiveArgs.usedInputs,
          taskContains: effectiveArgs.taskContains,
          sinceDays: effectiveArgs.sinceDays,
          preset: effectiveArgs.appliedPreset,
        })
          : effectiveArgs.buildGeneCandidate !== undefined
            ? buildGeneCandidate(effectiveArgs.baseDir, effectiveArgs.buildGeneCandidate, {
              limit: effectiveArgs.limit,
              outcomes: effectiveArgs.outcomes,
              usedInputs: effectiveArgs.usedInputs,
              taskContains: effectiveArgs.taskContains,
              sinceDays: effectiveArgs.sinceDays,
              preset: effectiveArgs.appliedPreset,
            })
            : buildPromotionPacket(effectiveArgs.baseDir, effectiveArgs.buildPromotionPacket, {
              limit: effectiveArgs.limit,
              outcomes: effectiveArgs.outcomes,
              usedInputs: effectiveArgs.usedInputs,
              taskContains: effectiveArgs.taskContains,
              sinceDays: effectiveArgs.sinceDays,
              preset: effectiveArgs.appliedPreset,
            });

    if (effectiveArgs.format === "markdown") {
      console.log(result.summary ? result.summary.markdown : result.markdown);
    } else {
      console.log(JSON.stringify({ ok: true, mode, ...result }, null, 2));
    }
    return;
  }

  const rawText = readInput(args.input);
  if (!rawText.trim()) {
    throw new Error("No Evolver output provided. Pass --input FILE or pipe text via stdin.");
  }

  const directives = extractSpawnDirectives(rawText);
  const delegateSuggestions = buildDelegateSuggestions(directives);
  const summaryText = stripDirectives(rawText, directives);
  const actions = buildActionItems(extractActionableSummaryLines(summaryText, 12), directives, delegateSuggestions);
  const result = writeArtifacts(args.baseDir, rawText, summaryText, directives, actions, delegateSuggestions);
  const taskSessionIndex = buildTaskSessionIndex(args.baseDir);
  const insights = buildFeedbackInsights(args.baseDir);
  const debriefReminder = buildDebriefReminder(args.baseDir);
  console.log(JSON.stringify({ ok: true, mode: "ingest", ...result, taskSessionIndex, insights, debriefReminder }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
