#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function usage() {
  console.log(`Usage:
  node scripts/index_codex_sessions.js [--sessions-dir DIR] [--base-dir DIR] [--format json|markdown]

Defaults:
  --sessions-dir ~/.codex/sessions
  --base-dir     ./evolver-hybrid

This builds a compressed all-history Codex session index for retrieval and
human review. It does not promote lessons into stable rules.`);
}

function parseArgs(argv) {
  const args = {
    sessionsDir: path.join(os.homedir(), ".codex", "sessions"),
    baseDir: path.resolve(process.cwd(), "evolver-hybrid"),
    format: "json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--sessions-dir":
        args.sessionsDir = path.resolve(argv[index + 1]);
        index += 1;
        break;
      case "--base-dir":
        args.baseDir = path.resolve(argv[index + 1]);
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

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach((entry) => {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(entryPath);
      }
    });
  }
  return results.sort();
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return null;
  }
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function truncateText(text, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function extractContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content.map((part) => {
    if (!part || typeof part !== "object") {
      return "";
    }
    return part.text || part.input_text || part.output_text || "";
  }).filter(Boolean).join("\n");
}

function isSessionScaffoldText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return true;
  }
  if (value.startsWith("# AGENTS.md instructions")) {
    return true;
  }
  if (value.startsWith("<environment_context>")) {
    return true;
  }
  if (value.includes("<INSTRUCTIONS>") && value.includes("<environment_context>")) {
    return true;
  }
  if (value.includes("--- project-doc ---") && value.includes("Default reply language:")) {
    return true;
  }
  return false;
}

function addMapCount(map, key) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) || 0) + 1);
}

function topMapEntries(map, limit = 12) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

const FAMILY_PATTERNS = [
  ["legal-research", /LegalKB|法律知识库|wiki\/|检索|法条|案例|法律研究/i],
  ["legal-doc", /上诉状|答辩状|代理词|合同|诉讼|证据|质证|法律意见|律师函/i],
  ["pdf-mineru", /PDF|pdf|MinerU|OCR|Markdown|转换/i],
  ["docx", /docx|Word|文档|批注|修订/i],
  ["workflow", /skill|AGENTS|CLAUDE|workflow|doctor|hook|prompt|配置|迁移/i],
  ["memory-evolution", /evolution|复盘|沉淀|memory|经验|自我进化|agent-evolution/i],
  ["hermes", /Hermes|远端|云端|outbox|inbox|腾讯云/i],
  ["obsidian", /Obsidian|vault|文章收纳|wiki-link/i],
  ["coding", /代码|测试|bug|实现|修复|重构|前端|React|TypeScript|Rust/i],
];

const FRICTION_PATTERNS = [
  ["user_correction", /不对|不是|错了|纠正|遗漏|漏掉|你应该|不是这个/i],
  ["explicit_preference", /以后|下次|记住|默认|不要|必须|优先|偏好/i],
  ["verification_needed", /复核|核实|确认|验证|可核验|来源|证据/i],
  ["failure_or_blocker", /失败|报错|无法|blocked|permission denied|timeout|超时|不可用/i],
  ["handoff_or_delegation", /Claude|Codex|Hermes|agent|交接|prompt|下游/i],
];

const CHANGE_TASK_PATTERN = /修改|改进|优化|修复|重构|推进|落地|同步|增加|删除|调整|配置|迁移|实现|补强|接入|生成|改\b|fix|update|refactor|implement/i;
const EDIT_TOOL_PATTERN = /apply_patch|edit|write|record_execution_feedback|index_codex_sessions/i;
const READ_ONLY_PATTERN = /只读任务|不要修改任何文件|先不要执行任何修改|不要改文件|只看不改/i;

function classifyFamilies(text) {
  const families = FAMILY_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
  return families.length > 0 ? families : ["general"];
}

