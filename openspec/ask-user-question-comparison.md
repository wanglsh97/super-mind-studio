# AskUserQuestion 横向对比：qwen-code / OpenCode / Grok Build

> 对比三家 Agent 如何实现「模型向用户结构化提问」能力。  
> 分析基于仓库源码：`qwen-code`、`opencode`、`grok-build`（以及 `system_prompts_leaks/xAI/grok-build.md`）。

---

## 1. 一句话结论

| 产品 | 工具名 | 挂起机制 | 核心特点 |
|------|--------|----------|----------|
| **qwen-code** | `ask_user_question` | 复用 **tool confirmation** | 把提问做成特殊确认类型，答案经 `payload.answers` 回写 |
| **OpenCode** | `question` | 独立 **Question 服务 + Deferred** | Location 级 pending map；事件 `asked/replied/rejected` |
| **Grok Build** | `ask_user_question` | **工具内阻塞**（oneshot + 可选超时） | Shell 协调器 + ACP `ext_method`；Plan 模式有「闲聊/跳过面试」路径 |

三者模型侧意图相同（澄清需求 / 做选择），工程结构从「借道权限确认」→「独立问题服务」→「完整交互协议（含超时与 plan interview）」逐步变重。

---

## 2. 关键源码位置

### qwen-code

| 路径 | 职责 |
|------|------|
| `packages/core/src/tools/askUserQuestion.ts` | 工具定义、校验、confirmation、`execute` 格式化 |
| `packages/core/src/tools/tools.ts` | `ToolAskUserQuestionConfirmationDetails` |
| `packages/core/src/core/coreToolScheduler.ts` | Plan / YOLO 下特判：始终进入确认 |
| `packages/cli/.../AskUserQuestionDialog.tsx` 等 | CLI / WebUI / Desktop / web-shell UI |

### OpenCode

| 路径 | 职责 |
|------|------|
| `packages/opencode/src/tool/question.ts` | V1 工具 |
| `packages/core/src/tool/question.ts` | V2 工具（BuiltInTools） |
| `packages/core/src/question.ts` | `QuestionV2.ask/reply/reject` + Deferred |
| `packages/schema/src/question.ts` | Prompt / Answer / Event schema |
| `packages/tui/.../question.tsx`、`packages/app/.../session-question-dock.tsx` | UI |

### Grok Build

| 路径 | 职责 |
|------|------|
| `crates/codegen/xai-grok-tools/.../ask_user_question/mod.rs` | 工具 `run()`：校验 → 发请求 → 阻塞 → 格式化 |
| `.../ask_user_question/types.rs` | ACP wire + 进程内 oneshot 协议 |
| `.../ask_user_question/format.rs` | 四条用户路径的模型可见文案 |
| `xai-grok-workspace-types/.../interaction.rs` | `NeedUserAnswer` / `UserAnswer` 线格式 |
| `xai-grok-shell` / `xai-grok-pager` | 协调器与问卷 UI（文档与 changelog 描述） |

---

## 3. 调用链路对比

### 3.1 qwen-code：Confirmation 通道

```text
模型 tool_call(ask_user_question)
  → Scheduler: permission = ask（交互/ACP）
  → getConfirmationDetails({ type: 'ask_user_question', questions })
  → UI Dialog 收集答案
  → onConfirm(Proceed*, payload.answers)
  → execute() 读 this.userAnswers
  → tool result: "User has provided the following answers:\n\n**Header**: value"
```

要点：

- 没有独立 Question 服务；答案存在 invocation 实例字段。
- 非交互且无 ACP：直接返回错误，无法提问。
- Plan mode / YOLO：**特判不被挡、不被自动批准**，必须让用户看到问卷。
- `shouldDefer: false`：始终暴露，避免模型改用纯文本提问。

### 3.2 OpenCode：QuestionV2 Deferred

```text
模型 tool_call(question)
  → PermissionV2.assert(action: "question")
  → QuestionV2.ask({ sessionID, questions, tool })
       · 分配 que_* id
       · pending.set(id, Deferred)
       · publish question.v2.asked
       · await Deferred
  → UI reply / reject
       · reply → Deferred.succeed(answers)
       · reject → Deferred.fail(RejectedError)
  → toModelOutput:
      "User has answered your questions: \"q\"=\"a\", .... You can now continue..."
```

