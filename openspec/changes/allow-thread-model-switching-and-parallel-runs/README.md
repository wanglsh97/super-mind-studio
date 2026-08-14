# allow-thread-model-switching-and-parallel-runs

允许用户在当前 Agent Thread 中切换默认模型而不新建会话，并在不同 Thread 间最多并行运行五个任务；同一 Thread 始终保持单 active run，历史 Run 独立快照实际选择的模型。
