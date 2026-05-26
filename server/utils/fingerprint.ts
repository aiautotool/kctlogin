import fs from 'fs';
import path from 'path';

export type BrowserOS = 'windows' | 'mac' | 'android';
export type DeviceCategory = 'desktop' | 'mobile' | 'tablet';

export interface Fingerprint {
  userAgent: string;
  platform: string;
  os: BrowserOS;
  deviceCategory?: DeviceCategory;
  chromeVersion: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    availWidth: number;
    availHeight: number;
    deviceScaleFactor: number;
  };
  webgl: {
    vendor: string;
    renderer: string;
    mode: 'noise' | 'off';
  };
  hardware: {
    concurrency: number;
    memory: number;
  };
  maxTouchPoints: number;
  languages: string[];
  timezone: string;
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  canvasSeed: number;
  canvasMode: 'noise' | 'off' | 'block';
  audioSeed: number;
  audioMode: 'noise' | 'off';
  fonts: string[];
  mediaDevices: {
    videoInput: number;
    audioInput: number;
    audioOutput: number;
  };
  webRtcMode: 'basedOnIp' | 'off';
  fontsMode: 'masked' | 'real';
  pluginsMode: 'masked' | 'real' | 'off';
  startUrlMode: 'previousTabs' | 'blank' | 'custom';
  bookmarksCount: number;
  customDns?: string;
  storage: {
    lockSession: boolean;
    saveTabs: boolean;
    saveHistory: boolean;
    saveBookmarks: boolean;
    enableGoogleServices: boolean;
    savePasswords: boolean;
    enableLocalStorage: boolean;
    enableIndexedDB: boolean;
    browserPlugins: boolean;
    allowInstallExtensions: boolean;
    systemExtensions: boolean;
  };
}

export interface FingerprintSettings {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceCategory?: DeviceCategory;
  language?: string;
  platform?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  canvas?: boolean;
  webgl?: boolean;
  audio?: boolean;
  timezone?: string;
  fingerprint?: Fingerprint;
}

