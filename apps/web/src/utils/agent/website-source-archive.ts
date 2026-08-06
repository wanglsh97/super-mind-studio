import { strFromU8, unzip } from 'fflate';

export interface WebsiteSourceArchiveLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxPreviewFileBytes: number;
}

export interface WebsiteSourceFile {
  path: string;
  name: string;
  sizeBytes: number;
  language: string;
  content: string | null;
  previewUnavailableReason: string | null;
}

export interface WebsiteSourceTreeNode {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children?: WebsiteSourceTreeNode[];
}

export const DEFAULT_WEBSITE_SOURCE_ARCHIVE_LIMITS: WebsiteSourceArchiveLimits = {
  maxCompressedBytes: 32 * 1024 * 1024,
  maxEntries: 1_000,
  maxExpandedBytes: 80 * 1024 * 1024,
  maxPreviewFileBytes: 2 * 1024 * 1024,
};

const languageByExtension: Record<string, string> = {
  css: 'css',
  csv: 'csv',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'text',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

export async function parseWebsiteSourceArchive(
  archive: Uint8Array,
  limits: WebsiteSourceArchiveLimits = DEFAULT_WEBSITE_SOURCE_ARCHIVE_LIMITS,
): Promise<WebsiteSourceFile[]> {
  if (archive.byteLength > limits.maxCompressedBytes) {
    throw new Error('源码包超过浏览器预览大小限制，请直接下载后在本地查看。');
  }

  const entries = await unzipArchive(archive);
  const paths = Object.keys(entries).filter((path) => !path.endsWith('/'));
  if (paths.length > limits.maxEntries) {
    throw new Error('源码文件数量超过在线预览限制，请下载源码包查看。');
  }

  let expandedBytes = 0;
  const files = paths.map((rawPath) => {
    const path = normalizeArchivePath(rawPath);
    const bytes = entries[rawPath]!;
    expandedBytes += bytes.byteLength;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new Error('源码解压体积超过在线预览限制，请下载源码包查看。');
    }

    const name = path.split('/').at(-1) ?? path;
    const language = languageForPath(path);
    const previewUnavailableReason = previewBlockReason(bytes, limits.maxPreviewFileBytes);
    return {
      path,
      name,
      sizeBytes: bytes.byteLength,
      language,
      content: previewUnavailableReason ? null : strFromU8(bytes),
      previewUnavailableReason,
    } satisfies WebsiteSourceFile;
  });

  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export function buildWebsiteSourceTree(files: WebsiteSourceFile[]): WebsiteSourceTreeNode[] {
  const root: WebsiteSourceTreeNode = {
    name: '',
    path: '',
    kind: 'directory',
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split('/');
    let parent = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const kind = index === parts.length - 1 ? 'file' : 'directory';
      let node = parent.children?.find((candidate) => candidate.name === part);
      if (!node) {
        node = {
          name: part,
          path,
          kind,
          ...(kind === 'directory' ? { children: [] } : {}),
        };
        parent.children?.push(node);
      }
      parent = node;
    });
  }

  sortTree(root.children ?? []);
  return root.children ?? [];
}

function unzipArchive(archive: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(archive, (error, result) => {
      if (error) {
        reject(new Error('源码包无法解析，请直接下载后在本地查看。'));
        return;
      }
      resolve(result);
    });
  });
}

function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('源码包包含无效文件路径，无法在线预览。');
  }
  return normalized;
}

function previewBlockReason(bytes: Uint8Array, maxPreviewFileBytes: number): string | null {
  if (bytes.byteLength > maxPreviewFileBytes) return '文件过大，请下载源码包后查看。';
  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 8_192));
  if (probe.includes(0)) return '二进制文件不支持在线预览。';
  return null;
}

function languageForPath(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return extension ? (languageByExtension[extension] ?? 'text') : 'text';
}

function sortTree(nodes: WebsiteSourceTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, 'en');
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}
