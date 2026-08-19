# Evolver Codex Hybrid

[![Verify package](https://github.com/ecuplalex-jpg/evolver-codex-hybrid/actions/workflows/ci.yml/badge.svg)](https://github.com/ecuplalex-jpg/evolver-codex-hybrid/actions/workflows/ci.yml)

一个可移植、文件化、默认保护隐私的 Evolver → Codex 桥接 Skill。

A portable, file-based, privacy-safe Evolver-to-Codex bridge skill.

> 这是社区桥接包，不是 OpenAI、Anthropic 或任何 Evolver 项目的官方产品。它只负责维护桥接工作流；通用复盘和“下次怎么做得更好”不属于本 Skill 的职责。

## 它解决什么问题

当外部 Evolver/OpenClaw 风格流程产生新的演化信号时，本包可以把这些信号转成 Codex 可读、可查询、可审阅的本地文件：

- 摄入新鲜 Evolver 风格输出；
- 检索稳定规则、执行反馈、任务会话和 Gene 草稿；
- 生成待人工审阅的 promotion packet；
- 维护反馈洞察、任务索引和 debrief reminder；
- 把 `sessions_spawn(...)` 一类宿主专用指令翻译为明确的本地行动建议。

它不会随包附带或上传你的真实记忆、会话、规则、客户材料或凭据。

## 快速开始

要求：Node.js 18+、Bash，以及一个可写的目标工作区。

```bash
git clone https://github.com/ecuplalex-jpg/evolver-codex-hybrid.git
cd evolver-codex-hybrid
bash verify.sh
bash install.sh /path/to/target-workspace
```

安装后，在目标工作区运行：

```bash
node scripts/evolver_codex_bridge.js --run-maintenance safe --format markdown
```

然后可以在 Codex 中提出：

```text
请检查这个工作区里的 evolver-hybrid 桥接配置，并说明下一步应该先读哪些本地产物。
```

完整说明见 [INSTALL.md](INSTALL.md) 和 [docs/evolver-codex-hybrid.md](docs/evolver-codex-hybrid.md)。

## 包结构

```text
evolver-codex-hybrid/
├── README.md
├── INSTALL.md
├── LICENSE
├── install.sh
├── verify.sh
├── skills/evolver-codex-hybrid/SKILL.md
├── scripts/
│   ├── evolver_codex_bridge.js
│   ├── index_codex_sessions.js
│   └── record_execution_feedback.js
└── docs/evolver-codex-hybrid.md
```

安装器会在目标工作区创建：

- `.agents/skills/evolver-codex-hybrid/`
- `scripts/`
- 一个空白、独立的 `evolver-hybrid/` 工作树

新建的 `evolver-hybrid/.gitignore` 默认忽略整个运行时工作树，避免会话摘要、规则、反馈和原始输入被误提交。重复安装时，包拥有的 Skill 和脚本会刷新；已有 `.gitignore`、memory、artifact、inbox 和 raw-input 状态文件会原样保留。遇到受管理路径为符号链接或异常文件类型时，安装器会拒绝继续。

## 隐私与授权边界

本仓库只包含通用代码、说明和空白初始化逻辑，明确不包含：

- Codex/Claude 会话历史；
- 私有 stable rules 或 routing map；
- 真实执行反馈和 Evolver 原始输出；
- 用户路径、账号凭据、客户或案件材料；
- 已获人工批准的真实 promotion packet。

会话索引会在本地生成任务摘要和源路径，因此即使没有联网，也应把整个 `evolver-hybrid/` 视为私有运行时数据。安装器已经默认忽略该目录；如需纳入版本控制，应由使用者逐文件审查后显式处理。

自由文本 `--promote-rule` 已禁用。规则晋升必须先生成审阅包，由人工补全批准字段并绑定最终文件 SHA-256，之后才能应用。`--run-maintenance all` 会运行候选晋升写入流程，不能当只读心跳；日常维护请使用 `safe`。

公开版不预装作者自己的 candidate-classification 规则。第一次运行候选分类时，会创建 `evolver-hybrid/memory/codex-candidate-promotion-rules.json`，其中 `rules` 默认为空；在使用者明确配置前，所有候选都保持 `review-first`，不会自动跳过、标记 handled 或提出作者预设的稳定规则。

## P0 Failure Register

| ID | Failure | Why it matters | Prevention | Verification |
|---|---|---|---|---|
| P0-001 | 发布包或目标仓库混入本机记忆、会话或凭据 | 造成隐私泄露 | 公开树采用文件 allowlist；安装时写入私有运行时 `.gitignore` | verifier 的 tree/privacy/runtime-ignore checks |
| P0-002 | 重装覆盖真实规则或反馈 | 破坏用户工作资产 | 状态文件仅在不存在时初始化 | verifier 的 sentinel no-clobber replay |
| P0-003 | 安装器跟随符号链接写出目标目录 | 可能覆盖任意本机文件 | managed path 类型和 symlink fail-closed | verifier 的目录/文件 symlink probes |
| P0-004 | 未经人工批准直接晋升规则 | 把候选误当稳定行为 | 禁用自由文本晋升；批准包绑定 SHA-256 | verifier 的 direct-promotion rejection check |
| P0-005 | 把 `all` 当作安全维护 | 产生非预期候选写入 | 文档和 Skill 明示 `safe` 默认 | verifier 的 implicit/explicit safe checks |
| P0-006 | 公开包自动套用作者自己的分类规则 | 污染他人的候选与行为治理 | portable default 的 `rules` 为空，未匹配候选保持 `review-first` | verifier 的 empty-default classifier replay |

## 许可证

[MIT License](LICENSE)
