# Super Mind Studio 项目自定义 Sandbox 镜像

该镜像是 Super Mind Studio 项目统一使用的自定义 Sandbox 基础镜像，基于 OpenSandbox `code-interpreter:v1.1.0` 构建。文档分析只是它的一个使用场景；镜像预装 `pypdf`、`python-docx`、`openpyxl` 和 `reportlab`，后续项目内其他 Sandbox 能力也复用同一镜像。

```bash
docker build -f infra/sandbox/Dockerfile \
  -t super-mind-sandbox-image:0.1.0 infra/sandbox
docker run --rm super-mind-sandbox-image:0.1.0 \
  python -c "import openpyxl, pypdf, docx, reportlab; print('document dependencies ready')"
```

生产环境需将镜像推送到 OpenSandbox Server 可访问的仓库，并将 `OPEN_SANDBOX_IMAGE` 设置为完整镜像地址。文件仍只存在于 Sandbox，不会由镜像自动上传 OSS。

当前生产镜像地址：

```text
registry.cn-hangzhou.aliyuncs.com/super-mind/super-mind-sandbox-image:0.1.0
```

构建并推送：

```bash
docker build --platform linux/amd64 \
  -f infra/sandbox/Dockerfile \
  -t registry.cn-hangzhou.aliyuncs.com/super-mind/super-mind-sandbox-image:0.1.0 \
  infra/sandbox

docker push registry.cn-hangzhou.aliyuncs.com/super-mind/super-mind-sandbox-image:0.1.0
```
