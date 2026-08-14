# 图像生成发布与人工验收

## 发布门禁

- 内容安全链路：开发前外部前置能力，发布负责人须在开放入口前确认仍有效。
- 百炼：仅配置华北2（北京）兼容 Base URL 和对应 API Key；建议使用低额度账号。
- OSS：`SKILL_OBJECT_STORE_DRIVER=oss`，Bucket 必须私有，应用只持有最小读写权限。
- 默认关闭：不配置 `BAILIAN_IMAGE_BASE_URL` 与 `BAILIAN_IMAGE_API_KEY`；两项同时配置后开放入口和四个内置模型。
- 不提供真实模型 CI smoke 脚本；自动测试只使用去敏 HTTP fixture。

## 最低成本人工验收记录

每个模型只生成一张、无水印、默认或最低可用质量。填写结果和控制台实际费用后才可视为验收完成。

| 顺序 | 平台模型      | 上游模型                          | 地域 | 参数                          | 日期/结果 | 实际费用 | 关闭方法         |
| ---- | ------------- | --------------------------------- | ---- | ----------------------------- | --------- | -------- | ---------------- |
| 1    | `qwen-image`  | `qwen-image-2.0-pro`              | 北京 | 1:1、2K、n=1、watermark=false | 待验收    | 待记录   | 清空两项百炼配置 |
| 2    | `wan-image`   | `wan2.7-image-pro`                | 北京 | 1:1、2K、n=1、watermark=false | 待验收    | 待记录   | 清空两项百炼配置 |
| 3    | `kling-image` | `kling/kling-v3-image-generation` | 北京 | 1:1、1K、n=1、watermark=false | 待验收    | 待记录   | 清空两项百炼配置 |
| 4    | `vidu-image`  | `vidu/vidu-image_reference2image` | 北京 | 1:1、1K、n=1、watermark=false | 待验收    | 待记录   | 清空两项百炼配置 |

## 开放顺序

1. 部署 migration 和关闭状态的应用代码。
2. 配置北京 Base URL/API Key 和现有私有 OSS。
3. 依上表逐个临时启用模型，执行最低成本请求并立即记录结果和费用。
4. 确认内容安全、低额度账号、私有 OSS 与跨用户隔离后，同时写入两项百炼配置并发布。

## 回滚演练

1. 同时清空 `BAILIAN_IMAGE_BASE_URL` 与 `BAILIAN_IMAGE_API_KEY`，Composer 隐藏入口且 API 拒绝新的 `image` Run。
2. 已提交任务继续由 Reconciler 终结，不再接受新的 Provider 提交。
3. 保持 API 与 Image Reconciler 运行，继续终结已经持久化且已提交的任务。
4. 不回滚或删除向后兼容 migration；保留 RequestLog、BillingRecord、已保存 CreationAsset 和私有 OSS 对象。
5. 验证临时图片随三小时 Sandbox 正常过期，已保存作品仍能从 `/creations` 预览和下载。
