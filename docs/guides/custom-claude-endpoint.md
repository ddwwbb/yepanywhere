# 自定义 Claude API 端点与模型配置指南

Yep Anywhere 支持通过 Claude Code 配置文件自定义 API 端点和模型，将请求路由到兼容 Anthropic Messages API 的第三方服务（如智谱 GLM、DeepSeek、本地 Ollama 等）。

---

## 配置方式

编辑 `~/.claude/settings.json` 或 `~/.claude/settings.local.json`，在 `env` 字段中添加环境变量：

```json
{
  "env": {
    "API_TIMEOUT_MS": "600000",
    "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "你的 API 密钥",
    "ANTHROPIC_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.1"
  }
}
```

配置完成后重启 Yep Anywhere 服务即可生效，无需额外设置系统环境变量。

---

## 支持的环境变量

### API 端点与认证

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_BASE_URL` | 自定义 API 端点地址 |
| `ANTHROPIC_AUTH_TOKEN` | API 认证令牌 |
| `ANTHROPIC_API_KEY` | API 密钥（与 AUTH_TOKEN 二选一） |
| `API_TIMEOUT_MS` | 请求超时时间（毫秒） |

### 模型别名

通过这些变量可以将 Claude Code 内部的模型引用重映射到自定义模型：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_MODEL` | 默认模型 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet 级别模型别名 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus 级别模型别名 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku 级别模型别名 |

### Claude Code 行为控制

| 变量 | 说明 |
|------|------|
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 设为 `1` 禁用非必要网络请求 |
| `DISABLE_INSTALLATION_CHECKS` | 设为 `1` 跳过安装检查 |
| `DISABLE_TELEMETRY` | 设为 `1` 禁用遥测 |
| `ENABLE_TOOL_SEARCH` | 设为 `1` 启用工具搜索 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 设为 `1` 启用实验性团队功能 |

---

## 配置文件优先级

Yep Anywhere 读取两个配置文件并合并：

1. `~/.claude/settings.json` — 用户全局配置
2. `~/.claude/settings.local.json` — 本地覆盖配置（优先级更高）

合并规则：

- `settings.local.json` 中的 `env` 字段覆盖 `settings.json`
- 系统环境变量覆盖配置文件中的同名变量
- 配置文件解析失败时静默跳过，不影响正常运行

---

## 常见配置示例

### 智谱 GLM

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "你的智谱 API Key",
    "ANTHROPIC_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.1"
  }
}
```

### 本地 Ollama

需要 Ollama 0.14+ 且已启用 Anthropic Messages API 兼容模式：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:11434/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "ollama",
    "ANTHROPIC_MODEL": "qwen3:32b",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3:32b",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3:32b",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3:8b"
  }
}
```

---

## 工作原理

1. Yep Anywhere 启动 Claude Code CLI 子进程前，读取 `~/.claude/settings*.json` 中的 `env` 配置
2. 将配置文件中的环境变量与当前进程环境变量合并（进程环境变量优先）
3. 过滤掉内部变量（如 `npm_*`、`YEP_ANYWHERE_*`、`NODE_ENV` 等）
4. 将合并后的环境变量注入 Claude Code CLI 子进程

关键代码位于 `packages/server/src/sdk/providers/env-filter.ts`。

---

## 兼容性要求

自定义 API 端点必须**完整兼容 Anthropic Messages API**，包括：

- `POST /v1/messages` 端点
- 流式响应（SSE）
- 工具调用（Tool Use）协议
- 系统提示（System Prompt）处理
- 多轮对话上下文管理

> Claude Code CLI 不是简单的文本补全调用，它是一个完整的 Agent Runtime，对 API 的兼容性要求远高于普通聊天补全。仅支持 OpenAI-compatible API 的服务无法直接使用。

---

## 故障排查

| 问题 | 排查方向 |
|------|----------|
| 配置不生效 | 确认文件路径为 `~/.claude/settings.json`（不是项目目录） |
| 模型未识别 | 确认 `ANTHROPIC_MODEL` 和三个别名变量都已设置 |
| 连接超时 | 检查 `ANTHROPIC_BASE_URL` 是否可达，设置 `API_TIMEOUT_MS` |
| 认证失败 | 确认 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY` 正确 |
| 工具调用异常 | 自定义端点可能不完整支持 Claude Code 的工具协议 |
