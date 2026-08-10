# add-agent-tool-error-resilience

统一 Agent 工具内部的错误包装和 Pi 兼容的执行进度，使模型收到具体、可修复的错误文本，
并让用户可以实时看到长时间工具的 best-effort 进度。

本 change 不重写 Pi core，不接管 Agent 控制流；Pi 继续负责异常转 tool result，以及继续、
重试或结束的决定。
