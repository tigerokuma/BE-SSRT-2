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

    const authz = (req.headers['authorization'] as string | undefined) ?? '';
    if (!authz.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token');
    }
    const token = authz.slice(7);

    try {
      const payload = await verifyToken(token, {
        // Use ONE of these: prefer jwtKey (PEM) for networkless verification,
        jwtKey: process.env.CLERK_JWT_KEY,
        // or fall back to Clerk secret which will fetch JWKS:
        secretKey: process.env.CLERK_SECRET_KEY,

        // Optional hardening (only set if you actually configured them)
        audience: process.env.CLERK_JWT_AUDIENCE,                 // e.g. "BACKEND"
        authorizedParties: process.env.CLERK_AUTHED_PARTIES
          ? process.env.CLERK_AUTHED_PARTIES.split(',')
          : undefined,
        clockSkewInMs: 60_000,                                    // match your Clerk template
      });

      (req as any).user = payload; // attach claims if you need them downstream
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
