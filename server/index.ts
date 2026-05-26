import cors from 'cors';
import express from 'express';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { removeWatermarkFromBuffer } from '@pilio/gemini-watermark-remover/node';
import multer from 'multer';
import sharp from 'sharp';
import { apiTokenService } from './apiTokens';
import { browserService, type Profile } from './browser';
import { cleanCookiesForPlaywright, exportCookies, getCookiesPath, loadCookies, parseCookieInput, saveCookies } from './cookies';
import { getDataDir, getDataDirInfo, getProfilesDataDir } from './dataDir';
import { readJson, writeJson } from './jsonStore';
import { MCP_TOOL_NAMES } from './mcp';
import { proxyDeviceService } from './proxyDeviceService';
import { proxyService } from './proxyService';
import { applyGeoToFingerprint, generateRandomFingerprint, normalizeFingerprint, type Fingerprint } from './utils/fingerprint';

const app = express();
const port = Number(process.env.PORT || 3002);
const profilesDataDir = getProfilesDataDir();
const dataDir = getDataDir();
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json({ limit: '60mb' }));

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const SUPPORTED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);
const veoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SUPPORTED_VIDEO_MIME_TYPES.has(file.mimetype) || /\.(mp4|mov|m4v|webm)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Vui lòng upload video MP4, MOV, M4V hoặc WebM.'));
  },
});

function loadProfiles(): Profile[] {
  const profiles = readJson<Profile[]>('profiles.json', []);
  return Array.isArray(profiles) ? profiles : [];
}

function isoDate(value?: number | string) {
  if (typeof value === 'string') return value;
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function decodeImageData(input: Buffer | Uint8Array | ArrayBuffer) {
  const inputBuffer = Buffer.isBuffer(input)
    ? input
    : input instanceof ArrayBuffer
      ? Buffer.from(input)
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  };
}

async function encodeImageData(imageData: { width: number; height: number; data: Uint8ClampedArray }) {
  return sharp(Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength), {
    raw: {
      width: imageData.width,
      height: imageData.height,
      channels: 4,
    },
  }).png().toBuffer();
}

function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl || '');
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  return {
    mimeType,
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
  };
}

function even(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function buildVeoZoomFilter(inputWidth: number, inputHeight: number, zoom: number) {
  const outputWidth = 720;
  const outputHeight = 1280;
  const sourceAspect = inputWidth / inputHeight;
  const outputAspect = outputWidth / outputHeight;
  const baseHeight = sourceAspect > outputAspect ? outputHeight : even(outputWidth / sourceAspect);
  const baseWidth = sourceAspect > outputAspect ? even(baseHeight * sourceAspect) : outputWidth;
  const zoomWidth = even(baseWidth * zoom);
  const zoomHeight = even(baseHeight * zoom);
  const cropX = Math.max(0, even((zoomWidth - outputWidth) / 2));
  const cropY = Math.max(0, even((zoomHeight - outputHeight) / 2));

  return `scale=${baseWidth}:${baseHeight}:flags=lanczos,scale=${zoomWidth}:${zoomHeight}:flags=lanczos,crop=${outputWidth}:${outputHeight}:${cropX}:${cropY}`;
}

async function getVideoSize(videoPath: string) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    videoPath,
  ], { maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error('Không đọc được kích thước video.');
  return { width: Number(stream.width), height: Number(stream.height) };
}

function getCurrentVersions(profiles: Profile[]) {
  const firstFingerprint = profiles.find((profile) => profile.fingerprint?.chromeVersion)?.fingerprint;
  const latestVersionFile = path.join(process.cwd(), 'vendor', 'orbita-browser-146', 'version', 'latest-version.txt');
  const orbitaVersion = fs.existsSync(latestVersionFile)
    ? fs.readFileSync(latestVersionFile, 'utf8').trim()
    : '146';
  const browserVersion = firstFingerprint?.chromeVersion || '146.0.0.0';
  return {
    currentOrbitaMajorV: String(orbitaVersion).split('.')[0] || '146',
    currentBrowserV: browserVersion,
    currentTestBrowserV: browserVersion,
    currentTestOrbitaMajorV: String(orbitaVersion).split('.')[0] || '146',
  };
}

