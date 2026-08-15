import { SetMetadata } from '@nestjs/common';

export const ADMIN_PUBLIC_ROUTE = 'adminPublicRoute';
export const AdminPublic = () => SetMetadata(ADMIN_PUBLIC_ROUTE, true);
