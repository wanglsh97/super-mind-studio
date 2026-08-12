FROM sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.1.0

# Document analysis dependencies. Keep versions pinned for reproducible sandboxes.
USER root
RUN uv venv /opt/document-venv --python python3 \
    && uv pip install --python /opt/document-venv/bin/python --no-cache \
      openpyxl==3.1.5 \
      pypdf==5.4.0 \
      python-docx==1.1.2 \
      reportlab==4.3.1 \
    && /opt/document-venv/bin/python - <<'PY'
import openpyxl
import pypdf
import docx
import reportlab

print('document dependencies ready')
PY

ENV PATH="/opt/document-venv/bin:${PATH}"
USER root