function mapProfileForExport(profile: Profile, order: number) {
  const fingerprint = normalizeFingerprint({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    fingerprint: profile.fingerprint,
  });
  const maxTouchPoints = fingerprint.os === 'android' ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0;
  const selectedProxy = profile.proxyId
    ? proxyService.getById(profile.proxyId)
    : profile.proxy?.server
      ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password)
      : null;
  const proxyHost = selectedProxy?.host || profile.proxy?.server?.replace(/^[a-z]+:\/\//i, '').split(':')[0] || '';
  const proxyPort = selectedProxy?.port || Number(profile.proxy?.server?.split(':').pop()) || 0;
  const createdAt = isoDate(profile.createdAt);
  const updatedAt = isoDate(profile.updatedAt || profile.createdAt);
  const isRunning = browserService.isProfileRunning(profile.id);

  return {
    name: profile.name,
    role: 'owner',
    id: profile.id,
    notes: profile.notes || '',
    browserType: 'orbita',
    lockEnabled: !!fingerprint.storage?.lockSession,
    timezone: {
      id: fingerprint.timezone,
    },
    navigator: {
      userAgent: fingerprint.userAgent,
      resolution: `${fingerprint.screen.width}x${fingerprint.screen.height}`,
      language: fingerprint.languages[0] || 'en-US',
      platform: fingerprint.platform,
      hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
      deviceMemory: fingerprint.hardware?.memory || 8,
      maxTouchPoints,
    },
    fingerprint: {
      navigator: {
        userAgent: fingerprint.userAgent,
        resolution: `${fingerprint.screen.width}x${fingerprint.screen.height}`,
        language: fingerprint.languages[0] || 'en-US',
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints,
      },
      plugins: {
        enableVulnerable: fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== 'off',
        enableFlash: false,
      },
      canvas: {
        mode: fingerprint.canvasMode === 'off' ? 'real' : fingerprint.canvasMode === 'block' ? 'block' : 'noise',
      },
      mediaDevices: {
        videoInputs: fingerprint.mediaDevices?.videoInput ?? 1,
        audioInputs: fingerprint.mediaDevices?.audioInput ?? 1,
        audioOutputs: fingerprint.mediaDevices?.audioOutput ?? 1,
      },
      webGLMetadata: {
        mode: fingerprint.webgl?.mode === 'off' ? 'real' : 'mask',
        vendor: fingerprint.webgl?.vendor || '',
        renderer: fingerprint.webgl?.renderer || '',
      },
      os: {
        type: fingerprint.os,
        platform: fingerprint.platform,
      },
      osSpec: {
        chromeVersion: fingerprint.chromeVersion,
        screen: fingerprint.screen,
        timezone: fingerprint.timezone,
        languages: fingerprint.languages || [],
      },
      devicePixelRatio: fingerprint.screen?.deviceScaleFactor || 1,
      fonts: fingerprint.fonts || [],
      extensionsToNewProfiles: profile.extensionPaths || [],
      userExtensionsToNewProfiles: profile.extensionPaths || [],
      autoLang: true,
    },
    geolocation: fingerprint.geolocation || {},
    debugMode: true,
    canBeRunning: true,
    isRunning,
    proxy: selectedProxy ? {
      id: selectedProxy.id,
      host: selectedProxy.host,
      port: selectedProxy.port,
      username: selectedProxy.username || '',
      password: selectedProxy.password || '',
      protocol: selectedProxy.protocol,
      status: selectedProxy.status,
      geo: selectedProxy.geo || {},
    } : {},
    proxyType: selectedProxy?.protocol || '',
    proxyRegion: selectedProxy?.geo?.countryCode || profile.locationCountryCode || '',
    createdAt,
    updatedAt,
    lastActivity: updatedAt,
    userChromeExtensions: profile.extensionPaths || [],
    permissions: {
      transferProfile: true,
      transferToMyWorkspace: true,
      shareProfile: true,
      manageFolders: true,
      editProfile: true,
      deleteProfile: true,
      cloneProfile: true,
      exportProfile: true,
      updateUA: true,
      addVpnUfoProxy: true,
      runProfile: true,
      runProfileWeb: true,
      viewProfile: true,
      addProfileTag: true,
      removeProfileTag: true,
      viewShareLinks: true,
      createShareLinks: true,
      updateShareLinks: true,
      deleteShareLinks: true,
      viewCustomExtensions: true,
    },
    remoteOrbitaUrl: browserService.getRemoteSession(profile.id)?.versionUrl || '',
    webGLMetadata: {
      vendor: fingerprint.webgl?.vendor || '',
      renderer: fingerprint.webgl?.renderer || '',
      mode: fingerprint.webgl?.mode === 'off' ? 'real' : 'mask',
    },
    isM1: fingerprint.os === 'mac',
    isPinned: !!profile.pinned,
    updateUALastChosenBrowserV: fingerprint.chromeVersion,
    isRunDisabled: false,
    runDisabledReason: '',
    isWeb: false,
    os: {
      type: fingerprint.os,
      platform: fingerprint.platform,
    },
    osSpec: {
      chromeVersion: fingerprint.chromeVersion,
      screen: fingerprint.screen,
    },
    host: proxyHost,
    port: proxyPort,
    status: isRunning ? 'running' : 'ready',
    folders: profile.folderName ? [profile.folderName] : [],
    sharedEmails: [],
    shareId: '',
    chromeExtensions: profile.extensionPaths || [],
    tags: [],
    proxyEnabled: !!selectedProxy,
    isAutoGenerated: false,
    isBookmarksSynced: !!fingerprint.storage?.saveBookmarks,
    defaultProps: {
      profileNameIsDefault: !profile.name,
      profileNotesIsDefault: !profile.notes,
    },
    autoLang: true,
    fonts: {
      families: fingerprint.fonts || [],
      enableMasking: fingerprint.fontsMode !== 'real',
      enableDomRect: true,
    },
    facebookAccountData: {
      date: '',
      token: '',
      fbIdAccount: '',
      email: '',
      password: '',
      googleDriveUrl: '',
      fb2faToolUrl: '',
      fbUrl: '',
      uaVersion: fingerprint.chromeVersion,
      cookies: '',
      notParsedData: [],
    },
    order,
  };
}

function writeProfilesExport(profiles: Profile[]) {
  const versions = getCurrentVersions(profiles);
  writeJson('profiles_export.json', {
    profiles: profiles.map((profile, index) => mapProfileForExport(profile, index + 1)),
    allProfilesCount: profiles.length,
    ...versions,
    isFolderDeleted: false,
  });
}

function getImportProfileItems(input: any) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.profiles)) return input.profiles;
  return [];
}

function isBrowserOS(value: any): value is 'windows' | 'mac' | 'android' {
  return value === 'windows' || value === 'mac' || value === 'android';
}

function inferImportedOS(userAgent = '', platform = ''): 'windows' | 'mac' | 'android' {
  if (/Android|Mobile/i.test(userAgent) || /Linux arm/i.test(platform)) return 'android';
  if (/Windows/i.test(userAgent) || platform === 'Win32') return 'windows';
  return 'mac';
}

function parseResolution(value: any) {
  const match = String(value || '').match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function isSafeRelativePath(value: any) {
  const normalized = path.normalize(String(value || ''));
  return normalized && !path.isAbsolute(normalized) && !normalized.startsWith('..') && !normalized.split(path.sep).includes('..');
}

function shouldExportCookieFile(relativePath: string) {
  const baseName = path.basename(relativePath).toLowerCase();
  if (baseName === 'singletoncookie') return false;
  return baseName === 'cookies'
    || baseName === 'cookies-journal'
    || baseName === 'cookies-wal'
    || baseName === 'cookies-shm'
    || baseName === 'safe browsing cookies'
    || baseName === 'safe browsing cookies-journal'
    || baseName === 'safe browsing cookies-wal'
    || baseName === 'safe browsing cookies-shm';
}

function collectCookieFiles(profileId: string) {
  const profileDir = path.join(profilesDataDir, profileId);
  const files: Array<{ path: string; data: string; size: number }> = [];
  if (!fs.existsSync(profileDir)) return files;

  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const relativePath = path.relative(profileDir, fullPath);
      if (!shouldExportCookieFile(relativePath)) continue;
      files.push({
        path: relativePath,
        data: fs.readFileSync(fullPath).toString('base64'),
        size: stat.size,
      });
    }
  };

  walk(profileDir);
  return files;
}

function collectSavedCookieFiles(profileId: string) {
  const cookiesDir = path.join(dataDir, 'profiles_cookies');
  if (!fs.existsSync(cookiesDir)) return [];
  return fs.readdirSync(cookiesDir)
    .filter((name) => name.startsWith(`${profileId}_`) && name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(cookiesDir, name);
      return {
        name,
        data: fs.readFileSync(fullPath).toString('base64'),
        size: fs.statSync(fullPath).size,
      };
    });
}

function restoreCookieFiles(profileId: string, files: any[]) {
  if (!Array.isArray(files)) return 0;
  const profileDir = path.join(profilesDataDir, profileId);
  let restored = 0;

  for (const file of files) {
    if (!isSafeRelativePath(file?.path) || typeof file?.data !== 'string') continue;
    const target = path.join(profileDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.data, 'base64'));
    restored += 1;
  }

  return restored;
}

