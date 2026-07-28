# allow-concurrent-agent-runs-across-threads

允许同一用户在不同 Agent Thread 中并发运行任务，同时保持同一 Thread 最多一个 active run，
并通过服务端有界准入、逐 Thread 隔离和多运行状态恢复控制费用与竞态。
