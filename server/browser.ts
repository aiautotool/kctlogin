import { spawn, spawnSync, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDirInfo, getProfilesDataDir } from './dataDir';
import { proxyService, type Proxy } from './proxyService';
import { cleanupBrowserLock } from './utils/browserCleanup';
import { normalizeFingerprint, type Fingerprint } from './utils/fingerprint';

export interface Profile {
  id: string;
  name: string;
  userAgent: string;
  viewport: { width: number; height: number };
  proxyId?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  locationCountryCode?: string;
  extensionPaths?: string[];
  launchArgs?: string[];
  notes?: string;
  folderName?: string;
  pinned?: boolean;
  startUrl?: string;
  fingerprint: Fingerprint;
  createdAt: number;
  updatedAt?: number;
}

class BrowserService {
  private activeProcesses = new Map<string, ChildProcess>();
  private remoteSessions = new Map<string, { profileId: string; port: number; startedAt: string; url: string }>();
  private dataDir = getProfilesDataDir();

  constructor() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  private getBrowserExecutable(): { executable: string; name: string; cwd?: string } {
    const resourcesPath = process.env.KCT_RESOURCES_PATH || process.cwd();
    const localOrbitaDir = fs.existsSync(path.join(process.cwd(), 'vendor', 'orbita-browser-146'))
      ? path.join(process.cwd(), 'vendor', 'orbita-browser-146')
      : path.join(resourcesPath, 'vendor', 'orbita-browser-146');
    const localOrbita = path.join(localOrbitaDir, 'Orbita-Browser.app', 'Contents', 'MacOS', 'Orbita');
    if (fs.existsSync(localOrbita)) return { executable: localOrbita, name: 'Orbita', cwd: localOrbitaDir };

    throw new Error('Không tìm thấy Orbita bundled để mở profile fingerprint. Cài/đóng gói vendor/orbita-browser-146 trước khi launch.');
  }

