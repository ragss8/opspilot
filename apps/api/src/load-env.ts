import { resolve } from 'node:path';
import { config } from 'dotenv';

// Load the repository configuration first, then fill any missing values from
// an API-specific file. Existing shell/container environment variables retain
// their normal highest precedence because dotenv does not override by default.
config({ path: resolve(__dirname, '../../../.env') });
config({ path: resolve(__dirname, '../.env') });
