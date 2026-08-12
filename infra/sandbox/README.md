# Super Mind Studio 文档分析 Sandbox 镜像

该镜像基于 OpenSandbox `code-interpreter:v1.1.0`，预装 `pypdf`、`python-docx`、`openpyxl` 和 `reportlab`。

```bash
docker build -f infra/sandbox/Dockerfile \
  -t super-mind/document-sandbox:0.1.0 infra/sandbox
docker run --rm super-mind/document-sandbox:0.1.0 \
  python -c "import openpyxl, pypdf, docx, reportlab; print('document dependencies ready')"
```

生产环境需将镜像推送到 OpenSandbox Server 可访问的仓库，并将 `OPEN_SANDBOX_IMAGE` 设置为完整镜像地址。文件仍只存在于 Sandbox，不会由镜像自动上传 OSS。
