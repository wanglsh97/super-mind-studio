# Design: 临时沙箱文档分析

## Architecture

复用现有 Agent Sandbox 和三个文件工具，不新增独立文件服务、OSS 存储或后台 Worker：

```text
Web upload → API/Sandbox → Agent context(path)
                         → read-file → Python extraction
                         → write-file → Python document mutation
                         → preview/export → Web or export-file
```

服务端只把 Sandbox-relative path 注入上下文，例如 `workspace/report.docx`；工具解析后必须将最终路径限制在当前 Sandbox 根目录内。

## File handling

- PDF：使用 `pypdf` 读取，使用 `reportlab` 或固定 Python 处理逻辑生成/修改。
- DOCX：使用 `python-docx` 读取正文和表格，并创建或修改 DOCX。
- XLSX：使用 `openpyxl` 返回全部工作表、单元格和公式，并创建或修改 XLSX。
- 基础镜像 `sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.1.0` 实际未预装以上依赖。必须基于该镜像构建 Super Mind Studio 项目统一的自定义 Sandbox 镜像；文档分析只是首个使用方，后续项目能力继续复用该镜像。镜像固定安装 `pypdf`、`reportlab`、`python-docx` 和 `openpyxl`，并在构建阶段执行导入验证；运行时通过 `OPEN_SANDBOX_IMAGE` 指向该自定义镜像，禁止依赖 Sandbox 启动后临时安装。
- 自定义镜像应保留 OpenSandbox 基础镜像的 entrypoint 和运行时环境。依赖安装使用镜像内已有的 `uv`，以 system Python 安装；镜像发布到 OpenSandbox Server 可访问的镜像仓库后，才允许用于部署。
- 工具只接受结构化的文件操作参数，不执行模型传入的代码。

### Project custom sandbox image

仓库应提供可审计的 `infra/sandbox/Dockerfile`，作为项目统一 Sandbox 镜像入口，内容至少包含：

```dockerfile
FROM sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.1.0

USER root
RUN uv pip install --system --no-cache \
    "pypdf==<pinned-version>" \
    "reportlab==<pinned-version>" \
    "python-docx==<pinned-version>" \
    "openpyxl==<pinned-version>"
RUN /usr/bin/python3 -c "import pypdf, reportlab, docx, openpyxl"
```

实际提交时必须将占位版本替换为经过验证的具体版本。验证命令必须同时检查发行包安装和 Python 导入名：`python-docx` 的导入名为 `docx`。镜像构建成功后，通过 `docker run` 重复执行相同导入检查，并将镜像 tag 配置到 `OPEN_SANDBOX_IMAGE`。

## Preview and lifecycle

- PDF 使用浏览器原生预览。
- DOCX 使用 `docx-preview` 转 HTML。
- XLSX 使用 SheetJS 解析并由前端渲染工作表数据。
- `export-file` 每次读取当前 Sandbox 文件；Sandbox 释放后返回过期/不存在。
- 原文件直接修改，不生成版本副本；分析结果只留在对话上下文。

## Risks and limits

一次性读取文件可能受模型上下文限制；V1 不做分块或向量检索。复杂 Office 排版不保证完全保真，且不处理宏格式。
