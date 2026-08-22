# 移除匿名登录实施任务

## 1. 规格与认证边界

- [x] 1.1 建立 change，明确稳定 OAuth 账号前提、历史匿名数据保留和知识库非目标
- [x] 1.2 删除 API 匿名登录端点，并在统一 Session 边界拒绝和撤销历史匿名 Session
- [x] 1.3 删除 Web 匿名登录入口、客户端 helper 和对应单元测试

## 2. 文档与验证

- [x] 2.1 更新产品、技术、部署、Swagger 和仓库协作说明，移除匿名登录现行能力描述
- [x] 2.2 运行 API/Web 相关测试、typecheck、build 和 OpenSpec strict validation
