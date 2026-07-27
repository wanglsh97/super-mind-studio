# add-agent-mcp-integration

为 Web Agent 增加平台托管的服务端 MCP 接入：运维通过环境配置固定的 Streamable HTTP
服务器与工具白名单，NestJS 负责发现、调用、凭证和审计，浏览器与模型均不能选择任意端点或
读取凭证。
