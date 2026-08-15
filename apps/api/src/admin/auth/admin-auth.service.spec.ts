import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AdminAuthService } from './admin-auth.service';

const secret = 'unit-test-admin-session-secret-at-least-32-chars';

function createService(fixedCredentialsEnabled = true) {
  const config = new ConfigService({
    NODE_ENV: 'test',
    ADMIN_FIXED_CREDENTIALS_ENABLED: fixedCredentialsEnabled,
    ADMIN_SESSION_SECRET: secret,
    ADMIN_SESSION_TTL_SECONDS: 900,
  });
  return new AdminAuthService(new JwtService(), config);
}

describe('AdminAuthService', () => {
  it('accepts only the fixed V1 development credential with a generic failure', () => {
    const service = createService();

    expect(() => service.verifyCredentials('root', '123456')).not.toThrow();
    for (const [username, password] of [
      ['unknown', '123456'],
      ['root', 'incorrect'],
    ]) {
      expect(() => service.verifyCredentials(username!, password!)).toThrow('用户名或密码错误');
    }
  });

  it('refuses fixed credential login when the production release gate disables it', () => {
    const service = createService(false);

    expect(() => service.verifyCredentials('root', '123456')).toThrow('正式开放前必须升级认证方案');
  });

  it('creates and verifies a short-lived signed administrator session', async () => {
    const service = createService();

    const { token, session } = await service.createSession();

    expect(token.split('.')).toHaveLength(3);
    expect(session.username).toBe('root');
    await expect(service.readSession(token)).resolves.toEqual(session);
  });

  it('rejects missing, expired, forged and wrong-purpose tokens', async () => {
    const service = createService();
    const expired = await new JwtService().signAsync(
      { sub: 'root', type: 'admin_session', version: 1 },
      { secret, expiresIn: -1 },
    );
    const wrongPurpose = await new JwtService().signAsync(
      { sub: 'root', type: 'public_session', version: 1 },
      { secret, expiresIn: 900 },
    );

    await expect(service.readSession(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(service.readSession(expired)).rejects.toMatchObject({ status: 401 });
    await expect(service.readSession('forged.token.value')).rejects.toMatchObject({ status: 401 });
    await expect(service.readSession(wrongPurpose)).rejects.toMatchObject({ status: 401 });
  });

  it('uses HttpOnly strict cookies and enables Secure only in production', () => {
    const service = createService();

    expect(service.cookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/api/v1/admin',
      maxAge: 900_000,
    });
    expect(service.cookieOptions(true)).toMatchObject({ secure: true });
  });
});
