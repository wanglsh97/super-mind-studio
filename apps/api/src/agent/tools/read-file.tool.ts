import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service';
import type { AgentToolDefinition } from './agent-tool';
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers';

const READ_FILE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 1_024,
      description:
        'A path inside /workspace. Both /workspace/output/file.svg and output/file.svg are accepted.',
    },
  },
} as const;

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);

export function createReadFileTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ path: string }> {
  return {
    name: 'read_file',
    description:
      'Read one UTF-8 text file from the current Thread sandbox workspace. Paths may be absolute under /workspace or relative to /workspace.',
    label: '读取文件',
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: READ_FILE_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context);
      try {
        const file = await sessions.readFile(scope.runId, scope.userId, args.path, context.signal);
        if (!file)
          return createToolErrorResult(
            {
              code: 'FILE_NOT_FOUND',
              message: `文件 ${args.path} 不存在。请先使用 shell 检查目录内容，再使用实际存在的路径重试。`,
              retryable: true,
            },
            '读取文件失败',
          );
        const extension = args.path.slice(args.path.lastIndexOf('.')).toLowerCase();
        const content = DOCUMENT_EXTENSIONS.has(extension)
          ? await extractDocument(
              sessions,
              scope.runId,
              scope.userId,
              file.path,
              extension,
              context.signal,
            )
          : new TextDecoder().decode(file.bytes);
        return {
          content,
          summary: `已读取 ${args.path}`,
          isError: false,
          audit: { path: file.path, size: file.sizeBytes, sha256: file.sha256 },
        };
      } catch (error) {
        return createToolErrorResult(error, '读取文件失败');
      }
    },
  };
}

async function extractDocument(
  sessions: AgentExecutionSessionService,
  runId: string,
  userId: string,
  path: string,
  extension: string,
  signal?: AbortSignal,
): Promise<string> {
  const script = `import json
from pathlib import Path
p=Path(${JSON.stringify(path)})
if ${JSON.stringify(extension)}=='.pdf':
 from pypdf import PdfReader
 print(json.dumps({'format':'pdf','text':'\\n'.join((x.extract_text() or '') for x in PdfReader(str(p)).pages)},ensure_ascii=False))
elif ${JSON.stringify(extension)}=='.docx':
 from docx import Document
 d=Document(str(p)); print(json.dumps({'format':'docx','paragraphs':[x.text for x in d.paragraphs],'tables':[[c.text for c in row.cells] for t in d.tables for row in t.rows]},ensure_ascii=False))
else:
 from openpyxl import load_workbook
 w=load_workbook(str(p),data_only=False,read_only=True); print(json.dumps({'format':'xlsx','sheets':{s.title:[[c.value for c in row] for row in s.iter_rows()] for s in w.worksheets}},ensure_ascii=False))`;
  const result = await sessions.runShell(runId, userId, {
    command: `python -c ${shellQuote(script)}`,
    workingDirectory: '/workspace',
    ...(signal ? { signal } : {}),
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.content || '文档解析失败');
  return result.stdout.content.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
