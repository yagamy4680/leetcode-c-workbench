import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(appDir, '.env'), quiet: true });
const raw = process.env.WB_DATA_DIR || '~/leetcode-workspace';
const expandHome = value => value === '~' ? os.homedir() : (value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
export const dataDir = path.resolve(appDir, expandHome(raw));
if (dataDir === appDir || dataDir.startsWith(appDir + path.sep)) {
  throw new Error('WB_DATA_DIR must be outside the public application repository.');
}
process.env.WB_DATA_DIR = dataDir;
// Resolve once and share this exact URL with Prisma Client AND the schema CLI.
// Relative SQLite URLs follow schema.prisma's directory, independent of cwd.
const configuredUrl = process.env.DATABASE_URL || `file:${path.join(dataDir, 'workbench.db')}`;
if (!configuredUrl.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file: URL.');
const queryAt = configuredUrl.indexOf('?');
const filePart = configuredUrl.slice(5, queryAt === -1 ? undefined : queryAt);
if (!filePart) throw new Error('DATABASE_URL must contain a SQLite file path.');
const resolvedFile = filePart.startsWith('//') ? fileURLToPath(`file:${filePart}`) : expandHome(filePart);
export const databaseFile = path.resolve(appDir, 'prisma', resolvedFile);
export const databaseUrl = `file:${databaseFile}${queryAt === -1 ? '' : configuredUrl.slice(queryAt)}`;
process.env.DATABASE_URL = databaseUrl;
export const python = process.env.PYTHON || 'python3';
export const host = process.env.HOST || '127.0.0.1';
export const port = Number(process.env.PORT || 3089);

export function requireCredentials() {
  if (!process.env.WB_USER || !process.env.WB_PASSWORD) {
    throw new Error('Basic Auth credentials are missing. Run npm run setup first.');
  }
  if (process.env.WB_USER.includes(':')) throw new Error('WB_USER must not contain a colon.');
}