function collectSignals(text) {
  return FRICTION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function buildLearningNotes(record, combinedText) {
  const notes = [];
  if (record.is_change_task) {
    notes.push("change_task: review what the user asked to modify and whether the implementation pattern should be reused");
  }
  if (/以后|下次|记住|默认|不要|必须|优先|偏好/.test(combinedText)) {
    notes.push("preference_candidate: user expressed a possible durable working preference");
  }
  if (/不对|不是|错了|纠正|遗漏|漏掉/.test(combinedText)) {
    notes.push("correction_candidate: user corrected the agent; inspect before future similar work");
  }
  if (/复核|核实|确认|验证|可核验|来源|证据/.test(combinedText)) {
    notes.push("verification_candidate: user emphasized verification or source traceability");
  }
  return notes;
}

function parseSessionFile(filePath, sessionsDir) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const userMessages = [];
  const assistantMessages = [];
  const toolNames = new Map();
  const eventTypes = new Map();
  let meta = {};
  let startedAt = "";
  let updatedAt = "";
  let turnCount = 0;

  lines.forEach((line) => {
    const record = safeJsonParse(line);
    if (!record) {
      return;
    }

    if (record.timestamp) {
      if (!startedAt) {
        startedAt = record.timestamp;
      }
      updatedAt = record.timestamp;
    }

    if (record.type) {
      addMapCount(eventTypes, record.type);
    }

    if (record.type === "session_meta") {
      meta = record.payload || {};
      if (meta.timestamp) {
        startedAt = meta.timestamp;
      }
      return;
    }

    if (record.type === "turn_context") {
      turnCount += 1;
      return;
    }

    const payload = record.payload || {};
    if (record.type === "response_item") {
      if (payload.type === "message") {
        const text = extractContentText(payload.content);
        if (!text || isSessionScaffoldText(text)) {
          return;
        }
        if (payload.role === "user") {
          userMessages.push(text);
        } else if (payload.role === "assistant") {
          assistantMessages.push(text);
        }
      } else {
        addMapCount(toolNames, payload.name || payload.type || "response_item");
      }
    }

    if (record.type === "event_msg") {
      if (payload.type) {
        addMapCount(eventTypes, `event:${payload.type}`);
      }
      if (payload.message && /error|failed|失败|报错|permission denied|timeout/i.test(payload.message)) {
        addMapCount(toolNames, "error-signal");
      }
    }
  });

  const userText = userMessages.join("\n");
  const assistantText = assistantMessages.join("\n");
  const combinedText = [userText, assistantText].join("\n");
  const families = classifyFamilies(combinedText);
  const signals = collectSignals(combinedText);
  const toolSummaryText = topMapEntries(toolNames, 20).map((item) => item.name).join(" ");
  const isReadOnlyTask = READ_ONLY_PATTERN.test(userText);
  const isChangeTask = !isReadOnlyTask && (CHANGE_TASK_PATTERN.test(userText) || EDIT_TOOL_PATTERN.test(toolSummaryText));
  const relativePath = path.relative(sessionsDir, filePath);

  const record = {
    id: meta.id || hashText(filePath).slice(0, 24),
    session_id: meta.id || "",
    path: filePath,
    relative_path: relativePath,
    cwd: meta.cwd || "",
    originator: meta.originator || "",
    model: meta.model || "",
    cli_version: meta.cli_version || "",
    started_at: startedAt,
    updated_at: updatedAt,
    turn_count: turnCount,
    line_count: lines.length,
    user_message_count: userMessages.length,
    assistant_message_count: assistantMessages.length,
    tool_call_count: Array.from(toolNames.values()).reduce((sum, count) => sum + count, 0),
    tool_names: topMapEntries(toolNames, 10),
    event_types: topMapEntries(eventTypes, 10),
    task_families: families,
    friction_signals: Array.from(new Set(signals)),
    is_read_only_task: isReadOnlyTask,
    is_change_task: isChangeTask,
    first_user_message: truncateText(userMessages[0] || "", 360),
    last_user_message: truncateText(userMessages[userMessages.length - 1] || "", 360),
    assistant_closeout: truncateText(assistantMessages[assistantMessages.length - 1] || "", 420),
    retrieval_text: [
      userMessages[0] ? `first user: ${truncateText(userMessages[0], 600)}` : "",
      userMessages[userMessages.length - 1] ? `last user: ${truncateText(userMessages[userMessages.length - 1], 600)}` : "",
      assistantMessages[assistantMessages.length - 1] ? `assistant closeout: ${truncateText(assistantMessages[assistantMessages.length - 1], 700)}` : "",
      families.length > 0 ? `families: ${families.join(", ")}` : "",
      signals.length > 0 ? `signals: ${Array.from(new Set(signals)).join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  };

  record.learning_notes = buildLearningNotes(record, combinedText);
  return record;
}

function buildReview(records, sessionsDir) {
  const cwdStats = new Map();
  const familyStats = new Map();
  const signalStats = new Map();

  records.forEach((record) => {
    addMapCount(cwdStats, record.cwd || "(unknown)");
    record.task_families.forEach((family) => addMapCount(familyStats, family));
    record.friction_signals.forEach((signal) => addMapCount(signalStats, signal));
  });

  const reviewQueue = records
    .filter((record) => record.friction_signals.length > 0)
    .sort((left, right) => {
      if (right.friction_signals.length !== left.friction_signals.length) {
        return right.friction_signals.length - left.friction_signals.length;
      }
      return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
    })
    .slice(0, 20);
  const changeLearningQueue = records
    .filter((record) => record.is_change_task || record.learning_notes.length > 0)
    .sort((left, right) => {
      if (right.learning_notes.length !== left.learning_notes.length) {
        return right.learning_notes.length - left.learning_notes.length;
      }
      return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
    })
    .slice(0, 24);

  return {
    generated_at: new Date().toISOString(),
    sessions_dir: sessionsDir,
    total_sessions: records.length,
    top_cwds: topMapEntries(cwdStats, 10),
    top_task_families: topMapEntries(familyStats, 12),
    top_friction_signals: topMapEntries(signalStats, 12),
    recent_sessions: records.slice(-12).reverse().map((record) => ({
      id: record.id,
      updated_at: record.updated_at,
      cwd: record.cwd,
      task_families: record.task_families,
      first_user_message: record.first_user_message,
    })),
    review_queue: reviewQueue.map((record) => ({
      id: record.id,
      updated_at: record.updated_at,
      cwd: record.cwd,
      task_families: record.task_families,
      friction_signals: record.friction_signals,
      first_user_message: record.first_user_message,
      path: record.path,
    })),
    change_learning_queue: changeLearningQueue.map((record) => ({
      id: record.id,
      updated_at: record.updated_at,
      cwd: record.cwd,
      task_families: record.task_families,
      friction_signals: record.friction_signals,
      learning_notes: record.learning_notes,
      first_user_message: record.first_user_message,
      last_user_message: record.last_user_message,
      path: record.path,
    })),
  };
}

function renderMemoryCandidatesMarkdown(review) {
  const lines = [
    "# Codex Memory Candidates",
    "",
    `Generated: ${review.generated_at}`,
    "",
    "These are candidates for discussion before anything is written into durable Codex memory.",
    "",
  ];

  if (review.change_learning_queue.length === 0) {
    lines.push("- No change-learning candidates were detected.");
    return lines.join("\n");
  }

  review.change_learning_queue.slice(0, 20).forEach((item) => {
    lines.push(`## ${item.updated_at || "no time"} — ${item.task_families.join(", ")}`);
    lines.push(`- First request: ${item.first_user_message || item.id}`);
    if (item.last_user_message && item.last_user_message !== item.first_user_message) {
      lines.push(`- Last request: ${item.last_user_message}`);
    }
    if (item.learning_notes.length > 0) {
      lines.push(`- Candidate signals: ${item.learning_notes.join("; ")}`);
    }
    if (item.friction_signals.length > 0) {
      lines.push(`- Friction signals: ${item.friction_signals.join(", ")}`);
    }
    lines.push(`- Source: ${item.path}`);
    lines.push("");
  });

  lines.push("## Promotion Rule");
  lines.push("- Discuss with the user before promoting a candidate into Codex memory.");
  lines.push("- Prefer compact rules that prevent repeated failures across future sessions.");
  lines.push("- Do not promote raw case facts, private client details, or one-off task logistics.");
  lines.push("");

  return lines.join("\n");
}

