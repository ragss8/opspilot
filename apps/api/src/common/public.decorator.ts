import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'opspilot:isPublic';

/** Marks a route as reachable without an API key even when one is configured. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
