import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Opt-in API key authentication.
 *
 * When OPSPILOT_API_KEY is unset the guard allows every request, so a reviewer
 * can clone and run the project with no configuration. Setting the variable
 * turns authentication on for every non-public route with no code change.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.OPSPILOT_API_KEY?.trim();
    if (!expected) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-api-key'];
    const supplied = Array.isArray(header) ? header[0] : header;

    if (!supplied || !safeEquals(supplied, expected)) {
      throw new UnauthorizedException('A valid x-api-key header is required');
    }
    return true;
  }
}

/** Length-independent comparison that does not short-circuit on first mismatch. */
function safeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