function renderMarkdown(review, ndjsonPath, jsonPath) {
  const lines = [
    "# Codex History Review",
    "",
    `Generated: ${review.generated_at}`,
    `Sessions indexed: ${review.total_sessions}`,
    `Sessions dir: ${review.sessions_dir}`,
    `Index: ${ndjsonPath}`,
    `Overview: ${jsonPath}`,
    "",
    "## Top Task Families",
  ];

  if (review.top_task_families.length === 0) {
    lines.push("- No task families were detected.");
  } else {
    review.top_task_families.forEach((item) => lines.push(`- ${item.name}: ${item.count}`));
  }

  lines.push("", "## Friction Signals");
  if (review.top_friction_signals.length === 0) {
    lines.push("- No friction signals were detected.");
  } else {
    review.top_friction_signals.forEach((item) => lines.push(`- ${item.name}: ${item.count}`));
  }

  lines.push("", "## Human Discussion Queue");
  if (review.review_queue.length === 0) {
    lines.push("- No session currently needs human review.");
  } else {
    review.review_queue.slice(0, 12).forEach((item) => {
      lines.push(`- ${item.updated_at || "no time"} [${item.task_families.join(", ")}] ${item.first_user_message || item.id}`);
      lines.push(`  signals: ${item.friction_signals.join(", ")}`);
      lines.push(`  path: ${item.path}`);
    });
  }

  lines.push("", "## Change-Learning Queue");
  if (review.change_learning_queue.length === 0) {
    lines.push("- No change-learning candidates were detected.");
  } else {
    review.change_learning_queue.slice(0, 12).forEach((item) => {
      lines.push(`- ${item.updated_at || "no time"} [${item.task_families.join(", ")}] ${item.first_user_message || item.id}`);
      if (item.learning_notes.length > 0) {
        lines.push(`  candidates: ${item.learning_notes.join("; ")}`);
      }
      lines.push(`  path: ${item.path}`);
    });
  }

  lines.push(
    "",
    "## Operating Rule",
    "- Treat this as recall and review material, not as promoted instruction.",
    "- Promote a lesson only after human discussion or repeated verified success.",
    "- Use Codex memory only for compact, durable rules approved for cross-session behavior.",
    "",
  );

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!["json", "markdown"].includes(args.format)) {
    throw new Error(`Invalid --format value: ${args.format}`);
  }

  const memoryDir = path.join(args.baseDir, "memory");
  const artifactsDir = path.join(args.baseDir, "artifacts");
  ensureDir(memoryDir);
  ensureDir(artifactsDir);

  const files = walkFiles(args.sessionsDir);
  const records = files.map((filePath) => parseSessionFile(filePath, args.sessionsDir))
    .sort((left, right) => String(left.updated_at || "").localeCompare(String(right.updated_at || "")));
  const review = buildReview(records, args.sessionsDir);

  const ndjsonPath = path.join(memoryDir, "codex-session-index.ndjson");
  const jsonPath = path.join(memoryDir, "codex-session-index.json");
  const reviewJsonPath = path.join(artifactsDir, "codex-history-review.json");
  const reviewMarkdownPath = path.join(artifactsDir, "codex-history-review.md");
  const memoryCandidatesPath = path.join(artifactsDir, "codex-memory-candidates.md");

  fs.writeFileSync(
    ndjsonPath,
    records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : ""),
    "utf8",
  );
  fs.writeFileSync(jsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  fs.writeFileSync(reviewJsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  fs.writeFileSync(reviewMarkdownPath, `${renderMarkdown(review, ndjsonPath, jsonPath)}\n`, "utf8");
  fs.writeFileSync(memoryCandidatesPath, `${renderMemoryCandidatesMarkdown(review)}\n`, "utf8");

  const result = {
    ok: true,
    mode: "index-codex-sessions",
    generated_at: review.generated_at,
    sessions_indexed: records.length,
    ndjson_path: ndjsonPath,
    json_path: jsonPath,
    review_json_path: reviewJsonPath,
    review_markdown_path: reviewMarkdownPath,
    memory_candidates_path: memoryCandidatesPath,
    review_queue_count: review.review_queue.length,
    change_learning_queue_count: review.change_learning_queue.length,
  };

  if (args.format === "markdown") {
    console.log(renderMarkdown(review, ndjsonPath, jsonPath));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
