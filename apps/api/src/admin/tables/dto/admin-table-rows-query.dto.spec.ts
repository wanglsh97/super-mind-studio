import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminTableRowsQueryDto } from './admin-table-rows-query.dto';

describe('AdminTableRowsQueryDto', () => {
  it('transforms bounded pagination and accepts sorting', async () => {
    const query = plainToInstance(AdminTableRowsQueryDto, {
      page: '2',
      pageSize: '100',
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ page: 2, pageSize: 100 });
  });

  it.each([{ page: 0 }, { pageSize: 101 }, { sortOrder: 'sideways' }, { sortBy: 123 }])(
    'rejects invalid query %#',
    async (input) => {
      await expect(
        validate(plainToInstance(AdminTableRowsQueryDto, input)),
      ).resolves.not.toHaveLength(0);
    },
  );
});
