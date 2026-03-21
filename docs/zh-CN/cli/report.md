---
read_when:
  - 你想基于本地 OpenClaw 状态生成脱敏后的 GitHub issue 草稿
  - 你想用 `gh` 提交公开的 bug 或功能请求
  - 你需要私下发送安全报告而不是创建公开 issue
summary: "`openclaw report` 的 CLI 参考（bug 报告、功能请求和私有安全报告包）"
title: report
x-i18n:
  generated_at: "2026-03-21T03:20:00Z"
  model: gpt-5.4
  provider: openai
  source_path: cli/report.md
  workflow: 15
---

# `openclaw report`

为 `openclaw/openclaw` 准备脱敏后的报告。

`openclaw report` 会把少量用户输入与本地运行时/配置上下文组合起来，生成：

- 公开 bug 报告草稿
- 公开功能请求草稿
- 私有安全报告包

公开的 bug 和功能请求可以选择用 `gh` 提交。安全报告永远不会创建公开 GitHub issue。

## 子命令

- `openclaw report bug`
- `openclaw report feature`
- `openclaw report security`

## 共享标志

- `--title <text>`：显式指定报告标题
- `--summary <text>`：简短摘要（公开报告中使用，也可作为回退标题）
- `--json`：输出结构化的脱敏 payload
- `--markdown`：仅输出渲染后的报告正文
- `--output <file>`：将脱敏后的正文写入文件
- `--submit`：在报告完整时提交公开 bug/feature issue
- `--yes`：跳过提交前的交互确认
- `--non-interactive`：禁用提示；公开提交时需要同时传 `--yes`

如果既没有传 `--json` 也没有传 `--markdown`，默认输出为人类可读的脱敏预览。

`--yes` 只会跳过最后的交互确认，不会跳过草稿生成、诊断收集或 probe 执行。

## Bug 报告

`openclaw report bug` 用于故障行为、回归问题或运行失败。

示例：

```bash
openclaw report bug \
  --summary "Gateway 在 mitmproxy 后超时" \
  --repro "1. 在代理后启动 gateway\n2. 发送任意 LLM 请求" \
  --expected "模型成功响应" \
  --actual "请求因超时失败" \
  --impact "阻塞所有 LLM 流量"
```

```bash
openclaw report bug \
  --summary "Gateway 在 mitmproxy 后超时" \
  --repro "1. 在代理后启动 gateway\n2. 发送任意 LLM 请求" \
  --expected "模型成功响应" \
  --actual "请求因超时失败" \
  --impact "阻塞所有 LLM 流量" \
  --probe gateway \
  --submit
```

Bug 专用标志：

- `--repro <text>`：复现步骤
- `--expected <text>`：期望行为
- `--actual <text>`：实际行为
- `--impact <text>`：对用户或运维的影响
- `--previous-version <text>`：可选的回归版本上下文
- `--evidence <text>`：额外证据
- `--additional-information <text>`：更宽泛的附加细节、线索、时间线或假设
- `--context <text>`：`--additional-information` 的兼容别名
- `--probe <general|model|channel|gateway|none>`：有限的证据采集模式

要达到可提交的 bug 报告状态，至少需要：

- `summary`
- `repro`
- `expected`
- `actual`
- `impact`

如果可用，还会自动收集：

- OpenClaw 版本
- OS / 运行时摘要
- 已配置的 model / provider 线索
- 在启用 `--probe` 时生成的简短探测摘要

Probe 说明：

- `general`：运行时摘要、代理环境上下文、gateway/model/channel 信号，以及可用时的一条近期脱敏错误摘要
- `gateway`：gateway 可达性、health 和代理上下文
- `model`：provider 认证概览，以及带有代理状态组合输出的有限 live model-path 检查
- `channel`：已配置 channel 摘要，以及近期 channel / runtime 问题线索

## 功能请求

`openclaw report feature` 用于产品改进或新能力需求。

示例：

```bash
openclaw report feature \
  --summary "添加 report dry-run 标志" \
  --problem "运维希望生成草稿而不直接触发 GitHub" \
  --solution "只有显式传 --submit 时才允许真正提交" \
  --impact "让脚本化 issue 编写更安全"
```

Feature 专用标志：

- `--problem <text>`：要解决的问题
- `--solution <text>`：提议的解决方案
- `--impact <text>`：预期影响
- `--alternatives <text>`：考虑过的替代方案
- `--evidence <text>`：支持证据或示例
- `--additional-information <text>`：更宽泛的附加细节、线索、时间线或假设
- `--context <text>`：`--additional-information` 的兼容别名
- `--probe <general|model|channel|gateway|none>`：可选的有限证据采集

要达到可提交的功能请求状态，至少需要：

- `summary`
- `problem`
- `solution`
- `impact`

## 安全报告

`openclaw report security` 用于私下提交漏洞或敏感披露。

示例：

```bash
openclaw report security \
  --title "Gateway token 出现在日志中" \
  --severity high \
  --impact "运维凭证泄露" \
  --component "gateway auth logging" \
  --reproduction "启用 verbose logging 并运行启动流程" \
  --demonstrated-impact "token 出现在终端输出中" \
  --environment "macOS 15.4, OpenClaw 2026.3.x" \
  --remediation "在日志输出前先 mask 授权值"
```

Security 专用标志：

- `--severity <text>`
- `--impact <text>`
- `--component <text>`
- `--reproduction <text>`
- `--demonstrated-impact <text>`
- `--environment <text>`
- `--remediation <text>`

规则：

- `report security` 永远不会调用 `gh issue create`
- `--submit` 不会触发公开 issue 创建，而是返回被阻止的提交状态
- 终端输出会保持为适合私有报告的内容
- 可使用 `--output` 或 `--markdown` 保存私有报告包，后续手动发送

私有提交路径：将完整安全报告发送到 `security@openclaw.ai`。

## 脱敏与提交流程

该命令会在渲染输出或提交前自动脱敏常见敏感值：

- token / bearer 值 / API key
- 邮箱地址
- 电话号码
- 私人用户句柄
- 本地用户路径前缀，例如 `/Users/<name>` 或 `/home/<name>`

对于公开的 bug 和 feature 报告：

- 只有显式传 `--submit` 才会创建 GitHub issue
- 交互式运行时会在 `gh issue create` 前要求确认
- 非交互式提交需要同时传 `--submit` 和 `--yes`
- 如果缺少必填字段，命令会返回结构化的阻止状态，而不是猜测内容
- 生成后的报告正文会附带一条简短来源说明，表明该草稿由 `openclaw report` 生成

## JSON 输出

`--json` 会输出稳定的脱敏 payload，字段包括：

- `kind`
- `title`
- `body`
- `labels`
- `evidence`
- `redactionsApplied`
- `missingFields`
- `submissionEligible`
- `submission`

该输出适合脚本和更高层的自动化流程。