function restoreSavedCookieFiles(sourceProfileId: string, targetProfileId: string, files: any[]) {
  if (!Array.isArray(files)) return 0;
  const cookiesDir = path.join(dataDir, 'profiles_cookies');
  let restored = 0;

  for (const file of files) {
    if (typeof file?.name !== 'string' || typeof file?.data !== 'string') continue;
    const suffix = file.name.startsWith(`${sourceProfileId}_`)
      ? file.name.slice(sourceProfileId.length + 1)
      : file.name.replace(/^[^_]+_/, '');
    const safeSuffix = suffix.replace(/[^a-z0-9_.-]/gi, '');
    if (!safeSuffix.endsWith('.json')) continue;
    fs.mkdirSync(cookiesDir, { recursive: true });
    fs.writeFileSync(path.join(cookiesDir, `${targetProfileId}_${safeSuffix}`), Buffer.from(file.data, 'base64'));
    restored += 1;
  }

  return restored;
}

function buildProfileExportPayload(profile: Profile) {
  return {
    ...profile,
    browserCookieFiles: collectCookieFiles(profile.id),
    savedCookieFiles: collectSavedCookieFiles(profile.id),
  };
}

function mapImportedProfile(raw: any): Partial<Profile> | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.fingerprint?.screen || raw.userAgent || raw.viewport) {
    const { browserCookieFiles, savedCookieFiles, ...profile } = raw;
    return profile;
  }

  const exportFingerprint = raw.fingerprint || {};
  const navigatorData = exportFingerprint.navigator || raw.navigator || {};
  const osData = exportFingerprint.os || raw.os || {};
  const os = isBrowserOS(osData.type) ? osData.type : inferImportedOS(navigatorData.userAgent, navigatorData.platform);
  const template = generateRandomFingerprint(os);
  const resolution = parseResolution(navigatorData.resolution);
  const screen = exportFingerprint.osSpec?.screen || raw.osSpec?.screen || (
    resolution ? {
      width: resolution.width,
      height: resolution.height,
      colorDepth: 24,
      availWidth: resolution.width,
      availHeight: resolution.height,
      deviceScaleFactor: exportFingerprint.devicePixelRatio || 1,
    } : template.screen
  );
  const proxy = raw.proxy?.host && raw.proxy?.port ? {
    server: `${raw.proxy.protocol || raw.proxyType || 'http'}://${raw.proxy.host}:${raw.proxy.port}`,
    username: raw.proxy.username || undefined,
    password: raw.proxy.password || undefined,
  } : undefined;

  return {
    name: raw.name || 'Imported profile',
    notes: raw.notes || '',
    folderName: Array.isArray(raw.folders) ? raw.folders[0] : undefined,
    pinned: !!raw.isPinned,
    proxy,
    locationCountryCode: raw.proxyRegion || raw.proxy?.geo?.countryCode || undefined,
    extensionPaths: raw.userChromeExtensions || raw.chromeExtensions || exportFingerprint.userExtensionsToNewProfiles || [],
    fingerprint: {
      ...template,
      userAgent: navigatorData.userAgent || template.userAgent,
      platform: navigatorData.platform || osData.platform || template.platform,
      os,
      chromeVersion: exportFingerprint.osSpec?.chromeVersion || raw.osSpec?.chromeVersion || template.chromeVersion,
      screen,
      webgl: {
        vendor: exportFingerprint.webGLMetadata?.vendor || raw.webGLMetadata?.vendor || template.webgl.vendor,
        renderer: exportFingerprint.webGLMetadata?.renderer || raw.webGLMetadata?.renderer || template.webgl.renderer,
        mode: exportFingerprint.webGLMetadata?.mode === 'real' ? 'off' : 'noise',
      },
      hardware: {
        concurrency: Number(navigatorData.hardwareConcurrency) || template.hardware.concurrency,
        memory: Number(navigatorData.deviceMemory) || template.hardware.memory,
      },
      maxTouchPoints: Number(navigatorData.maxTouchPoints) || template.maxTouchPoints,
      languages: exportFingerprint.osSpec?.languages || raw.osSpec?.languages || (navigatorData.language ? [navigatorData.language, String(navigatorData.language).split('-')[0]] : template.languages),
      timezone: raw.timezone?.id || exportFingerprint.osSpec?.timezone || template.timezone,
      geolocation: raw.geolocation?.latitude && raw.geolocation?.longitude ? raw.geolocation : template.geolocation,
      canvasMode: exportFingerprint.canvas?.mode === 'block' ? 'block' : exportFingerprint.canvas?.mode === 'real' ? 'off' : 'noise',
      fonts: exportFingerprint.fonts || raw.fonts?.families || template.fonts,
      mediaDevices: {
        videoInput: Number(exportFingerprint.mediaDevices?.videoInputs) || template.mediaDevices.videoInput,
        audioInput: Number(exportFingerprint.mediaDevices?.audioInputs) || template.mediaDevices.audioInput,
        audioOutput: Number(exportFingerprint.mediaDevices?.audioOutputs) || template.mediaDevices.audioOutput,
      },
      storage: {
        ...template.storage,
        lockSession: !!raw.lockEnabled,
      },
    },
  };
}

