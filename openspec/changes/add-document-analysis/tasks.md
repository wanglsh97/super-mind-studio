# Tasks

## 1. Sandbox 文件工具

- [x] 1.0 基于 `opensandbox/code-interpreter:v1.1.0` 提供 Super Mind Studio 项目统一的自定义 Sandbox 镜像，固定安装 `pypdf`、`reportlab`、`python-docx`、`openpyxl`，构建阶段和运行容器内均验证导入，并在 `.env.example`、Compose 配置和部署文档中接入 `OPEN_SANDBOX_IMAGE`
- [x] 1.1 扩展上传校验，支持最多 5 个、单文件 20 MB 以内的 PDF/DOCX/XLSX，并保留代码文件兼容性
- [x] 1.2 扩展 `read-file`，使用项目自定义 Sandbox 镜像中的 Python 库一次性提取 PDF、DOCX、XLSX 内容并阻止 Sandbox 越界
- [x] 1.3 扩展 `write-file`，支持三种格式创建和直接原地修改，默认创建 DOCX，并拒绝任意代码执行
- [x] 1.4 验证 `export-file` 对当前 Sandbox 文件的导出及释放后的过期行为

## 2. Web 文档能力

- [x] 2.1 接入上传文件到 Agent context 的路径注入和 loading/error 状态
- [x] 2.2 增加 PDF 原生、DOCX `docx-preview`、XLSX SheetJS 预览
- [x] 2.3 完成从零创建、分析、修改、预览和下载的对话闭环

## 3. 验证与交付

- [x] 3.1 添加工具单测和集成测试，覆盖文件类型、大小、数量、路径安全、读写和 Sandbox 释放
- [ ] 3.2 添加 Web E2E，覆盖上传、多文件分析、创建、修改、预览、下载和过期
- [ ] 3.3 运行相关测试、typecheck、lint、build 和 OpenSpec strict validation