要点：

- 问题生命周期与工具 confirmation 解耦，是一等会话事件。
- Location 隔离：不同 Location 的 reply 不能 settle 对方的 Deferred。
- 启用：V1 在 `app`/`cli`/`desktop` 默认开；否则需 `OPENCODE_ENABLE_QUESTION_TOOL`。

### 3.3 Grok Build：工具内阻塞 + ACP 往返

```text
模型 tool_call(ask_user_question)
  → 校验：至少一题；题目文本不可重复
  → 取 UserQuestionSender（mpsc）
  → oneshot + UserQuestionRequest(tool_call_id, questions)
  → 通知 UserQuestionAsked（给 gateway/UI）
  → Shell 协调器 → ACP ext_method → Pager UI
  → 用户路径之一回来 settle oneshot
  → format::* → AskUserQuestionOutput::UserAnswered { message }
```

用户路径（全部算成功 Completed，不是 tool failure）：

| Outcome | 含义 | 模型侧结果 |
|---------|------|------------|
| `Accepted` | 提交答案 | `User has answered your questions: "q"="label"...` |
| `ChatAboutThis` | Plan 模式：先聊再说 | 带部分答案的引导文案 |
| `SkipInterview` | Plan 模式：跳过面试直接规划 | 带部分答案的引导文案 |
| `Cancelled` / 超时 | 拒绝或超时 | `User declined to answer... Continue with best judgment...` |

要点：

- **默认阻塞最长约 30 分钟**（整批问卷共用一个 timer）；可配置 / 可关。
- 兼容 Claude 别名：`AskUserQuestion` → `ask_user_question`。
- 迁移期若无 `UserQuestionSender`，可 fire-and-forget 发通知并立即返回 `QuestionsSent`（旧路径）。
- `--no-ask-user` 可关掉（含子 agent）。

---

## 4. 参数 Schema 对比

| 字段 | qwen-code | OpenCode | Grok Build |
|------|-----------|----------|------------|
| 工具名 | `ask_user_question` | `question` | `ask_user_question` |
| 问题列表 | `questions[]`（**1–4**） | `questions[]` | `questions[]`（≥1，无硬上限） |
| 题干 | `question` | `question` | `question` |
| 短标签 | `header`（chip，schema 建议 ≤12） | `header`（≤30） | **无** |
| 选项 | 2–4 个；`label` + `description` | `label` + `description` | `label` + `description` |
| 多选 | `multiSelect` | `multiple` | `multi_select`（兼容 `multiSelect`） |
| 自定义答案 | UI 强制 Other | `custom`（默认 true） | UI 强制 Other |
| 选项预览 | 无 | 无 | **`preview`**（聚焦时展示 mockup/代码） |
| 推荐选项约定 | 第一项 + `(Recommended)` | 同左 | 同左 |
| 元数据 | `metadata.source`（分析用） | 无 | 内部 `id` / `use_id_keyed_format`（对模型隐藏） |

### 答案形态

| | qwen-code | OpenCode | Grok Build |
|--|-----------|----------|------------|
| Key | 题目下标 `"0"`,`"1"` | 按题目顺序的数组 | **题目全文**（IndexMap） |
| Value | 字符串（label 或自定义） | `string[]`（每题可选多个 label） | `Vec<string>` labels；另有 `annotations.notes/preview` |
| 取消 | `"User declined to answer the questions."` | `RejectedError` / Unanswered | `CANCEL_TEXT`（引导继续做事） |

---

## 5. 与 Plan Mode / 权限的关系

| | qwen-code | OpenCode | Grok Build |
|--|-----------|----------|------------|
| Plan 中能否问 | **能**（scheduler 特判） | 权限规则控制；plan agent 可 allow | **能**；能力 taxonomy 标为 plan 安全 |
| Plan 中用途 | 澄清需求；**禁止**用它问「计划 OK 吗」（交给 ExitPlanMode） | 通用澄清 | Interview：澄清后 ExitPlanMode；额外 **ChatAboutThis / SkipInterview** |
| Auto/YOLO | 不可自动批准提问 | permission assert | 工具只读；auto_mode 白名单含该工具 |
| 非交互 | 无 ACP 则失败 | 取决于客户端是否挂 reply | 超时/取消走 CANCEL_TEXT；可 `--no-ask-user` |

