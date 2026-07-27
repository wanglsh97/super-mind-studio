# OpenCodex 本机配置

本文记录 Super Mind Studio 开发机使用
[OpenCodex](https://github.com/lidge-jun/opencodex) 的配置。OpenCodex 是 Codex 前的本机代理，
不属于本项目的运行时依赖，也不会随 Web、API 或 Docker Compose 部署。

## 采用的配置

- OpenCodex `2.7.30`，Node.js 要求为 `>=18`；本机使用 Node.js `24.16.0`。
- 仅监听 `127.0.0.1:10100`，不向局域网或公网开放。
- 使用 `openai` 的 `openai-responses` forward 模式，复用现有 `codex login` 凭据。
- 使用 `direct` 账号模式，始终沿用当前 Codex 调用方/主登录，不启用账号池切换。
- 使用 Kimi OAuth 接入 `https://api.kimi.com/coding/v1`，默认 Kimi 模型为
  `kimi/kimi-k2.7-code`。
- 不在配置文件保存 API Key。
- 关闭 Web Search 和 Vision sidecar，避免代理额外发起模型调用。
- 保持 HTTP/SSE，不启用 WebSocket。
- 不启用历史记录重映射；loopback 注入仍保持原生 `openai` provider 标识。
- 使用按需启动 shim：启动 `codex` 时执行 `ocx ensure`，不安装常驻 launchd 服务。

实际的用户级配置位于 `~/.opencodex/config.json`。以下是等价的核心配置；OpenCodex CLI
还会维护 Kimi 模型列表、上下文窗口、输入模态和 reasoning 映射等 registry 元数据：

```json
{
  "port": 10100,
  "hostname": "127.0.0.1",
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "adapter": "openai-responses",
      "baseUrl": "https://chatgpt.com/backend-api/codex",
      "authMode": "forward",
      "codexAccountMode": "direct"
    },
    "kimi": {
      "adapter": "openai-chat",
      "baseUrl": "https://api.kimi.com/coding/v1",
      "authMode": "oauth",
      "defaultModel": "kimi-k2.7-code"
    }
  },
  "codexAutoStart": true,
  "syncResumeHistory": false,
  "multiAgentMode": "default",
  "websockets": false,
  "webSearchSidecar": {
    "enabled": false
  },
  "visionSidecar": {
    "enabled": false
  }
}
```

## 安装与启用

```bash
npm install -g --allow-scripts=bun @bitkyc08/opencodex
ocx codex-shim install
ocx start
```

Kimi 使用设备授权 OAuth。登录成功后，token 保存在用户级的 `~/.opencodex/auth.json`，
不得提交到仓库：

```bash
ocx login kimi
ocx sync
```

OpenCodex 启动后会以可逆方式更新 `~/.codex/config.toml` 和模型目录。loopback 模式下，
核心注入是将 Codex 的 `openai_base_url` 指向 `http://127.0.0.1:10100/v1`。

## 验证

```bash
ocx --version
ocx status
ocx health --json
ocx codex-shim status
curl --fail --silent http://127.0.0.1:10100/healthz
ocx provider show kimi
ocx models --json
```

需要验证真实路由时，可执行一个最小请求；该请求会使用当前 Codex 账号额度：

```bash
codex exec -m gpt-5.6-sol "只回复 OK"
codex exec -m kimi/kimi-k2.7-code "只回复 OK"
```

当前 Kimi registry 发布以下模型：

| Codex 模型 ID                   | 上下文窗口 | 说明                                               |
| ------------------------------- | ---------: | -------------------------------------------------- |
| `kimi/kimi-k2.7-code`           |    262,144 | 默认编程模型                                       |
| `kimi/kimi-k2.7-code-highspeed` |    262,144 | 高速编程模型                                       |
| `kimi/k3`                       |    262,144 | 文本/图像输入，支持 `low`、`high`、`max` reasoning |
| `kimi/k3[1m]`                   |  1,048,576 | 百万上下文，文本/图像输入                          |
| `kimi/kimi-k2.6`                |    262,144 | 兼容模型                                           |
| `kimi/kimi-k2.5`                |    262,144 | 兼容模型                                           |
| `kimi/kimi-for-coding`          |    262,144 | 兼容编程模型                                       |

## 日常操作与恢复

```bash
ocx gui                 # 打开本机管理界面
ocx models              # 查看代理发布的模型
ocx sync                # 重新同步模型及 Codex 配置
ocx logout kimi         # 删除 Kimi OAuth 登录
ocx stop                # 停止代理并恢复原生 Codex
ocx restore             # 代理继续运行，但恢复原生 Codex 配置
ocx restore back        # 重新把 Codex 指向运行中的代理
```

彻底卸载前必须先清理注入和用户级状态：

```bash
ocx uninstall
npm uninstall -g @bitkyc08/opencodex
```

## 故障排查

### Codex 报 `502 Bad Gateway`（url 指向 `http://127.0.0.1:10100/v1/responses`）

原因不在 OpenCodex 或 Kimi：本机开启了 Clash Verge 系统代理（`127.0.0.1:7897`）后，
Codex 的 HTTP 客户端会读取系统代理设置，把发往 `127.0.0.1:10100` 的 loopback 请求
也交给 mihomo；mihomo 将 loopback 目标按 MATCH 规则转发到远端节点，连接失败，
于是返回 502。直连 curl 验证代理和 Kimi OAuth 均正常时可据此定位。

修复（已验证）：为 Codex 进程设置 `NO_PROXY`，让 loopback 绕过系统代理：

```bash
# ~/.zshrc
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
```

注意 Codex 不读取 macOS 系统代理的绕过列表（ExceptionsList），必须显式设置
`NO_PROXY` 环境变量。另一种思路是在 mihomo 配置中为 `127.0.0.0/8` 增加
`DIRECT` 规则，但会改动代理全局配置，默认优先使用 `NO_PROXY` 方案。

## 安全边界

- 不要把 `~/.opencodex`、OAuth 凭据或真实 API Key 提交到本仓库。
- 不要把 `hostname` 改为 `0.0.0.0`；确需远程访问时，必须先配置
  `OPENCODEX_API_AUTH_TOKEN`、防火墙及可信网络边界。
- 新增第三方 provider 时使用 `${ENV_VAR}` 引用密钥，不要把密钥直接写入 JSON。
- OpenCodex 只影响开发机上的 Codex 请求路由，不改变 Super Mind Studio 的正式技术架构和服务流量。
