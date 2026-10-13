import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(appDir, '.env'), quiet: true });
const raw = process.env.WB_DATA_DIR || '~/leetcode-workspace';
export const dataDir = path.resolve(raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw);
if (dataDir === appDir || dataDir.startsWith(appDir + path.sep)) {
  throw new Error('WB_DATA_DIR must be outside the public application repository.');
}
process.env.WB_DATA_DIR = dataDir;
process.env.DATABASE_URL ||= `file:${path.join(dataDir, 'workbench.db')}`;
export const python = process.env.PYTHON || 'python3';
export const host = process.env.HOST || '127.0.0.1';
export const port = Number(process.env.PORT || 3089);

export function requireCredentials() {
  if (!process.env.WB_USER || !process.env.WB_PASSWORD) {
    throw new Error('Basic Auth credentials are missing. Run npm run setup first.');
  }
  if (process.env.WB_USER.includes(':')) throw new Error('WB_USER must not contain a colon.');
}