const FONT_LISTS = {
  windows: ['Arial', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  mac: ['Arial', 'Helvetica', 'Helvetica Neue', 'Times', 'Courier', 'Geneva', 'Georgia', 'Palatino', 'Monaco', 'Menlo', 'San Francisco'],
  android: ['Roboto', 'Noto Sans', 'Droid Sans', 'Google Sans', 'Arial', 'sans-serif'],
};

const DEVICE_TEMPLATES = {
  windows: [
    {
      gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      screen: { width: 1920, height: 1080, scale: 1 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      screen: { width: 1366, height: 768, scale: 1 },
      hardware: { concurrency: 4, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      screen: { width: 1536, height: 864, scale: 1 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 2, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      screen: { width: 2560, height: 1440, scale: 1 },
      hardware: { concurrency: 12, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
  ],
  mac: [
    {
      gpu: { vendor: 'Apple Inc.', renderer: 'Apple M1' },
      screen: { width: 1440, height: 900, scale: 2 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Apple Inc.', renderer: 'Apple M2' },
      screen: { width: 1470, height: 956, scale: 2 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Apple Inc.', renderer: 'Apple M1 Pro' },
      screen: { width: 1728, height: 1117, scale: 2 },
      hardware: { concurrency: 10, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'ATI Technologies Inc.', renderer: 'AMD Radeon Pro 560X OpenGL Engine' },
      screen: { width: 1680, height: 1050, scale: 2 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
    },
  ],
  android: [
    {
      gpu: { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
      screen: { width: 393, height: 873, scale: 2.75 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'Qualcomm', renderer: 'Adreno (TM) 730' },
      screen: { width: 412, height: 915, scale: 2.625 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
    },
    {
      gpu: { vendor: 'ARM', renderer: 'Mali-G78' },
      screen: { width: 360, height: 800, scale: 3 },
      hardware: { concurrency: 8, memory: 4 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
    },
  ],
};

const TABLET_TEMPLATES = [
  {
    gpu: { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
    screen: { width: 800, height: 1280, scale: 2 },
    hardware: { concurrency: 8, memory: 8 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
  },
  {
    gpu: { vendor: 'ARM', renderer: 'Mali-G715' },
    screen: { width: 820, height: 1180, scale: 2 },
    hardware: { concurrency: 8, memory: 8 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
  },
  {
    gpu: { vendor: 'Qualcomm', renderer: 'Adreno (TM) 730' },
    screen: { width: 962, height: 1440, scale: 2 },
    hardware: { concurrency: 8, memory: 12 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 },
  },
];

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const getBundledOrbitaChromeVersion = () => {
  const infoPlist = path.join(process.cwd(), 'vendor', 'orbita-browser-146', 'Orbita-Browser.app', 'Contents', 'Info.plist');
  if (fs.existsSync(infoPlist)) {
    const content = fs.readFileSync(infoPlist, 'utf8');
    const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    if (match?.[1]) return match[1];
  }
  return '146.0.7680.165';
};

const buildChromeVersion = () => {
  return getBundledOrbitaChromeVersion();
};

const buildUserAgent = (os: BrowserOS, chromeVersion: string, deviceCategory: DeviceCategory) => {
  if (os === 'windows') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  if (os === 'android') {
    if (deviceCategory === 'tablet') {
      return `Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    }
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
};

const getPlatform = (os: BrowserOS) => {
  if (os === 'windows') return 'Win32';
  if (os === 'android') return 'Linux armv8l';
  return 'MacIntel';
};

const inferOS = (platform = '', userAgent = ''): BrowserOS => {
  if (/Android|Mobile/i.test(userAgent) || /Linux arm/i.test(platform)) return 'android';
  if (platform === 'Win32' || /Windows/i.test(userAgent)) return 'windows';
  return 'mac';
};

const getDeviceCategoryForOS = (os: BrowserOS, requested?: DeviceCategory): DeviceCategory => {
  if (requested) {
    if (requested === 'desktop') return os === 'android' ? 'mobile' : 'desktop';
    if (requested === 'mobile' || requested === 'tablet') return os === 'android' ? requested : 'desktop';
  }
  return os === 'android' ? 'mobile' : 'desktop';
};

const inferDeviceCategory = (fingerprint: Pick<Fingerprint, 'os' | 'userAgent' | 'screen'>): DeviceCategory => {
  if (fingerprint.os !== 'android') return 'desktop';
  if (!/Mobile/i.test(fingerprint.userAgent || '')) return 'tablet';
  return (fingerprint.screen?.width || 0) >= 768 ? 'tablet' : 'mobile';
};

const getTemplateFor = (os: BrowserOS, deviceCategory: DeviceCategory) => {
  if (os === 'android' && deviceCategory === 'tablet') return pick(TABLET_TEMPLATES);
  return pick(DEVICE_TEMPLATES[os]);
};

export const generateRandomFingerprint = (os?: BrowserOS, seed?: string, deviceCategory?: DeviceCategory): Fingerprint => {
  void seed;
  const finalOS = os || (deviceCategory === 'desktop' ? pick<BrowserOS>(['windows', 'mac']) : 'android');
  const finalDeviceCategory = getDeviceCategoryForOS(finalOS, deviceCategory);
  const template = getTemplateFor(finalOS, finalDeviceCategory);
  const chromeVersion = buildChromeVersion();
  const userAgent = buildUserAgent(finalOS, chromeVersion, finalDeviceCategory);

  return {
    userAgent,
    platform: getPlatform(finalOS),
    os: finalOS,
    deviceCategory: finalDeviceCategory,
    chromeVersion,
    screen: {
      width: template.screen.width,
      height: template.screen.height,
      colorDepth: 24,
      availWidth: template.screen.width,
      availHeight: getAvailHeight(finalOS, template.screen.height),
      deviceScaleFactor: template.screen.scale,
    },
    webgl: { ...template.gpu, mode: 'noise' },
    hardware: template.hardware,
    maxTouchPoints: finalOS === 'android' ? 5 : 0,
    languages: ['vi-VN', 'vi', 'en-US', 'en'],
    timezone: 'Asia/Ho_Chi_Minh',
    canvasSeed: Math.random(),
    canvasMode: 'noise',
    audioSeed: Math.random(),
    audioMode: 'noise',
    fonts: FONT_LISTS[finalOS],
    mediaDevices: template.mediaDevices,
    webRtcMode: 'basedOnIp',
    fontsMode: 'masked',
    pluginsMode: 'masked',
    startUrlMode: 'previousTabs',
    bookmarksCount: Math.floor(Math.random() * 34),
    storage: {
      lockSession: false,
      saveTabs: true,
      saveHistory: true,
      saveBookmarks: true,
      enableGoogleServices: true,
      savePasswords: true,
      enableLocalStorage: true,
      enableIndexedDB: false,
      browserPlugins: true,
      allowInstallExtensions: true,
      systemExtensions: false,
    },
  };
};

export const getGeoFingerprintUpdates = (countryCode: string) => {
  const mapping: Record<string, { timezone: string; languages: string[] }> = {
    VN: { timezone: 'Asia/Ho_Chi_Minh', languages: ['vi-VN', 'vi', 'en-US', 'en'] },
    US: { timezone: 'America/New_York', languages: ['en-US', 'en'] },
    GB: { timezone: 'Europe/London', languages: ['en-GB', 'en'] },
    CA: { timezone: 'America/Toronto', languages: ['en-CA', 'en-US', 'en'] },
    AU: { timezone: 'Australia/Sydney', languages: ['en-AU', 'en'] },
    DE: { timezone: 'Europe/Berlin', languages: ['de-DE', 'de', 'en-US', 'en'] },
    FR: { timezone: 'Europe/Paris', languages: ['fr-FR', 'fr', 'en-US', 'en'] },
    JP: { timezone: 'Asia/Tokyo', languages: ['ja-JP', 'ja', 'en-US', 'en'] },
    KR: { timezone: 'Asia/Seoul', languages: ['ko-KR', 'ko', 'en-US', 'en'] },
    TH: { timezone: 'Asia/Bangkok', languages: ['th-TH', 'th', 'en-US', 'en'] },
    RU: { timezone: 'Europe/Moscow', languages: ['ru-RU', 'ru', 'en-US', 'en'] },
    SG: { timezone: 'Asia/Singapore', languages: ['en-SG', 'en-US', 'en'] },
    ID: { timezone: 'Asia/Jakarta', languages: ['id-ID', 'id', 'en-US', 'en'] },
    PH: { timezone: 'Asia/Manila', languages: ['en-PH', 'en-US', 'en'] },
    MY: { timezone: 'Asia/Kuala_Lumpur', languages: ['ms-MY', 'ms', 'en-US', 'en'] },
    IN: { timezone: 'Asia/Kolkata', languages: ['en-IN', 'hi-IN', 'en'] },
  };

  return mapping[countryCode.toUpperCase()] || {
    timezone: 'UTC',
    languages: ['en-US', 'en'],
  };
};

export const applyGeoToFingerprint = (
  fingerprint: Fingerprint,
  geo?: { countryCode?: string; timezone?: string; latitude?: number; longitude?: number },
): Fingerprint => {
  if (!geo?.countryCode && !geo?.timezone) return fingerprint;
  const updates = geo.countryCode ? getGeoFingerprintUpdates(geo.countryCode) : undefined;
  return {
    ...fingerprint,
    languages: updates?.languages || fingerprint.languages,
    timezone: geo.timezone || updates?.timezone || fingerprint.timezone,
    geolocation: typeof geo.latitude === 'number' && typeof geo.longitude === 'number'
      ? { latitude: geo.latitude, longitude: geo.longitude, accuracy: 50 }
      : fingerprint.geolocation,
  };
};

const hasWindowsWebgl = (renderer = '') => /Direct3D|D3D11|NVIDIA|Intel\(R\)|Radeon/i.test(renderer);
const hasMacWebgl = (renderer = '') => /Apple|OpenGL Engine|Radeon Pro/i.test(renderer) && !/Direct3D|D3D11/i.test(renderer);
const hasAndroidWebgl = (renderer = '') => /Adreno|Mali|PowerVR|ANGLE \(Qualcomm|ANGLE \(ARM/i.test(renderer) && !/Direct3D|D3D11/i.test(renderer);

const getAvailHeight = (os: BrowserOS, height: number) => Math.max(1, height - (os === 'windows' ? 40 : os === 'mac' ? 25 : 0));

export const repairFingerprintConsistency = (fingerprint: Fingerprint): Fingerprint => {
  const os = fingerprint.os || inferOS(fingerprint.platform, fingerprint.userAgent);
  const deviceCategory = fingerprint.deviceCategory || inferDeviceCategory({
    os,
    userAgent: fingerprint.userAgent,
    screen: fingerprint.screen,
  });
  const template = getTemplateFor(os, getDeviceCategoryForOS(os, deviceCategory));
  const chromeVersion = getBundledOrbitaChromeVersion();
  const finalDeviceCategory = getDeviceCategoryForOS(os, deviceCategory);
  const userAgent = buildUserAgent(os, chromeVersion, finalDeviceCategory);
  const renderer = fingerprint.webgl?.renderer || '';
  const webglLooksRight = os === 'windows'
    ? hasWindowsWebgl(renderer) && !/OpenGL/i.test(renderer)
    : os === 'android'
      ? hasAndroidWebgl(renderer)
      : hasMacWebgl(renderer);
  const hardwareConcurrency = Math.min(16, Math.max(2, fingerprint.hardware?.concurrency || template.hardware.concurrency));
  const deviceMemory = [2, 4, 8, 16].includes(fingerprint.hardware?.memory)
    ? fingerprint.hardware.memory
    : template.hardware.memory;
  const width = fingerprint.screen?.width || template.screen.width;
  const height = fingerprint.screen?.height || template.screen.height;

  return {
    ...fingerprint,
    userAgent,
    platform: getPlatform(os),
    os,
    deviceCategory: finalDeviceCategory,
    chromeVersion,
    screen: {
      ...fingerprint.screen,
      width,
      height,
      colorDepth: fingerprint.screen?.colorDepth || 24,
      availWidth: width,
      availHeight: getAvailHeight(os, height),
      deviceScaleFactor: os === 'windows' ? 1 : (fingerprint.screen?.deviceScaleFactor || template.screen.scale),
    },
    webgl: {
      ...(webglLooksRight ? fingerprint.webgl : template.gpu),
      mode: fingerprint.webgl?.mode || 'noise',
    },
    hardware: {
      concurrency: hardwareConcurrency,
      memory: deviceMemory,
    },
    maxTouchPoints: os === 'android' ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0,
    fonts: fingerprint.fonts?.some((font) => FONT_LISTS[os].includes(font)) ? fingerprint.fonts : FONT_LISTS[os],
    mediaDevices: fingerprint.mediaDevices || template.mediaDevices,
    pluginsMode: fingerprint.pluginsMode === 'real' ? 'masked' : (fingerprint.pluginsMode || 'masked'),
  };
};

export const normalizeFingerprint = (settings: FingerprintSettings): Fingerprint => {
  const fallbackOS = inferOS(settings.platform, settings.userAgent);
  const fallbackChromeVersion = settings.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || getBundledOrbitaChromeVersion();
  const base = settings.fingerprint;

  if (!base) {
    return repairFingerprintConsistency({
      userAgent: settings.userAgent,
      platform: settings.platform || getPlatform(fallbackOS),
      os: fallbackOS,
      deviceCategory: settings.deviceCategory || (fallbackOS === 'android' ? 'mobile' : 'desktop'),
      chromeVersion: fallbackChromeVersion,
      screen: {
        width: settings.viewport.width,
        height: settings.viewport.height,
        colorDepth: 24,
        availWidth: settings.viewport.width,
        availHeight: settings.viewport.height,
        deviceScaleFactor: 1,
      },
      webgl: {
        vendor: fallbackOS === 'mac' ? 'Apple Inc.' : 'Google Inc. (NVIDIA)',
        renderer: fallbackOS === 'mac' ? 'Apple M1' : 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, OpenGL 4.1)',
        mode: settings.webgl === false ? 'off' : 'noise',
      },
      hardware: {
        concurrency: settings.hardwareConcurrency || 8,
        memory: settings.deviceMemory || 8,
      },
      maxTouchPoints: fallbackOS === 'android' ? 5 : 0,
      languages: [settings.language || 'en-US', (settings.language || 'en-US').split('-')[0]],
      timezone: settings.timezone || 'UTC',
      canvasSeed: 0.5,
      canvasMode: settings.canvas === false ? 'off' : 'noise',
      audioSeed: 0.5,
      audioMode: settings.audio === false ? 'off' : 'noise',
      fonts: FONT_LISTS[fallbackOS],
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
      webRtcMode: 'basedOnIp',
      fontsMode: 'masked',
      pluginsMode: 'masked',
      startUrlMode: 'previousTabs',
      bookmarksCount: 0,
      storage: {
        lockSession: false,
        saveTabs: true,
        saveHistory: true,
        saveBookmarks: true,
        enableGoogleServices: true,
        savePasswords: true,
        enableLocalStorage: true,
        enableIndexedDB: false,
        browserPlugins: true,
        allowInstallExtensions: true,
        systemExtensions: false,
      },
    });
  }

  const os = base.os || inferOS(base.platform, base.userAgent);
  const chromeVersion = base.chromeVersion || base.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || fallbackChromeVersion;
  return repairFingerprintConsistency({
    ...base,
    os,
    deviceCategory: base.deviceCategory || settings.deviceCategory || inferDeviceCategory({
      os,
      userAgent: base.userAgent,
      screen: base.screen,
    }),
    chromeVersion,
    screen: {
      ...base.screen,
      colorDepth: base.screen.colorDepth || 24,
      availWidth: base.screen.availWidth || base.screen.width,
      availHeight: base.screen.availHeight || base.screen.height,
      deviceScaleFactor: base.screen.deviceScaleFactor || 1,
    },
    webgl: {
      ...base.webgl,
      mode: base.webgl.mode || 'noise',
    },
    canvasMode: base.canvasMode || 'noise',
    audioMode: base.audioMode || 'noise',
    fonts: base.fonts?.length ? base.fonts : FONT_LISTS[os],
    mediaDevices: base.mediaDevices || { videoInput: 1, audioInput: 1, audioOutput: 1 },
    webRtcMode: base.webRtcMode || 'basedOnIp',
    fontsMode: base.fontsMode || 'masked',
    pluginsMode: base.pluginsMode || 'masked',
    startUrlMode: base.startUrlMode || 'previousTabs',
    bookmarksCount: typeof base.bookmarksCount === 'number' ? base.bookmarksCount : 0,
    storage: {
      lockSession: base.storage?.lockSession ?? false,
      saveTabs: base.storage?.saveTabs ?? true,
      saveHistory: base.storage?.saveHistory ?? true,
      saveBookmarks: base.storage?.saveBookmarks ?? true,
      enableGoogleServices: base.storage?.enableGoogleServices ?? true,
      savePasswords: base.storage?.savePasswords ?? true,
      enableLocalStorage: base.storage?.enableLocalStorage ?? true,
      enableIndexedDB: base.storage?.enableIndexedDB ?? false,
      browserPlugins: base.storage?.browserPlugins ?? true,
      allowInstallExtensions: base.storage?.allowInstallExtensions ?? true,
      systemExtensions: base.storage?.systemExtensions ?? false,
    },
  });
};