function buildUniqueProfileId(existingIds: Set<string>, requestedId?: string) {
  const cleanRequestedId = String(requestedId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
  if (cleanRequestedId && !existingIds.has(cleanRequestedId)) {
    existingIds.add(cleanRequestedId);
    return cleanRequestedId;
  }

  let id = Math.random().toString(36).slice(2, 11);
  while (existingIds.has(id)) id = Math.random().toString(36).slice(2, 11);
  existingIds.add(id);
  return id;
}

function saveProfiles(profiles: Profile[]) {
  writeJson('profiles.json', profiles);
  writeProfilesExport(profiles);
}

function readTextTail(file: string, maxChars = 18000) {
  if (!fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxChars);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonFile(file: string, fallback: any = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function findAvailablePort(startPort = 9222): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}

async function readChromeJson(port: number, pathName = '/json/version') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathName}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function analyzeBrowserLog(log: string) {
  const lines = log.split('\n').map((line) => line.trim()).filter(Boolean);
  const criticalPatterns = [
    /ERR_PROXY_CONNECTION_FAILED/i,
    /No internet/i,
    /Tab Killed/i,
    /GPU process exited unexpectedly/i,
    /Detected crash/i,
    /Too many .* retries/i,
    /Expected .* gologin/i,
    /Something went wrong when opening your profile/i,
    /Failed to connect/i,
    /net error:\s*-[0-9]+/i,
  ];
  const noisePatterns = [
    /skottie_wrapper_impl/i,
    /Received HEADERS for invalid stream/i,
    /Mixed Content/i,
    /Refused to get unsafe header/i,
    /blocked by CORS policy/i,
    /LegacyDataMixin/i,
    /preloaded using link preload/i,
    /DEPRECATED_ENDPOINT/i,
    /Banner not shown/i,
  ];

  const critical: string[] = [];
  const warnings: string[] = [];
  const noise: string[] = [];

  for (const line of lines) {
    if (criticalPatterns.some((pattern) => pattern.test(line))) critical.push(line);
    else if (noisePatterns.some((pattern) => pattern.test(line))) noise.push(line);
    else if (/\b(ERROR|WARNING)\b/i.test(line)) warnings.push(line);
  }

  return {
    critical: critical.slice(-20),
    warnings: warnings.slice(-20),
    noiseCount: noise.length,
  };
}

function analyzeGoLoginCompatibility(input: {
  profile: Profile;
  preferences: any;
  launch: any;
  runtime: any;
  proxy: any;
  fingerprint: any;
}) {
  const { profile, preferences, launch, runtime, proxy, fingerprint } = input;
  const checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];
  const add = (id: string, label: string, status: 'pass' | 'warn' | 'fail', detail: string) => checks.push({ id, label, status, detail });
  const gologin = preferences?.gologin || {};
  const extensionSettings = preferences?.extensions?.settings || {};
  const staleProxyExtension = Object.values<any>(extensionSettings).some((item) => {
    const extensionPath = String(item?.path || '');
    const extensionName = String(item?.manifest?.name || '');
    return extensionPath.includes('kct_proxy_auth_extension') || extensionName === 'KCT Proxy Auth';
  });
  const foreignComponentExtensions = Object.values<any>(extensionSettings).filter((item) => {
    const extensionPath = String(item?.path || '');
    return item?.location === 5 && (
      extensionPath.includes('/.gologin/browser/orbita-browser') ||
      extensionPath.includes('/Applications/Google Chrome.app') ||
      extensionPath.includes('/Applications/Chromium.app')
    );
  });
  const launchArgs = Array.isArray(launch?.args) ? launch.args : [];
  const proxyServer = proxy ? `${proxy.host}:${proxy.port}` : '';
  const savedProxyServer = gologin?.proxy?.server || '';
  const prefsProxyServer = preferences?.proxy?.server || '';
  const languages = Array.isArray(profile.fingerprint?.languages) ? profile.fingerprint.languages.join(',') : '';
  const expectedTimezone = profile.fingerprint?.timezone;

  add(
    'orbita-bundled',
    'Orbita riêng trong app',
    runtime?.orbitaBundled ? 'pass' : 'fail',
    runtime?.browser?.executable || 'Không tìm thấy Orbita',
  );
  add(
    'orbita-fonts',
    'Font mask giống GoLogin',
    runtime?.fontsCount >= 200 ? 'pass' : 'warn',
    `${runtime?.fontsCount || 0} font proxy trong ${runtime?.fontsDir || 'vendor/fonts'}`,
  );
  add(
    'proxy-native',
    'Proxy ghi native cho Orbita',
    !proxy ? 'warn' : savedProxyServer === proxyServer ? 'pass' : 'fail',
    !proxy ? 'Profile không chọn proxy' : `selected=${proxyServer}, gologin.proxy=${savedProxyServer || 'trống'}`,
  );
  add(
    'proxy-args',
    'Launch args dùng proxy',
    !proxy ? 'warn' : launchArgs.some((arg: string) => arg === `--proxy-server=${proxy.protocol}://${proxyServer}`) ? 'pass' : 'fail',
    launchArgs.find((arg: string) => arg.startsWith('--proxy-server=')) || 'Không có --proxy-server',
  );
  add(
    'proxy-pref-clean',
    'Proxy pref không nhúng credentials',
    !prefsProxyServer || !prefsProxyServer.includes('@') ? 'pass' : 'warn',
    prefsProxyServer || 'Không ghi preferences.proxy',
  );
  add(
    'geo-language',
    'Language theo IP/profile',
    gologin.languages === languages ? 'pass' : 'fail',
    `fingerprint=${languages || '-'}, gologin=${gologin.languages || '-'}`,
  );
  add(
    'geo-timezone',
    'Timezone theo IP/profile',
    gologin?.timezone?.id === expectedTimezone ? 'pass' : 'fail',
    `fingerprint=${expectedTimezone || '-'}, gologin=${gologin?.timezone?.id || '-'}`,
  );
  add(
    'google-signin',
    'Không chặn Google sign-in',
    preferences?.signin?.allowed === false ? 'fail' : 'pass',
    `signin.allowed=${String(preferences?.signin?.allowed)}`,
  );
  add(
    'no-kct-extension',
    'Không còn extension proxy KCT',
    staleProxyExtension ? 'fail' : 'pass',
    staleProxyExtension ? 'Preferences còn KCT Proxy Auth' : 'Sạch extension proxy cũ',
  );
  add(
    'no-foreign-components',
    'Không trỏ về GoLogin/Chrome ngoài app',
    foreignComponentExtensions.length ? 'fail' : 'pass',
    foreignComponentExtensions.length ? `${foreignComponentExtensions.length} component extension còn path ngoài app` : 'Sạch path component ngoài app',
  );
  add(
    'quic-disabled',
    'Tắt QUIC khi dùng proxy',
    launchArgs.includes('--disable-quic') ? 'pass' : 'warn',
    launchArgs.includes('--disable-quic') ? 'Có --disable-quic' : 'Chưa có --disable-quic trong lần launch gần nhất',
  );
  add(
    'dns-rules',
    'Không chặn DNS Google',
    launchArgs.some((arg: string) => arg.startsWith('--host-resolver-rules=')) ? 'fail' : 'pass',
    launchArgs.find((arg: string) => arg.startsWith('--host-resolver-rules=')) || 'Không dùng host-resolver-rules',
  );
  add(
    'fingerprint-core',
    'Core fingerprint Orbita',
    gologin.userAgent && gologin.webGl && gologin.audioContext && gologin.mediaDevices ? 'pass' : 'fail',
    `UA=${gologin.userAgent ? 'ok' : 'missing'}, WebGL=${gologin.webGl ? 'ok' : 'missing'}, Audio=${gologin.audioContext ? 'ok' : 'missing'}, Media=${gologin.mediaDevices ? 'ok' : 'missing'}`,
  );
  add(
    'profile-extensions',
    'Extension theo profile',
    Array.isArray(profile.extensionPaths) && profile.extensionPaths.length
      ? launchArgs.some((arg: string) => arg.startsWith('--load-extension=')) ? 'pass' : 'fail'
      : 'warn',
    Array.isArray(profile.extensionPaths) && profile.extensionPaths.length
      ? launchArgs.find((arg: string) => arg.startsWith('--load-extension=')) || 'Chưa load extension trong lần launch gần nhất'
      : 'Profile chưa cấu hình extension',
  );

  return {
    score: checks.filter((check) => check.status === 'pass').length,
    total: checks.length,
    checks,
    lastLaunchAt: launch?.launchedAt || null,
    reference: {
      source: 'Local GoLogin Orbita layout + Orbita Preferences keys',
      note: 'GoLogin profile cache trên máy không còn Preferences mẫu đầy đủ, nên audit dựa trên Orbita binary, fonts folder, launch args và gologin.* prefs thực tế.',
    },
    savedFingerprintKeys: Object.keys(fingerprint?.fingerprint || {}).sort(),
  };
}

