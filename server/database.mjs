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
  // Setup synchronizes the declared schema without resets. Startup separately
  // applies reviewed additive upgrades; destructive changes are never accepted automatically.
  execFileSync(process.execPath, [path.join(appDir, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], { cwd: appDir, stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } });
}

async function upgradeProblemTracking(db) {
  const columns = await db.$queryRawUnsafe('PRAGMA table_info("Problem")');
  const columnNames = columns.map(column => column.name);
  const legacyColumns = ['id', 'title', 'slug', 'difficulty', 'topics', 'url', 'updatedAt'];
  if (legacyColumns.some(column => !columnNames.includes(column))) throw new Error('Unrecognized Problem schema. Check DATABASE_URL before running setup.');
  const statements = fs.readFileSync(path.join(appDir, 'prisma/updates/20261014-accepted-tags.sql'), 'utf8')
    .replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
  // Apply only additive, idempotent changes to the recognized workbench schema.
  await db.$transaction(async tx => {
    for (const sql of statements) {
      if (columnNames.includes('accepted') && sql.startsWith('ALTER TABLE')) continue;
      await tx.$executeRawUnsafe(sql);
    }
    const problems = await tx.$queryRawUnsafe('SELECT id, topics FROM "Problem"');
    for (const problem of problems) {
      let topics;
      try { topics = JSON.parse(problem.topics); } catch { continue; }
      if (!Array.isArray(topics)) continue;
      for (const topic of [...new Set(topics.filter(topic => typeof topic === 'string').map(topic => topic.trim()).filter(Boolean))]) {
        const tag = await tx.tag.upsert({ where: { name: topic }, create: { name: topic }, update: {} });
        await tx.problemTag.upsert({ where: { problemId_tagId: { problemId: problem.id, tagId: tag.id } }, create: { problemId: problem.id, tagId: tag.id }, update: {} });
      }
    }
  }, { timeout: 30000 });
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
  await upgradeProblemTracking(db);
}