---

## 6. UI / 协议层差异

```text
qwen-code
  ToolConfirmationDetails(type=ask_user_question)
    → 各前端 Dialog
    → payload.answers

OpenCode
  Event: question.v2.asked
    → TUI question route / App question dock / HTTP handlers
    → question.v2.replied | rejected

Grok Build
  Notification: UserQuestionAsked
  + ACP ext_method (AskUserQuestionExtRequest/Response)
  + in-process mpsc/oneshot (tool ↔ shell coordinator)
    → Pager 问卷 UI（含 preview、plan 专用按钮）
```

Grok 的协议分层最完整：工具 crate、shell 协调器、pager UI、workspace wire（`NeedUserAnswer`）职责分离；qwen 最「粘」在既有确认框架上；OpenCode 居中，用独立服务但不引入超时/plan 面试语义。

---

## 7. 回灌模型的文案风格

**qwen-code**

```text
User has provided the following answers:

**Auth method**: OAuth
**Library**: date-fns
```

**OpenCode**

```text
User has answered your questions: "Which auth?"="OAuth", "Which library?"="date-fns". You can now continue with the user's answers in mind.
```

**Grok Build（Accepted）**

```text
User has answered your questions: "Which auth?"="OAuth", "Which library?"="date-fns". You can now continue with the user's answers in mind.
```

（可附带 `selected preview:` / `user notes:`）

**Grok Build（Cancel / Timeout）**

```text
User declined to answer the questions. Continue with the task using your best judgment, or ask different questions.
```

OpenCode 与 Grok 的 Accepted 文案几乎同构；qwen 更偏 markdown 列表。Grok 对取消/超时额外强调「继续做，别卡住」。

---

## 8. 设计取舍小结

### qwen-code：借道 Confirmation

- **优点**：实现面小；与现有权限/确认 UI 复用；Plan/YOLO 特判清晰。  
- **代价**：问题状态绑在 tool invocation 上；答案 key 用下标，可读性/稳健性弱于题干 key；无超时与 plan 面试分支。

### OpenCode：独立 Question 服务

- **优点**：事件化、可跨 UI/API reply；Location 隔离；schema 与工具解耦（V2 BuiltIn）。  
- **代价**：仍相对轻量——无 preview、无问卷超时、无 plan 专用 outcome；启用依赖 client 类型。

### Grok Build：阻塞式交互协议

- **优点**：完整 round-trip；超时可配；preview/notes；Plan interview 四路径；ACP 可跨进程；只读能力分类清晰。  
- **代价**：实现最重（tools + shell + pager + wire types）；迁移期还有 fire-and-forget 双路径。

---

## 9. 若要自研：推荐组合

1. **工具名**：对外兼容可用 `ask_user_question`；内部可用别名映射（Grok 对 Claude 的做法）。  
2. **挂起**：优先独立 Question 服务（OpenCode）或工具内 await（Grok），避免绑死 confirmation，除非产品确认框架已很强（qwen）。  
3. **Schema**：`question` + `options[{label,description}]` + `multi_select`；可选 `header`、`preview`、`custom`。  
4. **强制 Other**：由 UI 提供，不要让模型填「其他」选项。  
5. **答案 key**：用题干或稳定 id，避免纯下标。  
6. **取消语义**：返回 Completed + 引导继续（Grok），勿当成硬错误中断整轮。  
7. **Plan**：允许提问；禁止用提问代替 plan 审批；可选 Chat/Skip 面试分支。  
8. **超时**：默认长等待（分钟级）+ 可配置；超时等同用户跳过。  
9. **非交互**：明确失败或禁用，避免 silently 卡住。

---

## 10. 参考文件速查

```text
qwen-code/packages/core/src/tools/askUserQuestion.ts
opencode/packages/core/src/tool/question.ts
opencode/packages/core/src/question.ts
opencode/packages/schema/src/question.ts
grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/ask_user_question/mod.rs
grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/ask_user_question/types.rs
grok-build/crates/codegen/xai-grok-tools/src/implementations/grok_build/ask_user_question/format.rs
system_prompts_leaks/xAI/grok-build.md  §2.19 ask_user_question
```
