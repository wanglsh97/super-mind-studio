# Proposal: 临时沙箱文档分析

## Problem

现有 `read-file`、`write-file`、`export-file` 主要面向代码文件，无法支持用户上传、分析和修改 PDF、DOCX、XLSX，也无法在 Agent 对话中从零创建这些文档。

## Goals

1. 扩展现有文件工具，兼容代码文件并支持 PDF、DOCX、XLSX。
2. 支持用户上传最多 5 个文件，单文件最大 20 MB；文件仅存在当前 Sandbox。
3. 支持模型通过对话分析、创建和直接修改原文件；未指定创建格式时默认 DOCX。
4. 支持按文件格式预览和通过 `export-file` 下载。
5. Sandbox 释放后不再恢复、预览或下载文件。

## Non-goals

- 不上传 OSS，不建立持久化文档库或分析结果表。
- 不提供用户手动在线编辑器、版本历史、撤销和差异对比。
- 不支持 `.doc`、`.xls`、`.docm`、`.xlsm`。
- 不执行模型提供的任意 Python 或 shell 代码。
- 不保证复杂排版、宏、批注、修订记录、图表的完全保真。

## Acceptance

- `read-file` 能一次性返回 PDF 文本、DOCX 正文/表格及 XLSX 全部工作表、单元格和公式。
- `write-file` 能创建或直接覆盖 Sandbox 内的 PDF、DOCX、XLSX。
- Web 能分别预览 PDF、DOCX、XLSX，并能导出当前文件。
- 文档能力复用 Super Mind Studio 项目统一的自定义 Sandbox 镜像；该镜像基于 OpenSandbox `code-interpreter:v1.1.0` 构建，固定安装并验证 `pypdf`、`reportlab`、`python-docx`、`openpyxl`，部署配置不得依赖基础镜像预装这些库。
- 路径越界、非法类型、超过 20 MB 和超过 5 个文件会被拒绝。
- Sandbox 释放后预览和下载返回过期/不存在，且无持久化文件可恢复。
- 相关测试、typecheck、lint、build 和 OpenSpec strict validation 通过。

## Rollback

按任务 commit 回滚工具扩展、上传入口和预览组件；不删除既有代码文件工具行为或其他 Agent 数据。
