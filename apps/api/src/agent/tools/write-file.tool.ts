import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service';
import type { AgentToolDefinition } from './agent-tool';
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers';

const WRITE_FILE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'content'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 1_024,
      description:
        'A path inside /workspace. Both /workspace/work/file.txt and work/file.txt are accepted.',
    },
    content: { type: 'string', maxLength: 1_048_576 },
  },
} as const;

const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);

export function createWriteFileTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ path: string; content: string }> {
  return {
    name: 'write_file',
    description:
      'Write UTF-8 text to one file in the current Thread sandbox workspace. Paths may be absolute under /workspace or relative to /workspace.',
    label: '写入文件',
    riskLevel: 'write',
    approvalPolicy: 'none',
    parameters: WRITE_FILE_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context);
      try {
        const extension = args.path.slice(args.path.lastIndexOf('.')).toLowerCase();
        const file = DOCUMENT_EXTENSIONS.has(extension)
          ? await writeDocument(
              sessions,
              scope.runId,
              scope.userId,
              args.path,
              extension,
              args.content,
              context.signal,
            )
          : await sessions.writeFile(
              scope.runId,
              scope.userId,
              args.path,
              new TextEncoder().encode(args.content),
              context.signal,
            );
        return {
          content: `Wrote ${file.sizeBytes} bytes to ${file.path}`,
          summary: `已写入 ${args.path}`,
          isError: false,
          audit: { path: file.path, size: file.sizeBytes, sha256: file.sha256 },
        };
      } catch (error) {
        return createToolErrorResult(error, '写入文件失败');
      }
    },
  };
}

async function writeDocument(
  sessions: AgentExecutionSessionService,
  runId: string,
  userId: string,
  path: string,
  extension: string,
  content: string,
  signal?: AbortSignal,
) {
  const script = `from pathlib import Path
p=Path(${JSON.stringify(path)}); content=${JSON.stringify(content)}
if ${JSON.stringify(extension)}=='.docx':
 from docx import Document
 d=Document(); d.add_paragraph(content); d.save(p)
elif ${JSON.stringify(extension)}=='.xlsx':
 from openpyxl import Workbook
 w=Workbook(); w.active['A1']=content; w.save(p)
else:
 from reportlab.pdfgen import canvas
 c=canvas.Canvas(str(p)); c.drawString(72,760,content[:2000]); c.save()`;
  const result = await sessions.runShell(runId, userId, {
    command: `python -c ${shellQuote(script)}`,
    workingDirectory: '/workspace',
    ...(signal ? { signal } : {}),
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.content || '文档写入失败');
  const file = await sessions.readFile(runId, userId, path, signal);
  if (!file) throw new Error('文档写入后无法读取文件');
  return file;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
