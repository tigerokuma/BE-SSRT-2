import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

function csv(key: string, fallback?: string[]): string[] | undefined {
  const v = process.env[key];
  if (!v) return fallback;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    
    // Skip authentication for webhook endpoints (GitHub webhooks don't have bearer tokens)
    const url = req.url || '';
    if (url.startsWith('/webhooks/')) {
      return true;
    }

    // 1) Internal-token bypass for backend-to-backend calls
    const internalToken = (req.headers['x-internal-token'] as string | undefined)?.trim();
    const expected = process.env.INTERNAL_API_TOKEN;

    if (expected && internalToken && internalToken === expected) {
      // Optionally attach a fake "internal" user if you want
      (req as any).user = { sub: 'internal-service', role: 'internal' };
      return true;
    }

    // 2) Normal Clerk bearer token path
    const authz = (req.headers['authorization'] as string | undefined) ?? '';
    if (!authz.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token');
    }
    const token = authz.slice(7);

    try {
      const payload = await verifyToken(token, {
        jwtKey: process.env.CLERK_JWT_KEY,
        secretKey: process.env.CLERK_SECRET_KEY,
        audience: process.env.CLERK_JWT_AUDIENCE,
        authorizedParties: csv('CLERK_AUTHED_PARTIES'),
        clockSkewInMs: 60_000,
      });

      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
