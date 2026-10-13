import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appDir, dataDir, databaseFile } from '../server/config.mjs';
import { initializeDatabase } from '../server/database.mjs';

fs.mkdirSync(dataDir, { recursive: true });
const envFile = path.join(appDir, '.env');
let env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : `WB_DATA_DIR=${JSON.stringify(dataDir)}\nHOST=127.0.0.1\nPORT=3089\n`;
for (const [key, value] of Object.entries({ WB_USER: process.env.WB_USER || 'workbench', WB_PASSWORD: process.env.WB_PASSWORD || crypto.randomBytes(24).toString('base64url') })) {
  if (!new RegExp(`^${key}=.+$`, 'm').test(env) || !process.env[key]) {
    env = env.replace(new RegExp(`^${key}=.*$`, 'gm'), '');
    env += `${key}=${JSON.stringify(value)}\n`;
  }
}
fs.writeFileSync(envFile, env, { mode: 0o600 });
fs.chmodSync(envFile, 0o600);
console.log(`Workspace: ${dataDir}`);
console.log(`SQLite database: ${databaseFile}`);
initializeDatabase();
console.log('Setup complete. Local credentials are in .env. Start with npm start.');
