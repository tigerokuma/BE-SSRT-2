// src/common/guards/internal-token.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = (req.headers['x-internal-token'] as string | undefined) ?? '';
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected) return true; // if not set, allow everything (dev)
    if (header !== expected) throw new UnauthorizedException('Invalid internal token');
    return true;
  }
}
