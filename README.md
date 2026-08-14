# dsh-sidebar-qa

DeepSeek Harness（DSH）Web 插件：在对话里**划选任意文本 → 点击「提问」→ 右侧面板问答**。

基于dsh-better-sidebar开发的第三方拓展Tab页面。实现类codex侧边提问/claude code的/btw功能

插件自动创建一条**同工作区的独立 DSH 会话**（命名 `❓追问·<主题>`），用**快速无思考模型**把主对话上下文压缩成小摘要后与引文一起注入，回答过程**完全不打断主对话**。追问会话在左侧边栏可见、可继续、可归档，并保持与主对话的从属关系（插件自维护映射）。

![演示动画](/demo.gif)

## 前置依赖（必装）

`dsh-better-sidebar`  **必须安装**（未安装时本插件**不激活**，无任何 UI/行为，也不创建会话）。

```bash
dsh plugin --profile web add dsh-better-sidebar
```

## 安装

```bash
# 通过 git（推荐）
dsh plugin --profile web add git+https://github.com/ChenRuoT/dsh-sidebar-qa.git

# 或本地路径
dsh plugin --profile web add <本仓库路径>
```

重启 `dsh web`（host 半改动需要重启；client 改动浏览器硬刷新即可）。

## 使用

1. 在任意对话（主对话或追问对话）中划选一段文本，点击浮层「提问」。
2. 右侧「❓ 追问」面板变成一条**内嵌对话**：引文/问题在侧边栏内流式回答，输入框固定在下方面板底部，**不会跳转到子对话大窗口**。
3. 回答过程中可在输入框继续追问（Enter 发送、Shift+Enter 换行），所有问答都在侧边栏内完成。
4. 每个追问仍是同工作区的独立会话（`❓追问·<主题>`），主对话零打断；追问可以**嵌套**（在追问对话里再划选提问会生成新的子追问）。
5. 侧边栏「追问记录」tab 按根（主）会话分组，以分层树列出所有（嵌套）追问，点击跳转。

## 配置

配置走 DSH 设置服务 `sidebarqa` 命名空间（settings.yaml 或设置页）：

| 键 | 默认 | 说明 |
|---|---|---|
| `summarizeProvider` | `''` | 摘要快速模型渠道；空 = 继承被追问会话的 provider |
| `summarizeModel` | `deepseek-v4-flash` | 摘要快速无思考模型 |
| `summarizeReasoningEffort` | `off` | 摘要思考模式（`off` = 关闭思考） |
| `summarizeBudgetTokens` | `160` | 背景摘要输出预算（tokens） |
| `recentWindowMessages` | `2` | **近原文**保留的最近消息条数（当前状态锚点，不经过模型） |
| `backgroundWindowMessages` | `12` | 交给模型压缩的较早消息条数上限 |
| `answerProvider` | `deepseek-official` | 子对话回答模型渠道 |
| `answerModel` | `deepseek-v4-flash` | 子对话回答模型 |
| `answerReasoningEffort` | `off` | 子对话思考模式（`off` = 关闭思考） |

> 上下文注入刻意保持轻量：旧背景压成**最多 3 句话**（目标 / 当前进度 / 未决事项），近期只保留最近 2 条且每段强截断（≤400 字符）；模型侧**从新到旧**提交，让当前进度落在注意力最强位置。摘要失败/无渠道时自动降级为「仅近期对话 + 引文 + 问题」，问答不中断。

## 架构

```
dsh-sidebar-qa (bundle: dsh.bundle + package.json#dsh.client)
├── src/index.ts            host：/sidebarqa/api 摘要服务 + sidebarqa 设置命名空间
├── src/summarize.ts        表面文本抽取 + 流组装（纯函数，可测）
├── src/config.ts           设置 schema + 默认值
├── src/context-types.ts    结构化 cordis 服务面 + Context 增补
└── src/client/             浏览器：选区捕获、浮层、问答面板、会话编排、追问记录
    ├── index.tsx           apply：注册 2 个 better-sidebar tab + 浮层
    ├── selection.ts        选区捕获与校验（单消息/非流式/≤2000 字符）
    ├── SelectionPopover.tsx 划选浮层「提问」按钮
    ├── AskPanel.tsx        ❓ 追问 tab（内嵌对话：流式 transcript + 底部输入框 + 追问切换）
    ├── HistoryPanel.tsx     追问记录 tab（根会话→嵌套追问 分层树）
    ├── orchestrate.ts      create → rename → selectModel(默认 flash/关思考) → prompt + 继续追问
    ├── store.ts            父→子 映射（localStorage 持久化，支持嵌套）+ 待提问引文
    ├── injection.ts        XML 转义/消毒 + 注入格式 + 主题生成
    ├── answer.ts           历史流 → 回答文本折叠
    └── api.ts              /sidebarqa/api fetch 封装 + 当前模型读取
```

### 关键数据流

```
划选文本 ─▶ 浮层[提问] ─▶ 右侧面板(引文 + 底部输入框)
  回车 ─▶ ① host 摘要：sessionQuery.readSurface(被追问会话) → llm 快速无思考模型压缩
          ② client 创建会话 sessions.create(workspaceId)
          ③ rename → "❓追问·<主题>"
          ④ selectModel(默认 deepseek-v4-flash, 思考关闭)
          ⑤ prompt(摘要块 + <quoted_context> + 问题)
        ─▶ 面板轮询 sessions.history 流式渲染 transcript（不跳转大窗口）
        ─▶ 底部输入框继续追问；主对话零影响；追问可嵌套
```

### 上下文注入格式（首条消息）

```
<统领性指令：这是「侧边栏追问」，只围绕划选文本主题直接回答……>

【主对话上下文】
【背景】<模型压缩的旧历史，最多 3 句话>
【近期对话】<最近 2 条近原文，每条 ≤400 字符>

<quoted_context source="agent-history" label="Agent 回复"
                message_id="<id>" role="assistant" turn="<n>">
<引文原文>
</quoted_context>

问题：<用户输入>
```

统领性指令置于**输入最前**，利用注意力机制让模型先定调「聚焦划选文本」再读上下文；用户问题虽然在输入末尾，但划选文本（`quoted_context`）与指令共同锚定了回答范围。追问会话内的后续消息默认不带主对话上下文（只有首条携带）。

## 构建与测试

```bash
pnpm install
pnpm build      # tsc 声明 + tsdown（lib/index.js + lib/client.js + lib/client-registry.js）
pnpm test       # vitest 单测（injection / summarize / answer / store）
pnpm typecheck
```

## License

MIT
