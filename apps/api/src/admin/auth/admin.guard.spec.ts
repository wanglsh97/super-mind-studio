import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ADMIN_PUBLIC_ROUTE } from './admin-public.decorator';
import { AdminGuard } from './admin.guard';
import { ADMIN_SESSION_COOKIE } from './admin-auth.service';
import type { AdminAuthService } from './admin-auth.service';

function contextFor(request: Partial<Request>, handler = jest.fn()): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

function setup() {
  const readSession = jest.fn().mockResolvedValue({
    username: 'root',
    expiresAt: '2026-07-17T12:00:00.000Z',
  });
  const auth = { readSession } as unknown as AdminAuthService;
  return { guard: new AdminGuard(new Reflector(), auth), readSession };
}

describe('AdminGuard', () => {
  it('does not inspect sessions for public non-admin APIs', async () => {
    const { guard, readSession } = setup();

    await expect(guard.canActivate(contextFor({ originalUrl: '/api/v1/models' }))).resolves.toBe(
      true,
    );
    expect(readSession).not.toHaveBeenCalled();
  });

  it('allows an explicitly public administrator login route', async () => {
    const { guard, readSession } = setup();
    const handler = jest.fn();
    Reflect.defineMetadata(ADMIN_PUBLIC_ROUTE, true, handler);

    await expect(
      guard.canActivate(contextFor({ originalUrl: '/api/v1/admin/auth/login' }, handler)),
    ).resolves.toBe(true);
    expect(readSession).not.toHaveBeenCalled();
  });

  it('rejects anonymous admin APIs through the session verifier', async () => {
    const { guard, readSession } = setup();
    readSession.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const request = { originalUrl: '/api/v1/admin/dashboard/overview' };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 401 });
    expect(readSession).toHaveBeenCalledWith(undefined);
    expect(request).not.toHaveProperty('adminSession');
  });

  it('attaches a verified administrator session for downstream handlers', async () => {
    const { guard, readSession } = setup();
    const request = {
      originalUrl: '/api/v1/admin/logs?status=PENDING',
      cookies: { [ADMIN_SESSION_COOKIE]: 'signed-token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(readSession).toHaveBeenCalledWith('signed-token');
    expect(request).toMatchObject({ adminSession: { username: 'root' } });
  });
});
