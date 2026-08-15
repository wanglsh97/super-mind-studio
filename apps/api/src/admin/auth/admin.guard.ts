import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ADMIN_PUBLIC_ROUTE } from './admin-public.decorator';
import { ADMIN_SESSION_COOKIE, AdminAuthService } from './admin-auth.service';
import type { AdminSession } from './admin-auth.service';

export type AdminRequest = Request & { adminSession?: AdminSession };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!isAdminApiRequest(request)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(ADMIN_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const token = request.cookies?.[ADMIN_SESSION_COOKIE] as string | undefined;
    request.adminSession = await this.auth.readSession(token);
    return true;
  }
}

function isAdminApiRequest(request: Request): boolean {
  const path = (request.originalUrl || request.path).split('?', 1)[0] ?? '';
  return path === '/api/v1/admin' || path.startsWith('/api/v1/admin/');
}
