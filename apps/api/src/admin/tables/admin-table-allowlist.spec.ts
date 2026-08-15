import { AdminTableAllowlist } from './admin-table-allowlist';

describe('AdminTableAllowlist', () => {
  const allowlist = new AdminTableAllowlist();

  it('exposes all business tables as read-only', () => {
    const tables = allowlist.list();

    expect(tables.length).toBeGreaterThanOrEqual(11);
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'users',
        'request-logs',
        'billing-records',
        'image-generation-tasks',
        'admin-audit-logs',
        'agent-runs',
      ]),
    );
    expect(
      tables.every(({ operations }) => operations.length === 1 && operations[0] === 'query'),
    ).toBe(true);
    expect(tables.every(({ physicalName }) => typeof physicalName === 'string')).toBe(true);
    expect(tables.find(({ name }) => name === 'users')?.physicalName).toBe('User');
    expect(tables.every(({ fields }) => fields.every(({ editable }) => !editable))).toBe(true);
  });

  it('returns schema relations for UI navigation', () => {
    const schema = allowlist.schema();

    expect(schema.tables.length).toBeGreaterThanOrEqual(11);
    expect(schema.relations.some(({ sourceTable }) => sourceTable === 'request-logs')).toBe(true);
  });

  it('rejects mutation operations and unknown tables', () => {
    expect(() => allowlist.resolve('users; DROP TABLE')).toThrow('不支持的业务表');
    expect(() => allowlist.assertOperation('users', 'create')).toThrow('不允许 create');
    expect(() => allowlist.assertOperation('users', 'update')).toThrow('不允许 update');
    expect(() => allowlist.assertOperation('users', 'delete')).toThrow('不允许 delete');
  });
});