  getRuntimeInfo() {
    const browser = this.getBrowserExecutable();
    const resourcesPath = process.env.KCT_RESOURCES_PATH || process.cwd();
    const fontsDir = fs.existsSync(path.join(process.cwd(), 'vendor', 'fonts'))
      ? path.join(process.cwd(), 'vendor', 'fonts')
      : path.join(resourcesPath, 'vendor', 'fonts');
    return {
      browser,
      orbitaBundled: browser.name === 'Orbita' && browser.executable.includes(path.join('vendor', 'orbita-browser-146')),
      fontsDir,
      fontsCount: fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir).filter((name) => name.endsWith('.ttf')).length : 0,
      dataDir: this.dataDir,
      storage: getDataDirInfo(),
    };
  }

  private readJsonFile(file: string, fallback: any = {}) {
    if (!fs.existsSync(file)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }

  private writeJsonFile(file: string, value: any) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  }

  private removePath(target: string) {
    try {
      fs.lstatSync(target);
    } catch {
      return;
    }
    fs.rmSync(target, { recursive: true, force: true });
  }

  private stableId(input: string, length = 40) {
    return crypto.createHash('sha1').update(input).digest('hex').slice(0, length);
  }

  private stableFraction(input: string) {
    const raw = parseInt(this.stableId(input, 12), 16) / 0xffffffffffff;
    return Number.isFinite(raw) && raw > 0 ? raw : 0.5;
  }

  private isMobileFingerprint(fingerprint: Fingerprint) {
    return fingerprint.os === 'android';
  }

  private getMaxTouchPoints(fingerprint: Fingerprint) {
    return this.isMobileFingerprint(fingerprint) ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0;
  }

  private cleanupExtensionPreferences(preferences: any) {
    const settings = preferences?.extensions?.settings;
    if (!settings || typeof settings !== 'object') return;

    for (const [extensionId, value] of Object.entries<any>(settings)) {
      const extensionPath = String(value?.path || '');
      const extensionName = String(value?.manifest?.name || '');
      const isKctProxyExtension = extensionPath.includes('kct_proxy_auth_extension') || extensionName === 'KCT Proxy Auth';
      const isForeignComponentExtension = value?.location === 5 && (
        extensionPath.includes('/.gologin/browser/orbita-browser') ||
        extensionPath.includes('/Applications/Google Chrome.app') ||
        extensionPath.includes('/Applications/Chromium.app')
      );

      if (isKctProxyExtension || isForeignComponentExtension) {
        delete settings[extensionId];
        delete preferences.extensions?.commands?.[`mac:Alt+O`];
      }
    }
  }

  private cleanupProfilePreferences(profileDir: string) {
    const preferencesPath = path.join(profileDir, 'Default', 'Preferences');
    if (!fs.existsSync(preferencesPath)) return;
    const preferences = this.readJsonFile(preferencesPath, {});
    this.cleanupExtensionPreferences(preferences);
    this.writeJsonFile(preferencesPath, preferences);
  }

  private cleanupVolatileProfileState(profileDir: string) {
    const defaultDir = path.join(profileDir, 'Default');
    const removablePaths = [
      path.join(profileDir, 'BrowserMetrics'),
      path.join(profileDir, 'BrowserMetrics-spare.pma'),
      path.join(profileDir, 'ChromeFeatureState'),
      path.join(profileDir, 'Crashpad'),
      path.join(profileDir, 'DawnGraphiteCache'),
      path.join(profileDir, 'DawnWebGPUCache'),
      path.join(profileDir, 'GPUCache'),
      path.join(profileDir, 'GraphiteDawnCache'),
      path.join(profileDir, 'GrShaderCache'),
      path.join(profileDir, 'Network Persistent State'),
      path.join(profileDir, 'ShaderCache'),
      path.join(profileDir, 'segmentation_platform', 'ukm_db'),
      path.join(profileDir, 'segmentation_platform', 'ukm_db-shm'),
      path.join(profileDir, 'segmentation_platform', 'ukm_db-wal'),
      path.join(defaultDir, 'DIPS'),
      path.join(defaultDir, 'DIPS-shm'),
      path.join(defaultDir, 'DIPS-wal'),
      path.join(defaultDir, 'LOCK'),
      path.join(defaultDir, 'Network Persistent State'),
      path.join(defaultDir, 'QuotaManager'),
      path.join(defaultDir, 'QuotaManager-journal'),
      path.join(defaultDir, 'Secure Preferences'),
      path.join(defaultDir, 'SharedStorage-shm'),
      path.join(defaultDir, 'SharedStorage-wal'),
    ];

    for (const target of removablePaths) {
      this.removePath(target);
    }
  }

  private languageHeader(languages: string[]) {
    return languages.map((language, index) => (index === 0 ? language : `${language};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`)).join(',');
  }

  private async resolveProxy(profile: Profile): Promise<Proxy | null> {
    const proxyId = profile.proxyId;
    let proxy = proxyId ? proxyService.getById(proxyId) : null;
    if (proxyId) {
      if (!proxy) throw new Error(`Proxy đã chọn không còn tồn tại: ${proxyId}`);
      if (proxy.status !== 'alive') {
        const checkedProxy = await proxyService.checkProxy(proxyId).catch(() => proxyService.getById(proxyId));
        if (checkedProxy) proxy = checkedProxy;
      }
      if (!proxy || proxy.status !== 'alive') {
        throw new Error(`Proxy ${proxy?.host || proxyId}:${proxy?.port || ''} không hoạt động. Dừng launch để tránh lộ IP thật.`);
      }
    }
    if (!proxyId && profile.proxy?.server) {
      const checkedProxy = await proxyService.checkCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password);
      if (checkedProxy.status !== 'alive') {
        throw new Error(`Proxy nhập tay ${profile.proxy.server} không hoạt động. Dừng launch để tránh lộ IP thật.`);
      }
      return checkedProxy;
    }
    return proxy || null;
  }

  private stopProcessesUsingProfileDir(profileDir: string) {
    const pids = this.getProcessesUsingProfileDir(profileDir);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }

    if (pids.length) {
      const start = Date.now();
      while (Date.now() - start < 800) {}
    }
  }

  private getProcessesUsingProfileDir(profileDir: string) {
    const currentPid = String(process.pid);
    const profileId = path.basename(profileDir);
    const patterns = [profileDir, `${path.sep}profiles_data${path.sep}${profileId}`];
    const pids = new Set<number>();

    for (const pattern of patterns) {
      const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === currentPid) continue;
        const pid = Number(trimmed);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }

    return Array.from(pids);
  }

  private focusProcess(pid: number) {
    if (process.platform === 'darwin') {
      const script = `
tell application "System Events"
  set targetProcess to first process whose unix id is ${pid}
  set frontmost of targetProcess to true
end tell`;
      const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
      if (result.status === 0) return true;
    }
    return false;
  }

  focusProfile(profileId: string) {
    const profileDir = path.join(this.dataDir, profileId);
    const current = this.activeProcesses.get(profileId);
    const pids = [
      ...(current?.pid && current.exitCode === null && !current.killed ? [current.pid] : []),
      ...this.getProcessesUsingProfileDir(profileDir),
    ];
    const uniquePids = Array.from(new Set(pids));
    for (const pid of uniquePids) {
      if (this.focusProcess(pid)) return true;
    }
    return false;
  }

  private getProfileExtensionPaths(profile: Profile) {
    const paths = Array.isArray(profile.extensionPaths) ? profile.extensionPaths : [];
    return paths
      .map((extensionPath) => extensionPath.trim())
      .filter(Boolean)
      .filter((extensionPath) => {
        if (!fs.existsSync(extensionPath)) return false;
        const stat = fs.statSync(extensionPath);
        return stat.isDirectory() && fs.existsSync(path.join(extensionPath, 'manifest.json'));
      });
  }

  private resolveStartupUrl(profile: Profile, explicitUrl?: string) {
    if (explicitUrl) return explicitUrl;
    if (profile.fingerprint?.startUrlMode === 'blank') return 'about:blank';
    if (profile.fingerprint?.startUrlMode === 'custom' && profile.startUrl) return profile.startUrl;
    return 'https://gemini.google.com';
  }

  private async writeOrbitaPreferences(profile: Profile, profileDir: string, startupUrl: string, proxy: Proxy | null) {
    const fingerprint = profile.fingerprint;
    const defaultDir = path.join(profileDir, 'Default');
    const preferencesPath = path.join(defaultDir, 'Preferences');
    const preferences = this.readJsonFile(preferencesPath, {});
    this.cleanupExtensionPreferences(preferences);
    const languages = fingerprint.languages?.length ? fingerprint.languages : ['en-US', 'en'];
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const deviceScaleFactor = fingerprint.screen?.deviceScaleFactor || 1;
    const mediaDevices = fingerprint.mediaDevices || { videoInput: 1, audioInput: 1, audioOutput: 1 };
    const canvasNoise = this.stableFraction(`${profile.id}:${fingerprint.canvasSeed}:canvas`);
    const audioNoise = this.stableFraction(`${profile.id}:${fingerprint.audioSeed}:audio`) * 1e-6;
    const proxyServer = proxy ? `${proxy.host}:${proxy.port}` : profile.proxy?.server?.replace(/^[a-z]+:\/\//i, '');
    const proxyProtocol = proxy?.protocol || (profile.proxy?.server?.match(/^([a-z]+):\/\//i)?.[1] || 'http');
    const webRtcEnabled = fingerprint.webRtcMode !== 'off';
    const pluginsEnabled = fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== 'off';
    const canvasMode = fingerprint.canvasMode === 'block' ? 'block' : fingerprint.canvasMode === 'off' ? 'off' : 'noise';
    const isMobile = this.isMobileFingerprint(fingerprint);

    preferences.gologin = {
      ...(preferences.gologin || {}),
      audioContext: {
        enable: fingerprint.audioMode !== 'off',
        noiseValue: audioNoise,
      },
      canvasMode,
      canvasNoise,
      client_rects_noise_enable: true,
      deviceMemory: (fingerprint.hardware?.memory || 8) * 1024,
      dns: fingerprint.customDns || '',
      doNotTrack: true,
      geoLocation: fingerprint.geolocation ? {
        accuracy: fingerprint.geolocation.accuracy || 100,
        latitude: fingerprint.geolocation.latitude,
        longitude: fingerprint.geolocation.longitude,
        mode: 'prompt',
      } : { mode: 'block' },
      getClientRectsNoice: canvasNoise,
      get_client_rects_noise: canvasNoise,
      hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
      is_m1: fingerprint.os === 'mac',
      langHeader: this.languageHeader(languages),
      languages: languages.join(','),
      mediaDevices: {
        audioInputs: mediaDevices.audioInput ?? 1,
        audioOutputs: mediaDevices.audioOutput ?? 1,
        enable: true,
        uid: this.stableId(`${profile.id}:media`),
        videoInputs: mediaDevices.videoInput ?? 1,
      },
      mobile: {
        device_scale_factor: deviceScaleFactor + 0.00000001,
        enable: isMobile,
        height,
        width,
      },
      name: profile.name,
      navigator: {
        max_touch_points: this.getMaxTouchPoints(fingerprint),
        platform: fingerprint.platform,
      },
      plugins: {
        all_enable: pluginsEnabled,
        flash_enable: false,
      },
      profile_id: profile.id,
      proxy: proxyServer ? {
        mode: 'fixed_servers',
        password: proxy?.password || profile.proxy?.password || '',
        schema: proxyProtocol,
        server: proxyServer,
        username: proxy?.username || profile.proxy?.username || '',
      } : { mode: 'direct' },
      screenHeight: height,
      screenWidth: width,
      startupUrl,
      startup_urls: [startupUrl],
      storage: {
        allowInstallExtensions: fingerprint.storage?.allowInstallExtensions !== false,
        browserPlugins: pluginsEnabled,
        enable: fingerprint.storage?.enableLocalStorage !== false,
        enableGoogleServices: fingerprint.storage?.enableGoogleServices !== false,
        enableIndexedDB: fingerprint.storage?.enableIndexedDB !== false,
        lockSession: !!fingerprint.storage?.lockSession,
        saveBookmarks: fingerprint.storage?.saveBookmarks !== false,
        saveHistory: fingerprint.storage?.saveHistory !== false,
        savePasswords: fingerprint.storage?.savePasswords !== false,
        saveTabs: fingerprint.storage?.saveTabs !== false,
        systemExtensions: !!fingerprint.storage?.systemExtensions,
      },
      timezone: {
        id: fingerprint.timezone || 'UTC',
      },
      userAgent: fingerprint.userAgent || profile.userAgent,
      webGl: {
        mode: fingerprint.webgl?.mode !== 'off',
        renderer: fingerprint.webgl?.renderer || '',
        vendor: fingerprint.webgl?.vendor || '',
      },
      webgl: {
        metadata: {
          mode: fingerprint.webgl?.mode !== 'off',
          renderer: fingerprint.webgl?.renderer || '',
          vendor: fingerprint.webgl?.vendor || '',
        },
      },
      webglNoiceEnable: fingerprint.webgl?.mode === 'noise',
      webglNoiseValue: Math.round(canvasNoise * 100000) / 1000,
      webgl_noice_enable: fingerprint.webgl?.mode === 'noise',
      webgl_noise_enable: fingerprint.webgl?.mode === 'noise',
      webgl_noise_value: Math.round(canvasNoise * 100000) / 1000,
      webRTC: {
        customize: true,
        enable: webRtcEnabled,
        enabled: webRtcEnabled,
        fillBasedOnIp: webRtcEnabled,
        isEmptyIceList: true,
        localIpMasking: !webRtcEnabled,
        localIps: [],
        mode: webRtcEnabled ? 'alerted' : 'disabled',
        publicIp: '',
      },
      webrtc: {
        enable: webRtcEnabled,
        mode: webRtcEnabled ? 'alerted' : 'disabled',
        should_fill_empty_ice_list: true,
      },
    };

    preferences.proxy = proxyServer ? {
      mode: 'fixed_servers',
      server: `${proxyProtocol}://${proxyServer}`,
    } : { mode: 'direct' };

    preferences.intl = {
      ...(preferences.intl || {}),
      accept_languages: languages.join(','),
      app_locale: languages[0],
      selected_languages: languages.join(','),
    };

    preferences.browser = {
      ...(preferences.browser || {}),
      window_placement: {
        bottom: Math.min(height + 60, height + 60),
        left: 0,
        maximized: false,
        right: width,
        top: 60,
        work_area_bottom: height + 60,
        work_area_left: 0,
        work_area_right: width,
        work_area_top: 0,
      },
    };

    preferences.session = {
      ...(preferences.session || {}),
      restore_on_startup: 4,
      startup_urls: [startupUrl],
    };

    preferences.signin = {
      ...(preferences.signin || {}),
      allowed: true,
      signin_with_explicit_browser_signin_on: true,
    };

    preferences.profile = {
      ...(preferences.profile || {}),
      name: profile.name,
      password_manager_enabled: fingerprint.storage?.savePasswords !== false,
    };

    preferences.credentials_enable_service = fingerprint.storage?.savePasswords !== false;
    preferences.history = {
      ...(preferences.history || {}),
      saving_disabled: fingerprint.storage?.saveHistory === false,
    };
    preferences.bookmark = {
      ...(preferences.bookmark || {}),
      saving_disabled: fingerprint.storage?.saveBookmarks === false,
    };

    this.writeJsonFile(preferencesPath, preferences);
    this.writeJsonFile(path.join(profileDir, 'kct-orbita-fingerprint.json'), {
      profileId: profile.id,
      updatedAt: new Date().toISOString(),
      fingerprint: preferences.gologin,
    });
  }

  private writeBrowserProfileSnapshot(profile: Profile, profileDir: string, startupUrl: string, proxy: Proxy | null) {
    const fingerprint = profile.fingerprint;
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const now = new Date().toISOString();
    const remote = this.getRemoteSession(profile.id);

    this.writeJsonFile(path.join(profileDir, 'kct-browser-profile.json'), {
      name: profile.name,
      role: 'owner',
      id: profile.id,
      notes: profile.notes || '',
      browserType: 'orbita',
      lockEnabled: !!fingerprint.storage?.lockSession,
      timezone: {
        id: fingerprint.timezone || 'UTC',
      },
      navigator: {
        userAgent: fingerprint.userAgent || profile.userAgent,
        resolution: `${width}x${height}`,
        language: fingerprint.languages?.[0] || 'en-US',
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints: this.getMaxTouchPoints(fingerprint),
      },
      geolocation: fingerprint.geolocation || {},
      debugMode: true,
      canBeRunning: true,
      isRunning: this.isProfileRunning(profile.id),
      proxy: proxy ? {
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        username: proxy.username || '',
        password: proxy.password || '',
        status: proxy.status,
        geo: proxy.geo || {},
      } : {},
      proxyType: proxy?.protocol || '',
      proxyRegion: proxy?.geo?.countryCode || profile.locationCountryCode || '',
      createdAt: new Date(profile.createdAt).toISOString(),
      updatedAt: now,
      lastActivity: now,
      userChromeExtensions: profile.extensionPaths || [],
      remoteOrbitaUrl: remote?.versionUrl || '',
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
      host: proxy?.host || '',
      port: proxy?.port || 0,
      status: 'running',
      folders: profile.folderName ? [profile.folderName] : [],
      sharedEmails: [],
      shareId: '',
      chromeExtensions: profile.extensionPaths || [],
      tags: [],
      proxyEnabled: !!proxy,
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
      order: 0,
      startupUrl,
      consistency: {
        languageMatchesTimezone: Array.isArray(fingerprint.languages) && fingerprint.languages.length > 0 && !!fingerprint.timezone,
        proxyGeoApplied: !proxy || !!proxy.geo,
        nativeOrbitaPreferencesWritten: true,
      },
    });
  }

  private writeFingerprintSnapshot(profile: Profile, profileDir: string) {
    const fingerprint = profile.fingerprint;
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const pluginsEnabled = fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== 'off';

    this.writeJsonFile(path.join(profileDir, 'kct-fingerprint.json'), {
      navigator: {
        userAgent: fingerprint.userAgent || profile.userAgent,
        resolution: `${width}x${height}`,
        language: fingerprint.languages?.[0] || 'en-US',
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints: this.getMaxTouchPoints(fingerprint),
      },
      plugins: {
        enableVulnerable: pluginsEnabled,
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
    });
  }

  private async openProfileBrowser(profile: Profile, url: string, profileDir: string, options: { remoteDebuggingPort?: number } = {}) {
    fs.mkdirSync(profileDir, { recursive: true });
    this.stopProcessesUsingProfileDir(profileDir);
    cleanupBrowserLock(profileDir);
    this.removePath(path.join(profileDir, 'kct_proxy_auth_extension'));
    this.cleanupProfilePreferences(profileDir);
    this.cleanupVolatileProfileState(profileDir);

    const browser = this.getBrowserExecutable();
    const proxy = await this.resolveProxy(profile);
    if (browser.name === 'Orbita') {
      await this.writeOrbitaPreferences(profile, profileDir, url, proxy);
    }

    const fingerprint = profile.fingerprint;
    const languages = fingerprint.languages?.length ? fingerprint.languages : ['en-US', 'en'];
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const args: string[] = [
      `--user-data-dir=${profileDir}`,
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
      proxy ? '--webrtc-ip-handling-policy=default_public_interface_only' : '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    ];

    if (browser.name !== 'Orbita') {
      args.push(
        '--new-window',
        `--user-agent=${fingerprint.userAgent || profile.userAgent}`,
        `--window-size=${width},${height}`,
      );
    }

    if (options.remoteDebuggingPort) {
      args.push(`--remote-debugging-address=127.0.0.1`);
      args.push(`--remote-debugging-port=${options.remoteDebuggingPort}`);
    }

    args.push(`--lang=${languages[0]}`);
    const extensionPaths = fingerprint.storage?.allowInstallExtensions !== false ? this.getProfileExtensionPaths(profile) : [];

    if (proxy?.status === 'alive') {
      args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);
      if (browser.name !== 'Orbita' && proxy.username && proxy.password) {
        const extensionDir = path.join(profileDir, 'kct_proxy_auth_extension');
        fs.mkdirSync(extensionDir, { recursive: true });
        fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({
          manifest_version: 3,
          name: 'KCT Proxy Auth',
          version: '1.0.0',
          permissions: ['webRequest', 'webRequestAuthProvider'],
          host_permissions: ['<all_urls>'],
          background: { service_worker: 'background.js' },
        }, null, 2));
        fs.writeFileSync(path.join(extensionDir, 'background.js'), `
chrome.webRequest.onAuthRequired.addListener(
  () => ({ authCredentials: { username: ${JSON.stringify(proxy.username)}, password: ${JSON.stringify(proxy.password)} } }),
  { urls: ['<all_urls>'] },
  ['blocking']
);
`);
        args.push(`--load-extension=${extensionDir}`);
      }
    } else if (browser.name !== 'Orbita' && profile.proxy?.server) {
      args.push(`--proxy-server=${profile.proxy.server}`);
    }

    if (extensionPaths.length) {
      const existingLoadExtension = args.findIndex((arg) => arg.startsWith('--load-extension='));
      if (existingLoadExtension >= 0) {
        args[existingLoadExtension] = `${args[existingLoadExtension]},${extensionPaths.join(',')}`;
      } else {
        args.push(`--load-extension=${extensionPaths.join(',')}`);
      }
    }

    if (browser.name === 'Orbita') {
      args.push('--donut-pie=undefined');
      args.push('--component-updater=fast-update,initial-delay=0.1');
      args.push('--disable-features=PrintCompositorLPAC');
      args.push('--disable-quic');
      args.push('--font-masking-mode=1');
      args.push('--disable-encryption');
      args.push(`--window-size=${width},${height}`);
    }

    const customLaunchArgs = Array.isArray(profile.launchArgs) ? profile.launchArgs : [];
    for (const customArg of customLaunchArgs) {
      const arg = customArg.trim();
      if (!arg || arg === url || arg.startsWith('--user-data-dir=') || arg.startsWith('--profile-directory=')) continue;
      args.push(arg);
    }

    args.push(url);
    this.writeJsonFile(path.join(profileDir, 'kct-last-launch.json'), {
      profileId: profile.id,
      launchedAt: new Date().toISOString(),
      browser,
      args: args.map((arg) => arg.replace(/\/\/([^:@/]+):([^@/]+)@/g, '//***:***@')),
      proxy: proxy ? {
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        hasAuth: !!(proxy.username && proxy.password),
        geo: proxy.geo || null,
      } : null,
      remoteDebugging: options.remoteDebuggingPort ? {
        host: '127.0.0.1',
        port: options.remoteDebuggingPort,
        versionUrl: `http://127.0.0.1:${options.remoteDebuggingPort}/json/version`,
      } : null,
      extensions: extensionPaths,
    });

    const child = spawn(browser.executable, args, {
      detached: true,
      stdio: 'ignore',
      cwd: browser.cwd,
    });
    this.activeProcesses.set(profile.id, child);
    if (options.remoteDebuggingPort) {
      this.remoteSessions.set(profile.id, {
        profileId: profile.id,
        port: options.remoteDebuggingPort,
        startedAt: new Date().toISOString(),
        url,
      });
    }
    this.writeBrowserProfileSnapshot(profile, profileDir, url, proxy);
    this.writeFingerprintSnapshot(profile, profileDir);
    child.on('exit', () => {
      this.activeProcesses.delete(profile.id);
      this.remoteSessions.delete(profile.id);
    });
    child.unref();
  }

  async launchProfile(profile: Profile, options: { mode?: 'login' | 'visible' | 'remote'; url?: string; remoteDebuggingPort?: number } = {}) {
    const profileDir = path.join(this.dataDir, profile.id);
    const current = this.activeProcesses.get(profile.id);
    if (current && current.exitCode === null && !current.killed) {
      this.focusProfile(profile.id);
      return { focused: true };
    }
    if (this.getProcessesUsingProfileDir(profileDir).length) {
      this.focusProfile(profile.id);
      return { focused: true };
    }

    const fingerprint = normalizeFingerprint({
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      fingerprint: profile.fingerprint,
    });
    const normalizedProfile: Profile = {
      ...profile,
      userAgent: fingerprint.userAgent,
      viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
      fingerprint,
    };
    const url = this.resolveStartupUrl(profile, options.url);
    await this.openProfileBrowser(normalizedProfile, url, profileDir, { remoteDebuggingPort: options.remoteDebuggingPort });
    return { launched: true };
  }

  async stopProfile(profileId: string) {
    const child = this.activeProcesses.get(profileId);
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    const profileDir = path.join(this.dataDir, profileId);
    for (const pid of this.getProcessesUsingProfileDir(profileDir)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    this.activeProcesses.delete(profileId);
    this.remoteSessions.delete(profileId);
  }

  async repairProfile(profileId: string) {
    const profileDir = path.join(this.dataDir, profileId);
    fs.mkdirSync(profileDir, { recursive: true });
    await this.stopProfile(profileId).catch(() => {});
    this.stopProcessesUsingProfileDir(profileDir);
    cleanupBrowserLock(profileDir);
    this.removePath(path.join(profileDir, 'kct_proxy_auth_extension'));
    this.cleanupProfilePreferences(profileDir);
    this.cleanupVolatileProfileState(profileDir);
    return {
      success: true,
      profileDir,
      repairedAt: new Date().toISOString(),
    };
  }

  isProfileRunning(profileId: string) {
    const child = this.activeProcesses.get(profileId);
    if (child && child.exitCode === null && !child.killed) return true;
    const profileDir = path.join(this.dataDir, profileId);
    return this.getProcessesUsingProfileDir(profileDir).length > 0;
  }

  getActiveContext(profileId: string) {
    return this.activeProcesses.get(profileId);
  }

  getRemoteSessions() {
    return Array.from(this.remoteSessions.values()).map((session) => ({
      ...session,
      versionUrl: `http://127.0.0.1:${session.port}/json/version`,
      tabsUrl: `http://127.0.0.1:${session.port}/json/list`,
    }));
  }

  getRemoteSession(profileId: string) {
    return this.getRemoteSessions().find((session) => session.profileId === profileId) || null;
  }
}

export const browserService = new BrowserService();
