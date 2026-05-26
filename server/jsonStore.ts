import fs from 'fs';
import path from 'path';
import { getDataDir } from './dataDir';

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function readJson<T>(name: string, fallback: T): T {
  ensureDataDir();
  const file = path.join(getDataDir(), name);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(name: string, value: T): void {
  ensureDataDir();
  const file = path.join(getDataDir(), name);
  fs.writeFileSync(file, JSON.stringify(value ?? null, null, 2));
}