function analyzeFingerprintConsistency(profile: Profile, proxy: any) {
  const fingerprint = normalizeFingerprint({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    fingerprint: profile.fingerprint,
  });
  const issues: Array<{ id: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];
  const renderer = fingerprint.webgl?.renderer || '';
  const ua = fingerprint.userAgent || '';
  const isWindows = fingerprint.os === 'windows';
  const isAndroid = fingerprint.os === 'android';
  const add = (id: string, status: 'pass' | 'warn' | 'fail', detail: string) => issues.push({ id, status, detail });

  add('ua-os', isWindows ? ua.includes('Windows NT') ? 'pass' : 'fail' : isAndroid ? /Android|Mobile/i.test(ua) ? 'pass' : 'fail' : ua.includes('Macintosh') ? 'pass' : 'fail', `${fingerprint.os} / ${ua}`);
  add('platform-os', isWindows ? fingerprint.platform === 'Win32' ? 'pass' : 'fail' : isAndroid ? /Linux arm/i.test(fingerprint.platform) ? 'pass' : 'fail' : fingerprint.platform === 'MacIntel' ? 'pass' : 'fail', fingerprint.platform);
  add('webgl-os', isWindows ? /Direct3D|D3D11/i.test(renderer) ? 'pass' : 'fail' : isAndroid ? /Adreno|Mali|PowerVR/i.test(renderer) ? 'pass' : 'fail' : !/Direct3D|D3D11/i.test(renderer) && /Apple|OpenGL Engine|Radeon/i.test(renderer) ? 'pass' : 'fail', renderer);
  add('touch-profile', isAndroid ? (fingerprint.maxTouchPoints || 0) > 0 ? 'pass' : 'fail' : (fingerprint.maxTouchPoints || 0) === 0 ? 'pass' : 'warn', `${fingerprint.maxTouchPoints || 0} touch points`);
  add('hardware-range', fingerprint.hardware.concurrency >= 2 && fingerprint.hardware.concurrency <= 16 && [2, 4, 8, 16].includes(fingerprint.hardware.memory) ? 'pass' : 'warn', `${fingerprint.hardware.concurrency} cores / ${fingerprint.hardware.memory}GB`);
  add('locale-proxy', proxy?.geo ? proxy.geo.timezone === fingerprint.timezone ? 'pass' : 'warn' : 'warn', proxy?.geo ? `${proxy.geo.countryCode} ${proxy.geo.timezone} / ${fingerprint.timezone}` : 'No proxy geo');
  add('font-os', fingerprint.fonts?.length ? 'pass' : 'fail', `${fingerprint.fonts?.slice(0, 6).join(', ')}`);
  add('chrome-version', fingerprint.chromeVersion.startsWith('146.') ? 'pass' : 'warn', fingerprint.chromeVersion);

  return {
    ok: issues.every((issue) => issue.status === 'pass'),
    issues,
  };
}

async function getProxyWithGeo(proxyId?: string | null) {
  if (!proxyId) return null;
  let proxy = proxyService.getById(proxyId);
  if (!proxy) return null;
  if (!proxy.geo && proxy.status !== 'dead') {
    const checkedProxy = await proxyService.checkProxy(proxyId).catch(() => proxyService.getById(proxyId));
    if (checkedProxy) proxy = checkedProxy;
  }
  return proxy;
}

async function normalizeProfileFingerprint(input: any, fallback?: Profile): Promise<Fingerprint> {
  const fingerprint = normalizeFingerprint({
    userAgent: input.userAgent || input.fingerprint?.userAgent || fallback?.userAgent || '',
    viewport: input.viewport || fallback?.viewport || { width: 1920, height: 1080 },
    fingerprint: input.fingerprint || fallback?.fingerprint || generateRandomFingerprint(),
  });

  const proxyId = input.proxyId === undefined ? fallback?.proxyId : input.proxyId;
  if (proxyId) {
    const proxy = await getProxyWithGeo(proxyId);
    if (proxy?.geo) return applyGeoToFingerprint(fingerprint, proxy.geo);
  }

  const customProxy = input.proxy === undefined ? fallback?.proxy : input.proxy;
  if (!proxyId && customProxy?.server) {
    const proxy = await proxyService.checkCustomProxy(customProxy.server, customProxy.username, customProxy.password).catch(() => null);
    if (proxy?.geo) return applyGeoToFingerprint(fingerprint, proxy.geo);
  }

  const countryCode = input.locationCountryCode || fallback?.locationCountryCode;
  if (countryCode) return applyGeoToFingerprint(fingerprint, { countryCode });

  return fingerprint;
}

async function prepareProfileForLaunch(profileId: string): Promise<Profile | null> {
  const profiles = loadProfiles();
  const index = profiles.findIndex((item) => item.id === profileId);
  if (index === -1) return null;

  const existing = profiles[index];
  const fingerprint = await normalizeProfileFingerprint(existing);
  const prepared: Profile = {
    ...existing,
    fingerprint,
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    updatedAt: Date.now(),
  };

  profiles[index] = prepared;
  saveProfiles(profiles);
  return prepared;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'kctlogin' });
});

