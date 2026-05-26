import fs from 'fs';
import os from 'os';
import path from 'path';

let resolvedDataDir: string | null = null;
let migrationResult: DataDirMigration | null = null;

export interface DataDirMigration {
  legacyDir: string;
  dataDir: string;
  migrated: boolean;
  reason: string;
}

function appSupportDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'KCTLogin');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'KCTLogin');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'KCTLogin');
}

function hasRuntimeFiles(dir: string) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => name !== '.keep' && name !== '.DS_Store');
}

function readJsonFile(file: string, fallback: any) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file: string, value: any) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function mergeJsonArrayById(sourceFile: string, targetFile: string) {
  const source = readJsonFile(sourceFile, []);
  if (!Array.isArray(source) || !source.length) return 0;
  const target = readJsonFile(targetFile, []);
  if (!Array.isArray(target) || !target.length) {
    writeJsonFile(targetFile, source);
    return source.length;
  }

  const existingIds = new Set(target.map((item: any) => item?.id).filter(Boolean));
  const missing = source.filter((item: any) => item?.id && !existingIds.has(item.id));
  if (!missing.length) return 0;
  writeJsonFile(targetFile, [...target, ...missing]);
  return missing.length;
}

function copyMissing(source: string, target: string) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return 0;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return 1;
}

function mergeMissingTree(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(sourceDir)) return 0;
  let copied = 0;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of fs.readdirSync(sourceDir)) {
    if (name === '.keep' || name === '.DS_Store') continue;
    copied += copyMissing(path.join(sourceDir, name), path.join(targetDir, name));
  }
  return copied;
}

function mergeLegacyData(legacyDir: string, dataDir: string) {
  let merged = 0;
  for (const fileName of ['profiles.json', 'proxies.json', 'api_tokens.json', 'proxy_devices.json']) {
    merged += mergeJsonArrayById(path.join(legacyDir, fileName), path.join(dataDir, fileName));
  }

  for (const name of fs.readdirSync(legacyDir)) {
    if (name === '.keep' || name === '.DS_Store') continue;
    const source = path.join(legacyDir, name);
    const target = path.join(dataDir, name);
    if (['profiles.json', 'proxies.json', 'api_tokens.json', 'proxy_devices.json', 'profiles_export.json'].includes(name)) continue;
    if (fs.statSync(source).isDirectory()) {
      merged += mergeMissingTree(source, target);
    } else {
      merged += copyMissing(source, target);
    }
  }
  return merged;
}

export function getLegacySourceDataDir() {
  return path.join(process.cwd(), 'server', 'data');
}

export function getDefaultDataDir() {
  return path.join(appSupportDir(), 'server-data');
}

export function getDataDir() {
  if (!resolvedDataDir) {
    resolvedDataDir = process.env.KCT_DATA_DIR || getDefaultDataDir();
    migrateLegacyDataIfNeeded();
  }
  return resolvedDataDir;
}

export function getProfilesDataDir() {
  return path.join(getDataDir(), 'profiles_data');
}

export function migrateLegacyDataIfNeeded(): DataDirMigration {
  const dataDir = resolvedDataDir || process.env.KCT_DATA_DIR || getDefaultDataDir();
  const legacyDir = getLegacySourceDataDir();
  if (migrationResult) return migrationResult;

  if (path.resolve(dataDir) === path.resolve(legacyDir)) {
    migrationResult = { legacyDir, dataDir, migrated: false, reason: 'data-dir-is-legacy-dir' };
    return migrationResult;
  }

  const legacyHasData = hasRuntimeFiles(legacyDir);
  const targetHasData = hasRuntimeFiles(dataDir);
  if (!legacyHasData) {
    fs.mkdirSync(dataDir, { recursive: true });
    migrationResult = { legacyDir, dataDir, migrated: false, reason: 'legacy-empty' };
    return migrationResult;
  }

  if (targetHasData) {
    const mergedCount = mergeLegacyData(legacyDir, dataDir);
    migrationResult = {
      legacyDir,
      dataDir,
      migrated: mergedCount > 0,
      reason: mergedCount > 0 ? `merged-${mergedCount}-legacy-items` : 'target-already-has-data',
    };
    return migrationResult;
  }

  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  fs.cpSync(legacyDir, dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'migration.json'), JSON.stringify({
    migratedAt: new Date().toISOString(),
    from: legacyDir,
    to: dataDir,
  }, null, 2));
  migrationResult = { legacyDir, dataDir, migrated: true, reason: 'copied-legacy-source-data' };
  return migrationResult;
}

export function getDataDirInfo() {
  const dataDir = getDataDir();
  return {
    dataDir,
    profilesDataDir: getProfilesDataDir(),
    legacySourceDataDir: getLegacySourceDataDir(),
    migration: migrationResult || migrateLegacyDataIfNeeded(),
  };
}
