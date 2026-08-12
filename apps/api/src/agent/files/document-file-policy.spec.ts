import {
  MAX_DOCUMENT_FILE_BYTES,
  MAX_DOCUMENT_FILE_COUNT,
  validateDocumentFile,
  validateDocumentFiles,
} from './document-file-policy';

describe('document-file-policy', () => {
  it('accepts only modern PDF, Word and Excel formats case-insensitively', () => {
    expect(validateDocumentFile({ originalName: 'a.PDF', sizeBytes: 10 })).toBe('.pdf');
    expect(validateDocumentFile({ originalName: 'b.docx', sizeBytes: 10 })).toBe('.docx');
    expect(validateDocumentFile({ originalName: 'c.XLSX', sizeBytes: 10 })).toBe('.xlsx');
  });

  it('enforces the five-file and 20 MB limits', () => {
    expect(() =>
      validateDocumentFiles(
        Array.from({ length: MAX_DOCUMENT_FILE_COUNT + 1 }, (_, index) => ({
          originalName: `${index}.pdf`,
          sizeBytes: 1,
        })),
      ),
    ).toThrow('最多同时上传');
    expect(() =>
      validateDocumentFile({ originalName: 'large.pdf', sizeBytes: MAX_DOCUMENT_FILE_BYTES + 1 }),
    ).toThrow('不能超过');
  });

  it.each(['a.doc', 'a.xls', 'a.docm', 'a.xlsm', 'a.txt', 'no-extension'])(
    'rejects unsupported file %s',
    (originalName) => {
      expect(() => validateDocumentFile({ originalName, sizeBytes: 1 })).toThrow(
        '仅支持 PDF、DOCX 和 XLSX 文件',
      );
    },
  );

  it('rejects path-like file names', () => {
    expect(() => validateDocumentFile({ originalName: '../secret.pdf', sizeBytes: 1 })).toThrow(
      '文件名不合法',
    );
    expect(() => validateDocumentFile({ originalName: 'nested/file.pdf', sizeBytes: 1 })).toThrow(
      '文件名不合法',
    );
  });
});