app.get('/api/runtime', (_req, res) => {
  try {
    res.json({
      ...browserService.getRuntimeInfo(),
      storage: getDataDirInfo(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/remove-gemini-logo', async (req, res) => {
  try {
    const parsed = parseImageDataUrl(req.body?.imageDataUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Vui lòng upload ảnh PNG, JPG hoặc WebP hợp lệ.' });
    }
    if (parsed.buffer.byteLength > 40 * 1024 * 1024) {
      return res.status(413).json({ error: 'Ảnh quá lớn. Vui lòng dùng ảnh dưới 40MB.' });
    }

    const result = await removeWatermarkFromBuffer(parsed.buffer, {
      mimeType: parsed.mimeType,
      decodeImageData,
      encodeImageData,
    });

    res.json({
      imageDataUrl: `data:image/png;base64,${result.buffer.toString('base64')}`,
      mimeType: 'image/png',
      meta: result.meta,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Không thể remove logo Gemini.' });
  }
});

app.post('/api/remove-veo-logo', veoUpload.single('video'), async (req, res) => {
  const tempDir = path.join(os.tmpdir(), `kct-veo-${randomUUID()}`);
  let inputPath = '';
  let outputPath = '';

  try {
    if (!req.file) return res.status(400).json({ error: 'Vui lòng upload video.' });
    fs.mkdirSync(tempDir, { recursive: true });
    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.mp4';
    inputPath = path.join(tempDir, `input${extension}`);
    outputPath = path.join(tempDir, 'veo-logo-removed.mp4');
    fs.writeFileSync(inputPath, req.file.buffer);

    const requestedZoom = Number(req.body?.zoom || 1.12);
    const zoom = Number.isFinite(requestedZoom) ? Math.min(Math.max(requestedZoom, 1), 1.35) : 1.12;
    const { width, height } = await getVideoSize(inputPath);
    const filter = buildVeoZoomFilter(width, height, zoom);

    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', filter,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ], { maxBuffer: 10 * 1024 * 1024 });

    res.download(outputPath, `${path.parse(req.file.originalname || 'video').name}-veo-logo-removed.mp4`, (downloadError) => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (downloadError && !res.headersSent) {
        res.status(500).json({ error: downloadError.message });
      }
    });
  } catch (error: any) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({
      error: error.message?.includes('ffmpeg') || error.stderr
        ? 'Không thể xử lý video bằng ffmpeg. Vui lòng kiểm tra video đầu vào.'
        : error.message || 'Không thể remove logo VEO.',
    });
  }
});

app.get('/api/mcp', (_req, res) => {
  res.json({
    name: 'kctlogin',
    transport: 'stdio',
    command: 'npm',
    args: ['run', 'mcp:stdio'],
    cwd: process.cwd(),
    tools: MCP_TOOL_NAMES,
  });
});

app.get('/api/tokens', (_req, res) => {
  res.json(apiTokenService.list());
});

app.post('/api/tokens', (req, res) => {
  const token = apiTokenService.create(req.body?.name || 'API token');
  res.json(token);
});

app.delete('/api/tokens/:id', (req, res) => {
  res.json({ success: apiTokenService.delete(req.params.id) });
});

app.get('/api/remote-chrome/sessions', (_req, res) => {
  res.json(browserService.getRemoteSessions());
});

app.post('/api/remote-chrome/:id/start', async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  try {
    const requestedPort = Number(req.body?.port || 0);
    const port = requestedPort > 0 ? requestedPort : await findAvailablePort(9222);
    await browserService.launchProfile(profile, {
      mode: 'remote',
      url: req.body?.url,
      remoteDebuggingPort: port,
    });
    let version: any = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        version = await readChromeJson(port, '/json/version');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    res.json({
      success: true,
      profileId: profile.id,
      port,
      versionUrl: `http://127.0.0.1:${port}/json/version`,
      tabsUrl: `http://127.0.0.1:${port}/json/list`,
      webSocketDebuggerUrl: version?.webSocketDebuggerUrl || null,
      version,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/remote-chrome/:id/version', async (req, res) => {
  const session = browserService.getRemoteSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Remote Chrome session not found' });
  try {
    res.json(await readChromeJson(session.port, '/json/version'));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/verify/:id', (req, res) => {
  const profile = loadProfiles().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).send('Profile not found');
  res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>KCT Fingerprint Verify</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:#0f172a; color:#e5e7eb; padding:24px; }
    pre { background:#020617; border:1px solid #334155; border-radius:10px; padding:16px; white-space:pre-wrap; }
    .ok { color:#34d399; } .bad { color:#fb7185; }
  </style>
</head>
<body>
  <h1>KCT Fingerprint Verify</h1>
  <p id="status">Đang đo fingerprint...</p>
  <pre id="out"></pre>
  <script>
    async function webglInfo() {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return {};
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return debug ? {
        vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      } : {};
    }
    async function run() {
      const report = {
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        languages: Array.from(navigator.languages || []),
        language: navigator.language,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        webdriver: navigator.webdriver,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: {
          width: screen.width,
          height: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
          colorDepth: screen.colorDepth,
          devicePixelRatio,
        },
        webgl: await webglInfo(),
      };
      const response = await fetch('/api/profiles/${profile.id}/verify-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
      const result = await response.json();
      document.getElementById('status').innerHTML = result.ok ? '<span class="ok">PASS</span>' : '<span class="bad">CHECK WARNINGS</span>';
      document.getElementById('out').textContent = JSON.stringify(result, null, 2);
    }
    run().catch((error) => {
      document.getElementById('status').textContent = error.message;
    });
  </script>
</body>
</html>`);
});

app.get('/api/fingerprint/random', async (req, res) => {
  const os = req.query.os === 'android' ? 'android' : req.query.os === 'mac' ? 'mac' : req.query.os === 'windows' ? 'windows' : undefined;
  const deviceCategory = req.query.deviceCategory === 'desktop'
    ? 'desktop'
    : req.query.deviceCategory === 'tablet'
      ? 'tablet'
      : req.query.deviceCategory === 'mobile'
        ? 'mobile'
        : undefined;
  let fingerprint = generateRandomFingerprint(os, undefined, deviceCategory);
  const proxyId = typeof req.query.proxyId === 'string' ? req.query.proxyId : undefined;
  const countryCode = typeof req.query.countryCode === 'string' ? req.query.countryCode : undefined;

  if (proxyId) {
    const proxy = await getProxyWithGeo(proxyId);
    if (proxy?.geo) {
      fingerprint = applyGeoToFingerprint(fingerprint, proxy.geo);
    } else if (countryCode) {
      fingerprint = applyGeoToFingerprint(fingerprint, { countryCode });
    }
  } else if (countryCode) {
    fingerprint = applyGeoToFingerprint(fingerprint, { countryCode });
  }

  res.json(fingerprint);
});

app.get('/api/profiles', async (_req, res) => {
  const profiles = await Promise.all(loadProfiles().map(async (profile) => {
    let fingerprint = normalizeFingerprint({
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      fingerprint: profile.fingerprint,
    });
    const proxy = await getProxyWithGeo(profile.proxyId);
    if (proxy?.geo) fingerprint = applyGeoToFingerprint(fingerprint, proxy.geo);
    else if (profile.locationCountryCode) fingerprint = applyGeoToFingerprint(fingerprint, { countryCode: profile.locationCountryCode });
    return {
      ...profile,
      fingerprint,
      isRunning: browserService.isProfileRunning(profile.id),
    };
  }));
  res.json(profiles);
});

app.get('/api/profiles/export', (_req, res) => {
  const profiles = loadProfiles();
  const fileName = `kctlogin-profiles-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.json({
    format: 'kctlogin-profiles-v2',
    exportedAt: new Date().toISOString(),
    count: profiles.length,
    includes: {
      profiles: true,
      browserCookieFiles: true,
      savedCookieFiles: true,
    },
    profiles: profiles.map(buildProfileExportPayload),
  });
});

app.post('/api/profiles/import', async (req, res) => {
  const items = getImportProfileItems(req.body);
  if (!items.length) return res.status(400).json({ error: 'File không có danh sách profiles hợp lệ.' });

  const profiles = loadProfiles();
  const existingIds = new Set(profiles.map((profile) => profile.id).filter(Boolean));
  const imported: Profile[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (const [index, item] of items.entries()) {
    try {
      const mapped = mapImportedProfile(item);
      if (!mapped) {
        skipped.push({ index, reason: 'Dữ liệu profile không hợp lệ' });
        continue;
      }

      const id = buildUniqueProfileId(existingIds, mapped.id);
      const fallbackFingerprint = generateRandomFingerprint();
      const fingerprint = normalizeFingerprint({
        userAgent: mapped.userAgent || mapped.fingerprint?.userAgent || fallbackFingerprint.userAgent,
        viewport: mapped.viewport || {
          width: mapped.fingerprint?.screen?.width || fallbackFingerprint.screen.width,
          height: mapped.fingerprint?.screen?.height || fallbackFingerprint.screen.height,
        },
        fingerprint: mapped.fingerprint || fallbackFingerprint,
      });
      const profile: Profile = {
        ...mapped,
        id,
        name: String(mapped.name || `Imported profile ${imported.length + 1}`),
        isRunning: false,
        createdAt: typeof mapped.createdAt === 'number' ? mapped.createdAt : Date.now(),
        updatedAt: Date.now(),
        userAgent: fingerprint.userAgent,
        viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
        fingerprint,
      } as Profile;

      if (profile.proxyId && !proxyService.getById(profile.proxyId)) delete profile.proxyId;
      delete (profile as any).settingsTab;
      profiles.push(profile);
      imported.push(profile);
      fs.mkdirSync(path.join(profilesDataDir, id), { recursive: true });
      restoreCookieFiles(id, item?.browserCookieFiles);
      restoreSavedCookieFiles(String(item?.id || mapped.id || ''), id, item?.savedCookieFiles);
    } catch (error: any) {
      skipped.push({ index, reason: error.message || 'Không import được profile' });
    }
  }

  if (!imported.length) return res.status(400).json({ error: 'Không import được profile nào.', skipped });
  saveProfiles(profiles);
  res.json({ success: true, imported: imported.length, skipped });
});

app.post('/api/profiles', async (req, res) => {
  const profiles = loadProfiles();
  const fingerprint = await normalizeProfileFingerprint(req.body);
  const profile: Profile = {
    ...req.body,
    id: Math.random().toString(36).slice(2, 11),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    fingerprint,
  };
  profiles.push(profile);
  saveProfiles(profiles);
  res.json(profile);
});

app.put('/api/profiles/:id', async (req, res) => {
  const profiles = loadProfiles();
  const index = profiles.findIndex((profile) => profile.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Profile not found' });

  const updated: any = { ...profiles[index], ...req.body, id: req.params.id, createdAt: profiles[index].createdAt, updatedAt: Date.now() };
  for (const key of Object.keys(req.body)) {
    if (req.body[key] === null) delete updated[key];
  }
  updated.fingerprint = await normalizeProfileFingerprint(updated, profiles[index]);
  updated.userAgent = updated.fingerprint.userAgent;
  updated.viewport = { width: updated.fingerprint.screen.width, height: updated.fingerprint.screen.height };
  profiles[index] = updated;
  saveProfiles(profiles);
  res.json(updated);
});

app.delete('/api/profiles/:id', async (req, res) => {
  const id = req.params.id;
  await browserService.stopProfile(id).catch(() => {});
  const dir = path.join(profilesDataDir, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  saveProfiles(loadProfiles().filter((profile) => profile.id !== id));
  res.json({ success: true });
});

app.post('/api/profiles/:id/clone', async (req, res) => {
  const sourceId = req.params.id;
  const profiles = loadProfiles();
  const source = profiles.find((profile) => profile.id === sourceId);
  if (!source) return res.status(404).json({ error: 'Source profile not found' });

  const fingerprint = await normalizeProfileFingerprint(req.body, source);
  const nextId = Math.random().toString(36).slice(2, 11);
  const cloned: Profile = {
    ...source,
    ...req.body,
    id: nextId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    fingerprint,
  };

  const sourceDir = path.join(profilesDataDir, sourceId);
  const targetDir = path.join(profilesDataDir, nextId);
  const cloneBrowserData = req.body?.cloneBrowserData === true;
  if (cloneBrowserData && fs.existsSync(sourceDir)) {
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lockPath = path.join(targetDir, lock);
      if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
    }
    for (const snapshot of ['kct-last-launch.json', 'kct-verify-report.json']) {
      const snapshotPath = path.join(targetDir, snapshot);
      if (fs.existsSync(snapshotPath)) fs.rmSync(snapshotPath, { force: true });
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (req.body?.cloneCookies === true || cloneBrowserData) {
    for (const platform of ['chatgpt', 'gemini']) {
      const sourceCookie = getCookiesPath(sourceId, platform);
      const targetCookie = getCookiesPath(nextId, platform);
      if (fs.existsSync(sourceCookie)) {
        fs.mkdirSync(path.dirname(targetCookie), { recursive: true });
        fs.copyFileSync(sourceCookie, targetCookie);
      }
    }
  }

  profiles.push(cloned);
  saveProfiles(profiles);
  res.json(cloned);
});

app.post('/api/profiles/:id/launch', async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  try {
    const result = await browserService.launchProfile(profile, { mode: 'visible' });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/profiles/:id/diagnostics', async (req, res) => {
  const profile = loadProfiles().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const profileDir = path.join(profilesDataDir, profile.id);
  const preferences = readJsonFile(path.join(profileDir, 'Default', 'Preferences'), {});
  const securePreferences = readJsonFile(path.join(profileDir, 'Default', 'Secure Preferences'), {});
  const fingerprint = readJsonFile(path.join(profileDir, 'kct-orbita-fingerprint.json'), null);
  const verifyReport = readJsonFile(path.join(profileDir, 'kct-verify-report.json'), null);
  const launch = readJsonFile(path.join(profileDir, 'kct-last-launch.json'), null);
  const proxy = profile.proxyId
    ? proxyService.getById(profile.proxyId)
    : profile.proxy?.server
      ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password)
      : null;
  const log = readTextTail(path.join(profileDir, 'chrome_debug.log'));
  const runtime = browserService.getRuntimeInfo();

  res.json({
    profile: {
      id: profile.id,
      name: profile.name,
      isRunning: browserService.isProfileRunning(profile.id),
      profileDir,
    },
    runtime,
    selectedProxy: proxy,
    savedProxy: preferences?.gologin?.proxy || null,
    savedPrefsProxy: preferences?.proxy || null,
    savedSecureExtensionIds: Object.keys(securePreferences?.extensions?.settings || {}),
    savedFingerprint: fingerprint,
    verifyReport,
    lastLaunch: launch,
    goLoginCompatibility: analyzeGoLoginCompatibility({ profile, preferences, launch, runtime, proxy, fingerprint }),
    fingerprintConsistency: analyzeFingerprintConsistency(profile, proxy),
    lastLog: log,
    logAnalysis: analyzeBrowserLog(log),
  });
});

app.post('/api/profiles/:id/verify-report', (req, res) => {
  const profile = loadProfiles().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const report = req.body || {};
  const expected = profile.fingerprint;
  const checks = [
    { id: 'userAgent', pass: report.userAgent === expected.userAgent, expected: expected.userAgent, actual: report.userAgent },
    { id: 'platform', pass: report.platform === expected.platform, expected: expected.platform, actual: report.platform },
    { id: 'timezone', pass: report.timezone === expected.timezone, expected: expected.timezone, actual: report.timezone },
    { id: 'languages', pass: Array.isArray(report.languages) && expected.languages.every((item, index) => report.languages[index] === item), expected: expected.languages, actual: report.languages },
    { id: 'webdriver', pass: report.webdriver !== true, expected: 'not true', actual: report.webdriver },
    { id: 'hardwareConcurrency', pass: !expected.hardware?.concurrency || report.hardwareConcurrency === expected.hardware.concurrency, expected: expected.hardware?.concurrency, actual: report.hardwareConcurrency },
    { id: 'deviceMemory', pass: !expected.hardware?.memory || report.deviceMemory === expected.hardware.memory, expected: expected.hardware?.memory, actual: report.deviceMemory },
  ];
  const result = {
    ok: checks.every((check) => check.pass),
    profileId: profile.id,
    createdAt: new Date().toISOString(),
    checks,
    report,
  };
  const profileDir = path.join(profilesDataDir, profile.id);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'kct-verify-report.json'), JSON.stringify(result, null, 2));
  res.json(result);
});

app.post('/api/profiles/:id/check-proxy', async (req, res) => {
  const profile = loadProfiles().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (!profile.proxyId && !profile.proxy?.server) return res.status(400).json({ error: 'Profile chưa chọn proxy' });
  try {
    if (profile.proxyId) res.json(await proxyService.checkProxy(profile.proxyId));
    else res.json(await proxyService.checkCustomProxy(profile.proxy!.server, profile.proxy?.username, profile.proxy?.password));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles/:id/check-google', async (req, res) => {
  const profile = loadProfiles().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const proxy = profile.proxyId
    ? proxyService.getById(profile.proxyId)
    : profile.proxy?.server
      ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password)
      : null;
  if (!proxy) return res.status(400).json({ error: 'Profile chưa chọn proxy' });
  try {
    const targets = ['https://accounts.google.com', 'https://gemini.google.com', 'https://play.google.com/log?format=json'];
    const results = await Promise.all(targets.map((target) => proxyService.checkTarget(proxy, target)));
    res.json({ ok: results.every((result) => result.ok), results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles/:id/login', async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  try {
    await browserService.launchProfile(profile, { mode: 'login', url: req.body?.url });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles/:id/stop', async (req, res) => {
  await browserService.stopProfile(req.params.id);
  saveProfiles(loadProfiles().map((item) => item.id === req.params.id ? { ...item, updatedAt: Date.now() } : item));
  res.json({ success: true });
});

app.post('/api/profiles/:id/repair', async (req, res) => {
  if (!loadProfiles().some((profile) => profile.id === req.params.id)) return res.status(404).json({ error: 'Profile not found' });
  try {
    res.json(await browserService.repairProfile(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles/:id/logout', async (req, res) => {
  const id = req.params.id;
  await browserService.stopProfile(id).catch(() => {});
  for (const platform of ['chatgpt', 'gemini']) {
    const file = getCookiesPath(id, platform);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  res.json({ success: true });
});

app.get('/api/profiles/:id/cookies/:platform', (req, res) => {
  const platform = req.params.platform;
  if (!['chatgpt', 'gemini'].includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
  if (!loadProfiles().some((profile) => profile.id === req.params.id)) return res.status(404).json({ error: 'Profile not found' });
  const cookies = loadCookies(req.params.id, platform);
  const format = String(req.query.format || 'json') as 'json' | 'netscape' | 'header';
  if (format === 'netscape' || format === 'header') {
    res.type('text/plain').send(exportCookies(cookies, format));
    return;
  }
  res.json({ cookies });
});

app.post('/api/profiles/:id/cookies/:platform', (req, res) => {
  const platform = req.params.platform;
  if (!['chatgpt', 'gemini'].includes(platform)) return res.status(400).json({ error: 'Invalid platform' });
  const cookies = parseCookieInput(req.body.cookies ?? req.body.text ?? req.body, req.body.domain);
  if (!cookies.length) return res.status(400).json({ error: 'Không parse được cookie. Hỗ trợ JSON array, object {cookies}, Netscape, hoặc header name=value; name2=value2 kèm domain.' });
  saveCookies(req.params.id, platform, cookies);
  res.json({ success: true, count: cookies.length, cookies });
});

app.post('/api/profiles/:id/import-cookies', async (req, res) => {
  const { cookies, text, platform = 'gemini', domain } = req.body;
  const parsed = parseCookieInput(cookies ?? text, domain);
  if (!parsed.length) return res.status(400).json({ error: 'Không parse được cookie import' });
  const converted = cleanCookiesForPlaywright(parsed);
  saveCookies(req.params.id, platform, converted);
  res.json({ success: true, count: converted.length, platform, cookies: converted });
});

app.get('/api/proxies', (_req, res) => {
  res.json(proxyService.getAll());
});

app.post('/api/proxies', (req, res) => {
  if (!req.body.input) return res.status(400).json({ error: 'input is required' });
  res.json(proxyService.addProxies(req.body.input, req.body.group));
});

app.post('/api/proxies/fetch-free', async (_req, res) => {
  try {
    res.json(await proxyService.fetchFreeProxies());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proxies/check', async (req, res) => {
  const { ids, concurrency } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array is required' });
  if (ids.length === 1) return res.json(await proxyService.checkProxy(ids[0]));
  res.json(await proxyService.checkBatch(ids, concurrency || 3));
});

app.put('/api/proxies/:id', (req, res) => {
  const updated = proxyService.updateProxy(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Proxy not found' });
  res.json(updated);
});

app.delete('/api/proxies/:id', (req, res) => {
  proxyService.deleteProxy(req.params.id);
  res.json({ success: true });
});

app.get('/api/proxy-devices', (_req, res) => {
  res.json(proxyDeviceService.getAll());
});

app.get('/api/proxy-devices/network', (_req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = Object.entries(interfaces).flatMap(([name, items]) => (
    (items || [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => ({ name, address: item.address, cidr: item.cidr }))
  ));
  res.json({ addresses });
});

app.post('/api/proxy-devices', (req, res) => {
  try {
    res.json(proxyDeviceService.create(req.body));
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/proxy-devices/:id', (req, res) => {
  const updated = proxyDeviceService.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Proxy device not found' });
  res.json(updated);
});

app.delete('/api/proxy-devices/:id', (req, res) => {
  res.json({ success: proxyDeviceService.delete(req.params.id) });
});

app.post('/api/proxy-devices/:id/check', async (req, res) => {
  try {
    res.json(await proxyDeviceService.check(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proxy-devices/:id/add-proxy', (req, res) => {
  try {
    res.json(proxyDeviceService.addToProxyManager(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const distDir = path.join(process.env.KCT_APP_ROOT || process.cwd(), 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|verify\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`[KCTLogin] Server running at http://localhost:${port}`);
});
