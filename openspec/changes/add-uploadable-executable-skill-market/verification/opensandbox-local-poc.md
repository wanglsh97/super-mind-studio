# OpenSandbox 本地 PoC

## 验证范围

本记录对应任务 4.2，只验证 OpenSandbox 官方 Docker runtime 与 JavaScript SDK 的基础功能契约。它不替代任务 4.1、4.3–4.5 和 4.9 要求的独立 Linux ECS、gVisor、完整资源强制、网络隔离、并发与成本验收。

## 版本与环境

- 验证日期：2026-07-23（America/Los_Angeles）
- 宿主机：macOS 26.5，Intel x86_64
- 本地 Docker Engine：Colima 0.10.3 提供，Docker Server 29.5.2，runc
- Docker CLI：29.6.2
- OpenSandbox Server：0.2.2
- OpenSandbox JavaScript SDK：`@alibaba-group/opensandbox@0.1.10`
- Sandbox 镜像：`opensandbox/code-interpreter:v1.1.0`
- Execd 镜像：`opensandbox/execd:v1.0.21`

## 启动

OpenSandbox 官方要求 Python 3.10+ 和 Docker Engine 20.10+。本机系统 Python 3.9 不满足要求，因此 Server 通过 `uvx` 隔离使用 Python 3.12：

```bash
colima start --cpu 2 --memory 4 --disk 20 --runtime docker

poc_dir="$(mktemp -d /tmp/opensandbox-poc.XXXXXX)"
uvx --python 3.12 opensandbox-server init-config \
  "$poc_dir/sandbox.toml" \
  --example docker

OPENSANDBOX_INSECURE_SERVER=YES \
  uvx --python 3.12 opensandbox-server \
  --config "$poc_dir/sandbox.toml"
```

本地无 API Key 仅用于 PoC。生产环境不得设置 insecure acknowledgement，必须配置 `server.api_key`。

如果本机设置了全局 HTTP/SOCKS 代理，健康检查需要绕过代理：

```bash
curl --noproxy '*' http://127.0.0.1:8080/health
```

预期结果：

```json
{"status":"healthy"}
```

## 可重复验收

保持 Server 运行，在仓库根目录执行：

```bash
pnpm --filter @aigateway/api test:opensandbox-poc
```

可通过以下环境变量覆盖默认值：

- `OPEN_SANDBOX_DOMAIN`：默认 `127.0.0.1:8080`
- `OPEN_SANDBOX_PROTOCOL`：默认 `http`
- `OPEN_SANDBOX_API_KEY`：可选 API Key
- `OPENSANDBOX_POC_IMAGE`：默认 `opensandbox/code-interpreter:v1.1.0`
- `OPENSANDBOX_POC_REQUEST_TIMEOUT_SECONDS`：默认 180 秒

脚本断言以下行为：

1. 创建 sandbox 并等待状态变为 `Running`。
2. 创建 `/workspace/input`、`/workspace/work` 和 `/workspace/output`。
3. 通过 SDK 写入并读回 UTF-8 文件。
4. 在指定 `workingDirectory` 中执行 Shell。
5. 同时验证累计与流式 stdout/stderr。
6. 保留并验证非零退出码 `7`。
7. 使用 command ID 中断长命令，并确认中断后命令未产生预期的尾部文件。
8. 销毁 sandbox，并确认管理列表中已不存在。

SDK 的 `mode` 字段按文档传 `755`/`644` 这类十进制数字表示的权限文本值；传 JavaScript 八进制字面量 `0o755` 会序列化为 `493`，execd 会拒绝解析。

## 本次结果

- `/health` 返回 `200 {"status":"healthy"}`。
- 官方 Code Interpreter 镜像首次拉取约 284 秒。首次 SDK 创建请求使用 120 秒 HTTP timeout，客户端先超时；镜像拉取完成后没有残留 sandbox。
- 镜像缓存后，创建并 ready 用时 1327 ms。
- 工作目录返回 `/workspace/work`。
- stdout、stderr、退出码 7 和文件往返均符合断言。
- 长命令约 1516 ms 完成中断，`should-not-exist` 未生成。
- `kill()` 后 sandbox 从管理列表消失。

结论：OpenSandbox 0.2.2 + JavaScript SDK 0.1.10 的基础生命周期、命令和文件能力满足生产 Adapter 的接口前置条件。生产实现应预拉取固定镜像，且不得让冷镜像拉取共用普通 30–120 秒业务请求超时。
