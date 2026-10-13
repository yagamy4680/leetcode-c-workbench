import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { appDir, dataDir, databaseFile, databaseUrl, python } from './config.mjs';

const requiredTables = ['Problem', 'Solution', 'Run', 'Submission'];

export function createDatabaseClient() {
  // Explicit override avoids generated-client .env/path defaults selecting a
  // different SQLite file from the one initialized by setup.
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function createSQLiteFile() {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  if (!fs.existsSync(databaseFile)) {
    execFileSync(python, ['-c', 'import sqlite3,sys; sqlite3.connect(sys.argv[1]).close()', databaseFile], { stdio: 'inherit' });
  }
}

export function initializeDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  execFileSync(python, [path.join(appDir, 'runner/workbench.py'), 'init'], { stdio: 'inherit', env: process.env });
  createSQLiteFile();
  // Existing databases are updated only by explicit setup. Never reset or
  // automatically accept destructive schema changes.
  execFileSync(process.execPath, [path.join(appDir, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: appDir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } });
}

export async function ensureDatabase(db) {
  createSQLiteFile();
  const tables = () => db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  let names = (await tables()).map(table => table.name);
  if (names.length === 0) {
    console.log(`Initializing empty SQLite database: ${databaseFile}`);
    initializeDatabase();
    names = (await tables()).map(table => table.name);
  }
  const missing = requiredTables.filter(table => !names.includes(table));
  if (missing.length) {
    throw new Error(`SQLite schema is incomplete at ${databaseFile}. Missing tables: ${missing.join(', ')}. Check WB_DATA_DIR/DATABASE_URL, then run npm run setup before starting the service.`);
  }
}
