// server/index.ts
import cors from "cors";
import express from "express";
import fs7 from "fs";
import net2 from "net";
import os2 from "os";
import path7 from "path";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { removeWatermarkFromBuffer } from "@pilio/gemini-watermark-remover/node";
import multer from "multer";
import sharp from "sharp";

// server/apiTokens.ts
import crypto from "crypto";

// server/jsonStore.ts
import fs2 from "fs";
import path2 from "path";

// server/dataDir.ts
import fs from "fs";
import os from "os";
import path from "path";
var resolvedDataDir = null;
var migrationResult = null;
function appSupportDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "KCTLogin");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "KCTLogin");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "KCTLogin");
}
function hasRuntimeFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => name !== ".keep" && name !== ".DS_Store");
}
function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function mergeJsonArrayById(sourceFile, targetFile) {
  const source = readJsonFile(sourceFile, []);
  if (!Array.isArray(source) || !source.length) return 0;
  const target = readJsonFile(targetFile, []);
  if (!Array.isArray(target) || !target.length) {
    writeJsonFile(targetFile, source);
    return source.length;
  }
  const existingIds = new Set(target.map((item) => item?.id).filter(Boolean));
  const missing = source.filter((item) => item?.id && !existingIds.has(item.id));
  if (!missing.length) return 0;
  writeJsonFile(targetFile, [...target, ...missing]);
  return missing.length;
}
function copyMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return 0;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return 1;
}
function mergeMissingTree(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return 0;
  let copied = 0;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of fs.readdirSync(sourceDir)) {
    if (name === ".keep" || name === ".DS_Store") continue;
    copied += copyMissing(path.join(sourceDir, name), path.join(targetDir, name));
  }
  return copied;
}
function mergeLegacyData(legacyDir, dataDir2) {
  let merged = 0;
  for (const fileName of ["profiles.json", "proxies.json", "api_tokens.json", "proxy_devices.json"]) {
    merged += mergeJsonArrayById(path.join(legacyDir, fileName), path.join(dataDir2, fileName));
  }
  for (const name of fs.readdirSync(legacyDir)) {
    if (name === ".keep" || name === ".DS_Store") continue;
    const source = path.join(legacyDir, name);
    const target = path.join(dataDir2, name);
    if (["profiles.json", "proxies.json", "api_tokens.json", "proxy_devices.json", "profiles_export.json"].includes(name)) continue;
    if (fs.statSync(source).isDirectory()) {
      merged += mergeMissingTree(source, target);
    } else {
      merged += copyMissing(source, target);
    }
  }
  return merged;
}
function getLegacySourceDataDir() {
  return path.join(process.cwd(), "server", "data");
}
function getDefaultDataDir() {
  return path.join(appSupportDir(), "server-data");
}
function getDataDir() {
  if (!resolvedDataDir) {
    resolvedDataDir = process.env.KCT_DATA_DIR || getDefaultDataDir();
    migrateLegacyDataIfNeeded();
  }
  return resolvedDataDir;
}
function getProfilesDataDir() {
  return path.join(getDataDir(), "profiles_data");
}
function migrateLegacyDataIfNeeded() {
  const dataDir2 = resolvedDataDir || process.env.KCT_DATA_DIR || getDefaultDataDir();
  const legacyDir = getLegacySourceDataDir();
  if (migrationResult) return migrationResult;
  if (path.resolve(dataDir2) === path.resolve(legacyDir)) {
    migrationResult = { legacyDir, dataDir: dataDir2, migrated: false, reason: "data-dir-is-legacy-dir" };
    return migrationResult;
  }
  const legacyHasData = hasRuntimeFiles(legacyDir);
  const targetHasData = hasRuntimeFiles(dataDir2);
  if (!legacyHasData) {
    fs.mkdirSync(dataDir2, { recursive: true });
    migrationResult = { legacyDir, dataDir: dataDir2, migrated: false, reason: "legacy-empty" };
    return migrationResult;
  }
  if (targetHasData) {
    const mergedCount = mergeLegacyData(legacyDir, dataDir2);
    migrationResult = {
      legacyDir,
      dataDir: dataDir2,
      migrated: mergedCount > 0,
      reason: mergedCount > 0 ? `merged-${mergedCount}-legacy-items` : "target-already-has-data"
    };
    return migrationResult;
  }
  fs.mkdirSync(path.dirname(dataDir2), { recursive: true });
  fs.cpSync(legacyDir, dataDir2, { recursive: true });
  fs.writeFileSync(path.join(dataDir2, "migration.json"), JSON.stringify({
    migratedAt: (/* @__PURE__ */ new Date()).toISOString(),
    from: legacyDir,
    to: dataDir2
  }, null, 2));
  migrationResult = { legacyDir, dataDir: dataDir2, migrated: true, reason: "copied-legacy-source-data" };
  return migrationResult;
}
function getDataDirInfo() {
  const dataDir2 = getDataDir();
  return {
    dataDir: dataDir2,
    profilesDataDir: getProfilesDataDir(),
    legacySourceDataDir: getLegacySourceDataDir(),
    migration: migrationResult || migrateLegacyDataIfNeeded()
  };
}

// server/jsonStore.ts
function ensureDataDir() {
  const dataDir2 = getDataDir();
  if (!fs2.existsSync(dataDir2)) fs2.mkdirSync(dataDir2, { recursive: true });
}
function readJson(name, fallback) {
  ensureDataDir();
  const file = path2.join(getDataDir(), name);
  if (!fs2.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs2.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(name, value) {
  ensureDataDir();
  const file = path2.join(getDataDir(), name);
  fs2.writeFileSync(file, JSON.stringify(value ?? null, null, 2));
}

// server/apiTokens.ts
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
var ApiTokenService = class {
  tokens = [];
  constructor() {
    this.tokens = readJson("api_tokens.json", []);
  }
  save() {
    writeJson("api_tokens.json", this.tokens);
  }
  list() {
    return this.tokens.map(({ tokenHash: _tokenHash, ...token }) => token);
  }
  create(name = "API token") {
    const rawToken = `kct_${crypto.randomBytes(24).toString("hex")}`;
    const record = {
      id: Math.random().toString(36).slice(2, 11),
      name,
      tokenHash: hashToken(rawToken),
      createdAt: Date.now()
    };
    this.tokens.unshift(record);
    this.save();
    return {
      ...record,
      tokenHash: void 0,
      token: rawToken
    };
  }
  delete(id) {
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((token) => token.id !== id);
    this.save();
    return this.tokens.length !== before;
  }
  verify(rawToken) {
    if (!rawToken) return false;
    const token = rawToken.replace(/^Bearer\s+/i, "").trim();
    const tokenHash = hashToken(token);
    const found = this.tokens.find((item) => item.tokenHash === tokenHash);
    if (!found) return false;
    found.lastUsedAt = Date.now();
    this.save();
    return true;
  }
};
var apiTokenService = new ApiTokenService();

// server/browser.ts
import { spawn, spawnSync } from "child_process";
import crypto2 from "crypto";
import fs5 from "fs";
import path5 from "path";

// server/proxyService.ts
import { chromium } from "playwright";
import axios from "axios";
var ProxyParser = class {
  static parse(input) {
    const lines = input.split(/[\n,;]/).map((line) => line.trim()).filter(Boolean);
    const results = [];
    for (const line of lines) {
      try {
        if (line.includes("://")) {
          const url = new URL(line);
          results.push({
            protocol: url.protocol.replace(":", ""),
            host: url.hostname,
            port: Number(url.port),
            username: url.username || void 0,
            password: url.password || void 0
          });
          continue;
        }
        const parts = line.split(":");
        if (parts.length === 2 || parts.length === 4) {
          results.push({
            protocol: "http",
            host: parts[0],
            port: Number(parts[1]),
            username: parts[2] || void 0,
            password: parts[3] || void 0
          });
        }
      } catch (error) {
        console.warn("[ProxyParser] Skip proxy:", line, error);
      }
    }
    return results;
  }
};
var ProxyService = class {
  proxies = [];
  constructor() {
    this.proxies = readJson("proxies.json", []);
  }
  save() {
    writeJson("proxies.json", this.proxies);
  }
  getAll() {
    return [...this.proxies].sort((a, b) => (b.createdAt || b.lastChecked || 0) - (a.createdAt || a.lastChecked || 0));
  }
  getById(id) {
    return this.proxies.find((proxy) => proxy.id === id);
  }
  addProxies(input, group = "Imported") {
    const added = [];
    for (const parsed of ProxyParser.parse(input)) {
      if (!parsed.host || !parsed.port || Number.isNaN(parsed.port)) continue;
      const proxy = {
        id: Math.random().toString(36).slice(2, 9),
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        protocol: parsed.protocol || "http",
        status: "unknown",
        createdAt: Date.now(),
        group
      };
      this.proxies.unshift(proxy);
      added.push(proxy);
    }
    this.save();
    return added;
  }
  updateProxy(id, updates) {
    const index = this.proxies.findIndex((proxy) => proxy.id === id);
    if (index === -1) return null;
    this.proxies[index] = { ...this.proxies[index], ...updates };
    this.save();
    return this.proxies[index];
  }
  deleteProxy(id) {
    this.proxies = this.proxies.filter((proxy) => proxy.id !== id);
    this.save();
  }
  async probeProxy(proxy) {
    let browser = null;
    const startedAt = Date.now();
    try {
      let geo;
      if (proxy.protocol === "http" || proxy.protocol === "https") {
        const response = await axios.get("http://ip-api.com/json", {
          timeout: 2e4,
          proxy: {
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username && proxy.password ? {
              username: proxy.username,
              password: proxy.password
            } : void 0
          }
        });
        geo = response.data;
      } else {
        browser = await chromium.launch({
          headless: true,
          proxy: {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password
          }
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("http://ip-api.com/json", { waitUntil: "domcontentloaded", timeout: 2e4 });
        geo = JSON.parse(await page.textContent("body") || "{}");
      }
      if (geo.status !== "success") throw new Error(geo.message || "IP API failed");
      return {
        ...proxy,
        status: "alive",
        latency: Date.now() - startedAt,
        lastChecked: Date.now(),
        geo: {
          ip: geo.query,
          country: geo.country,
          countryCode: geo.countryCode,
          city: geo.city,
          timezone: geo.timezone,
          isp: geo.isp,
          latitude: typeof geo.lat === "number" ? geo.lat : void 0,
          longitude: typeof geo.lon === "number" ? geo.lon : void 0
        }
      };
    } catch (error) {
      console.warn(`[ProxyService] Check failed for ${proxy.host}:${proxy.port}: ${error.message}`);
      return {
        ...proxy,
        status: "dead",
        latency: -1,
        lastChecked: Date.now()
      };
    } finally {
      await browser?.close().catch(() => {
      });
    }
  }
  parseCustomProxy(server, username, password) {
    const parsed = ProxyParser.parse(server)[0];
    if (!parsed?.host || !parsed.port || Number.isNaN(parsed.port)) return null;
    return {
      id: "custom",
      host: parsed.host,
      port: parsed.port,
      username: parsed.username || username,
      password: parsed.password || password,
      protocol: parsed.protocol || "http",
      status: "unknown",
      group: "Custom"
    };
  }
  async checkCustomProxy(server, username, password) {
    const proxy = this.parseCustomProxy(server, username, password);
    if (!proxy) throw new Error("Custom proxy kh\xF4ng h\u1EE3p l\u1EC7");
    return this.probeProxy(proxy);
  }
  async checkTarget(proxy, target = "https://accounts.google.com") {
    const startedAt = Date.now();
    let browser = null;
    try {
      if (proxy.protocol === "http" || proxy.protocol === "https") {
        const response2 = await axios.get(target, {
          timeout: 2e4,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 500,
          proxy: {
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username && proxy.password ? {
              username: proxy.username,
              password: proxy.password
            } : void 0
          }
        });
        return {
          ok: true,
          target,
          status: response2.status,
          latency: Date.now() - startedAt,
          finalUrl: response2.request?.res?.responseUrl || target
        };
      }
      browser = await chromium.launch({
        headless: true,
        proxy: {
          server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
          username: proxy.username,
          password: proxy.password
        }
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 2e4 });
      return {
        ok: !!response && response.status() < 500,
        target,
        status: response?.status() || 0,
        latency: Date.now() - startedAt,
        finalUrl: page.url()
      };
    } catch (error) {
      return {
        ok: false,
        target,
        status: 0,
        latency: Date.now() - startedAt,
        error: error.message
      };
    } finally {
      await browser?.close().catch(() => {
      });
    }
  }
  async checkProxy(id) {
    const proxy = this.getById(id);
    if (!proxy) throw new Error("Proxy not found");
    this.updateProxy(id, { status: "checking" });
    const checked = await this.probeProxy(proxy);
    return this.updateProxy(id, checked);
  }
  async checkBatch(ids, concurrency = 3) {
    const results = [];
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        if (!id) continue;
        const result = await this.checkProxy(id).catch(() => null);
        if (result) results.push(result);
      }
    });
    await Promise.all(workers);
    return results;
  }
  async fetchFreeProxies() {
    const sources = [
      "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
      "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt"
    ];
    let input = "";
    for (const source of sources) {
      try {
        const response = await axios.get(source, { timeout: 1e4 });
        input += `${response.data}
`;
      } catch {
        console.warn(`[ProxyService] Fetch failed: ${source}`);
      }
    }
    const lines = input.split("\n").filter(Boolean).slice(0, 100);
    return this.addProxies(lines.join("\n"), "Free Scraped");
  }
};
var proxyService = new ProxyService();

// server/utils/browserCleanup.ts
import path3 from "path";
import fs3 from "fs";
function cleanupBrowserLock(profileDir) {
  const lockFiles = [
    "SingletonLock",
    // Linux/Mac
    "SingletonCookie",
    "SingletonSocket",
    "parent.lock",
    // Firefox
    "lock"
    // General
  ];
  const subDirs = ["", "browser_data", "Default"];
  for (const subDir of subDirs) {
    const targetDir = path3.join(profileDir, subDir);
    if (!fs3.existsSync(targetDir)) continue;
    for (const file of lockFiles) {
      const lockPath = path3.join(targetDir, file);
      try {
        fs3.lstatSync(lockPath);
      } catch {
        continue;
      }
      try {
        console.log(`[Cleanup] Dang xoa file lock: ${lockPath}`);
        fs3.unlinkSync(lockPath);
      } catch (e) {
        console.warn(`[Cleanup] Khong the xoa file lock ${file} tai ${subDir || "root"}: ${e.message}`);
      }
    }
  }
  const removeNestedLocks = (dir, depth = 0) => {
    if (depth > 5 || !fs3.existsSync(dir)) return;
    let entries;
    try {
      entries = fs3.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path3.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeNestedLocks(entryPath, depth + 1);
      } else if (entry.name === "LOCK") {
        try {
          console.log(`[Cleanup] Dang xoa file lock: ${entryPath}`);
          fs3.unlinkSync(entryPath);
        } catch (e) {
          console.warn(`[Cleanup] Khong the xoa file lock ${entryPath}: ${e.message}`);
        }
      }
    }
  };
  removeNestedLocks(profileDir);
}

// server/utils/fingerprint.ts
import fs4 from "fs";
import path4 from "path";
var FONT_LISTS = {
  windows: ["Arial", "Calibri", "Cambria", "Candara", "Consolas", "Courier New", "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"],
  mac: ["Arial", "Helvetica", "Helvetica Neue", "Times", "Courier", "Geneva", "Georgia", "Palatino", "Monaco", "Menlo", "San Francisco"],
  android: ["Roboto", "Noto Sans", "Droid Sans", "Google Sans", "Arial", "sans-serif"]
};
var DEVICE_TEMPLATES = {
  windows: [
    {
      gpu: { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      screen: { width: 1920, height: 1080, scale: 1 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      screen: { width: 1366, height: 768, scale: 1 },
      hardware: { concurrency: 4, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      screen: { width: 1536, height: 864, scale: 1 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 2, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
      screen: { width: 2560, height: 1440, scale: 1 },
      hardware: { concurrency: 12, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    }
  ],
  mac: [
    {
      gpu: { vendor: "Apple Inc.", renderer: "Apple M1" },
      screen: { width: 1440, height: 900, scale: 2 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Apple Inc.", renderer: "Apple M2" },
      screen: { width: 1470, height: 956, scale: 2 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Apple Inc.", renderer: "Apple M1 Pro" },
      screen: { width: 1728, height: 1117, scale: 2 },
      hardware: { concurrency: 10, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon Pro 560X OpenGL Engine" },
      screen: { width: 1680, height: 1050, scale: 2 },
      hardware: { concurrency: 8, memory: 16 },
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 }
    }
  ],
  android: [
    {
      gpu: { vendor: "Qualcomm", renderer: "Adreno (TM) 740" },
      screen: { width: 393, height: 873, scale: 2.75 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "Qualcomm", renderer: "Adreno (TM) 730" },
      screen: { width: 412, height: 915, scale: 2.625 },
      hardware: { concurrency: 8, memory: 8 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
    },
    {
      gpu: { vendor: "ARM", renderer: "Mali-G78" },
      screen: { width: 360, height: 800, scale: 3 },
      hardware: { concurrency: 8, memory: 4 },
      mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
    }
  ]
};
var TABLET_TEMPLATES = [
  {
    gpu: { vendor: "Qualcomm", renderer: "Adreno (TM) 740" },
    screen: { width: 800, height: 1280, scale: 2 },
    hardware: { concurrency: 8, memory: 8 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
  },
  {
    gpu: { vendor: "ARM", renderer: "Mali-G715" },
    screen: { width: 820, height: 1180, scale: 2 },
    hardware: { concurrency: 8, memory: 8 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
  },
  {
    gpu: { vendor: "Qualcomm", renderer: "Adreno (TM) 730" },
    screen: { width: 962, height: 1440, scale: 2 },
    hardware: { concurrency: 8, memory: 12 },
    mediaDevices: { videoInput: 2, audioInput: 1, audioOutput: 1 }
  }
];
var pick = (items) => items[Math.floor(Math.random() * items.length)];
var getBundledOrbitaChromeVersion = () => {
  const infoPlist = path4.join(process.cwd(), "vendor", "orbita-browser-146", "Orbita-Browser.app", "Contents", "Info.plist");
  if (fs4.existsSync(infoPlist)) {
    const content = fs4.readFileSync(infoPlist, "utf8");
    const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    if (match?.[1]) return match[1];
  }
  return "146.0.7680.165";
};
var buildChromeVersion = () => {
  return getBundledOrbitaChromeVersion();
};
var buildUserAgent = (os3, chromeVersion, deviceCategory) => {
  if (os3 === "windows") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  if (os3 === "android") {
    if (deviceCategory === "tablet") {
      return `Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    }
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
};
var getPlatform = (os3) => {
  if (os3 === "windows") return "Win32";
  if (os3 === "android") return "Linux armv8l";
  return "MacIntel";
};
var inferOS = (platform = "", userAgent = "") => {
  if (/Android|Mobile/i.test(userAgent) || /Linux arm/i.test(platform)) return "android";
  if (platform === "Win32" || /Windows/i.test(userAgent)) return "windows";
  return "mac";
};
var getDeviceCategoryForOS = (os3, requested) => {
  if (requested) {
    if (requested === "desktop") return os3 === "android" ? "mobile" : "desktop";
    if (requested === "mobile" || requested === "tablet") return os3 === "android" ? requested : "desktop";
  }
  return os3 === "android" ? "mobile" : "desktop";
};
var inferDeviceCategory = (fingerprint) => {
  if (fingerprint.os !== "android") return "desktop";
  if (!/Mobile/i.test(fingerprint.userAgent || "")) return "tablet";
  return (fingerprint.screen?.width || 0) >= 768 ? "tablet" : "mobile";
};
var getTemplateFor = (os3, deviceCategory) => {
  if (os3 === "android" && deviceCategory === "tablet") return pick(TABLET_TEMPLATES);
  return pick(DEVICE_TEMPLATES[os3]);
};
var generateRandomFingerprint = (os3, seed, deviceCategory) => {
  void seed;
  const finalOS = os3 || (deviceCategory === "desktop" ? pick(["windows", "mac"]) : "android");
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
      deviceScaleFactor: template.screen.scale
    },
    webgl: { ...template.gpu, mode: "noise" },
    hardware: template.hardware,
    maxTouchPoints: finalOS === "android" ? 5 : 0,
    languages: ["vi-VN", "vi", "en-US", "en"],
    timezone: "Asia/Ho_Chi_Minh",
    canvasSeed: Math.random(),
    canvasMode: "noise",
    audioSeed: Math.random(),
    audioMode: "noise",
    fonts: FONT_LISTS[finalOS],
    mediaDevices: template.mediaDevices,
    webRtcMode: "basedOnIp",
    fontsMode: "masked",
    pluginsMode: "masked",
    startUrlMode: "previousTabs",
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
      systemExtensions: false
    }
  };
};
var getGeoFingerprintUpdates = (countryCode) => {
  const mapping = {
    VN: { timezone: "Asia/Ho_Chi_Minh", languages: ["vi-VN", "vi", "en-US", "en"] },
    US: { timezone: "America/New_York", languages: ["en-US", "en"] },
    GB: { timezone: "Europe/London", languages: ["en-GB", "en"] },
    CA: { timezone: "America/Toronto", languages: ["en-CA", "en-US", "en"] },
    AU: { timezone: "Australia/Sydney", languages: ["en-AU", "en"] },
    DE: { timezone: "Europe/Berlin", languages: ["de-DE", "de", "en-US", "en"] },
    FR: { timezone: "Europe/Paris", languages: ["fr-FR", "fr", "en-US", "en"] },
    JP: { timezone: "Asia/Tokyo", languages: ["ja-JP", "ja", "en-US", "en"] },
    KR: { timezone: "Asia/Seoul", languages: ["ko-KR", "ko", "en-US", "en"] },
    TH: { timezone: "Asia/Bangkok", languages: ["th-TH", "th", "en-US", "en"] },
    RU: { timezone: "Europe/Moscow", languages: ["ru-RU", "ru", "en-US", "en"] },
    SG: { timezone: "Asia/Singapore", languages: ["en-SG", "en-US", "en"] },
    ID: { timezone: "Asia/Jakarta", languages: ["id-ID", "id", "en-US", "en"] },
    PH: { timezone: "Asia/Manila", languages: ["en-PH", "en-US", "en"] },
    MY: { timezone: "Asia/Kuala_Lumpur", languages: ["ms-MY", "ms", "en-US", "en"] },
    IN: { timezone: "Asia/Kolkata", languages: ["en-IN", "hi-IN", "en"] }
  };
  return mapping[countryCode.toUpperCase()] || {
    timezone: "UTC",
    languages: ["en-US", "en"]
  };
};
var applyGeoToFingerprint = (fingerprint, geo) => {
  if (!geo?.countryCode && !geo?.timezone) return fingerprint;
  const updates = geo.countryCode ? getGeoFingerprintUpdates(geo.countryCode) : void 0;
  return {
    ...fingerprint,
    languages: updates?.languages || fingerprint.languages,
    timezone: geo.timezone || updates?.timezone || fingerprint.timezone,
    geolocation: typeof geo.latitude === "number" && typeof geo.longitude === "number" ? { latitude: geo.latitude, longitude: geo.longitude, accuracy: 50 } : fingerprint.geolocation
  };
};
var hasWindowsWebgl = (renderer = "") => /Direct3D|D3D11|NVIDIA|Intel\(R\)|Radeon/i.test(renderer);
var hasMacWebgl = (renderer = "") => /Apple|OpenGL Engine|Radeon Pro/i.test(renderer) && !/Direct3D|D3D11/i.test(renderer);
var hasAndroidWebgl = (renderer = "") => /Adreno|Mali|PowerVR|ANGLE \(Qualcomm|ANGLE \(ARM/i.test(renderer) && !/Direct3D|D3D11/i.test(renderer);
var getAvailHeight = (os3, height) => Math.max(1, height - (os3 === "windows" ? 40 : os3 === "mac" ? 25 : 0));
var repairFingerprintConsistency = (fingerprint) => {
  const os3 = fingerprint.os || inferOS(fingerprint.platform, fingerprint.userAgent);
  const deviceCategory = fingerprint.deviceCategory || inferDeviceCategory({
    os: os3,
    userAgent: fingerprint.userAgent,
    screen: fingerprint.screen
  });
  const template = getTemplateFor(os3, getDeviceCategoryForOS(os3, deviceCategory));
  const chromeVersion = getBundledOrbitaChromeVersion();
  const finalDeviceCategory = getDeviceCategoryForOS(os3, deviceCategory);
  const userAgent = buildUserAgent(os3, chromeVersion, finalDeviceCategory);
  const renderer = fingerprint.webgl?.renderer || "";
  const webglLooksRight = os3 === "windows" ? hasWindowsWebgl(renderer) && !/OpenGL/i.test(renderer) : os3 === "android" ? hasAndroidWebgl(renderer) : hasMacWebgl(renderer);
  const hardwareConcurrency = Math.min(16, Math.max(2, fingerprint.hardware?.concurrency || template.hardware.concurrency));
  const deviceMemory = [2, 4, 8, 16].includes(fingerprint.hardware?.memory) ? fingerprint.hardware.memory : template.hardware.memory;
  const width = fingerprint.screen?.width || template.screen.width;
  const height = fingerprint.screen?.height || template.screen.height;
  return {
    ...fingerprint,
    userAgent,
    platform: getPlatform(os3),
    os: os3,
    deviceCategory: finalDeviceCategory,
    chromeVersion,
    screen: {
      ...fingerprint.screen,
      width,
      height,
      colorDepth: fingerprint.screen?.colorDepth || 24,
      availWidth: width,
      availHeight: getAvailHeight(os3, height),
      deviceScaleFactor: os3 === "windows" ? 1 : fingerprint.screen?.deviceScaleFactor || template.screen.scale
    },
    webgl: {
      ...webglLooksRight ? fingerprint.webgl : template.gpu,
      mode: fingerprint.webgl?.mode || "noise"
    },
    hardware: {
      concurrency: hardwareConcurrency,
      memory: deviceMemory
    },
    maxTouchPoints: os3 === "android" ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0,
    fonts: fingerprint.fonts?.some((font) => FONT_LISTS[os3].includes(font)) ? fingerprint.fonts : FONT_LISTS[os3],
    mediaDevices: fingerprint.mediaDevices || template.mediaDevices,
    pluginsMode: fingerprint.pluginsMode === "real" ? "masked" : fingerprint.pluginsMode || "masked"
  };
};
var normalizeFingerprint = (settings) => {
  const fallbackOS = inferOS(settings.platform, settings.userAgent);
  const fallbackChromeVersion = settings.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || getBundledOrbitaChromeVersion();
  const base = settings.fingerprint;
  if (!base) {
    return repairFingerprintConsistency({
      userAgent: settings.userAgent,
      platform: settings.platform || getPlatform(fallbackOS),
      os: fallbackOS,
      deviceCategory: settings.deviceCategory || (fallbackOS === "android" ? "mobile" : "desktop"),
      chromeVersion: fallbackChromeVersion,
      screen: {
        width: settings.viewport.width,
        height: settings.viewport.height,
        colorDepth: 24,
        availWidth: settings.viewport.width,
        availHeight: settings.viewport.height,
        deviceScaleFactor: 1
      },
      webgl: {
        vendor: fallbackOS === "mac" ? "Apple Inc." : "Google Inc. (NVIDIA)",
        renderer: fallbackOS === "mac" ? "Apple M1" : "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, OpenGL 4.1)",
        mode: settings.webgl === false ? "off" : "noise"
      },
      hardware: {
        concurrency: settings.hardwareConcurrency || 8,
        memory: settings.deviceMemory || 8
      },
      maxTouchPoints: fallbackOS === "android" ? 5 : 0,
      languages: [settings.language || "en-US", (settings.language || "en-US").split("-")[0]],
      timezone: settings.timezone || "UTC",
      canvasSeed: 0.5,
      canvasMode: settings.canvas === false ? "off" : "noise",
      audioSeed: 0.5,
      audioMode: settings.audio === false ? "off" : "noise",
      fonts: FONT_LISTS[fallbackOS],
      mediaDevices: { videoInput: 1, audioInput: 1, audioOutput: 1 },
      webRtcMode: "basedOnIp",
      fontsMode: "masked",
      pluginsMode: "masked",
      startUrlMode: "previousTabs",
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
        systemExtensions: false
      }
    });
  }
  const os3 = base.os || inferOS(base.platform, base.userAgent);
  const chromeVersion = base.chromeVersion || base.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || fallbackChromeVersion;
  return repairFingerprintConsistency({
    ...base,
    os: os3,
    deviceCategory: base.deviceCategory || settings.deviceCategory || inferDeviceCategory({
      os: os3,
      userAgent: base.userAgent,
      screen: base.screen
    }),
    chromeVersion,
    screen: {
      ...base.screen,
      colorDepth: base.screen.colorDepth || 24,
      availWidth: base.screen.availWidth || base.screen.width,
      availHeight: base.screen.availHeight || base.screen.height,
      deviceScaleFactor: base.screen.deviceScaleFactor || 1
    },
    webgl: {
      ...base.webgl,
      mode: base.webgl.mode || "noise"
    },
    canvasMode: base.canvasMode || "noise",
    audioMode: base.audioMode || "noise",
    fonts: base.fonts?.length ? base.fonts : FONT_LISTS[os3],
    mediaDevices: base.mediaDevices || { videoInput: 1, audioInput: 1, audioOutput: 1 },
    webRtcMode: base.webRtcMode || "basedOnIp",
    fontsMode: base.fontsMode || "masked",
    pluginsMode: base.pluginsMode || "masked",
    startUrlMode: base.startUrlMode || "previousTabs",
    bookmarksCount: typeof base.bookmarksCount === "number" ? base.bookmarksCount : 0,
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
      systemExtensions: base.storage?.systemExtensions ?? false
    }
  });
};

// server/browser.ts
var BrowserService = class {
  activeProcesses = /* @__PURE__ */ new Map();
  remoteSessions = /* @__PURE__ */ new Map();
  dataDir = getProfilesDataDir();
  constructor() {
    if (!fs5.existsSync(this.dataDir)) fs5.mkdirSync(this.dataDir, { recursive: true });
  }
  getBrowserExecutable() {
    const resourcesPath = process.env.KCT_RESOURCES_PATH || process.cwd();
    const localOrbitaDir = fs5.existsSync(path5.join(process.cwd(), "vendor", "orbita-browser-146")) ? path5.join(process.cwd(), "vendor", "orbita-browser-146") : path5.join(resourcesPath, "vendor", "orbita-browser-146");
    const localOrbita = path5.join(localOrbitaDir, "Orbita-Browser.app", "Contents", "MacOS", "Orbita");
    if (fs5.existsSync(localOrbita)) return { executable: localOrbita, name: "Orbita", cwd: localOrbitaDir };
    throw new Error("Kh\xF4ng t\xECm th\u1EA5y Orbita bundled \u0111\u1EC3 m\u1EDF profile fingerprint. C\xE0i/\u0111\xF3ng g\xF3i vendor/orbita-browser-146 tr\u01B0\u1EDBc khi launch.");
  }
  getRuntimeInfo() {
    const browser = this.getBrowserExecutable();
    const resourcesPath = process.env.KCT_RESOURCES_PATH || process.cwd();
    const fontsDir = fs5.existsSync(path5.join(process.cwd(), "vendor", "fonts")) ? path5.join(process.cwd(), "vendor", "fonts") : path5.join(resourcesPath, "vendor", "fonts");
    return {
      browser,
      orbitaBundled: browser.name === "Orbita" && browser.executable.includes(path5.join("vendor", "orbita-browser-146")),
      fontsDir,
      fontsCount: fs5.existsSync(fontsDir) ? fs5.readdirSync(fontsDir).filter((name) => name.endsWith(".ttf")).length : 0,
      dataDir: this.dataDir,
      storage: getDataDirInfo()
    };
  }
  readJsonFile(file, fallback = {}) {
    if (!fs5.existsSync(file)) return fallback;
    try {
      return JSON.parse(fs5.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }
  writeJsonFile(file, value) {
    fs5.mkdirSync(path5.dirname(file), { recursive: true });
    fs5.writeFileSync(file, JSON.stringify(value, null, 2));
  }
  removePath(target) {
    try {
      fs5.lstatSync(target);
    } catch {
      return;
    }
    fs5.rmSync(target, { recursive: true, force: true });
  }
  stableId(input, length = 40) {
    return crypto2.createHash("sha1").update(input).digest("hex").slice(0, length);
  }
  stableFraction(input) {
    const raw = parseInt(this.stableId(input, 12), 16) / 281474976710655;
    return Number.isFinite(raw) && raw > 0 ? raw : 0.5;
  }
  isMobileFingerprint(fingerprint) {
    return fingerprint.os === "android";
  }
  getMaxTouchPoints(fingerprint) {
    return this.isMobileFingerprint(fingerprint) ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0;
  }
  cleanupExtensionPreferences(preferences) {
    const settings = preferences?.extensions?.settings;
    if (!settings || typeof settings !== "object") return;
    for (const [extensionId, value] of Object.entries(settings)) {
      const extensionPath = String(value?.path || "");
      const extensionName = String(value?.manifest?.name || "");
      const isKctProxyExtension = extensionPath.includes("kct_proxy_auth_extension") || extensionName === "KCT Proxy Auth";
      const isForeignComponentExtension = value?.location === 5 && (extensionPath.includes("/.gologin/browser/orbita-browser") || extensionPath.includes("/Applications/Google Chrome.app") || extensionPath.includes("/Applications/Chromium.app"));
      if (isKctProxyExtension || isForeignComponentExtension) {
        delete settings[extensionId];
        delete preferences.extensions?.commands?.[`mac:Alt+O`];
      }
    }
  }
  cleanupProfilePreferences(profileDir) {
    const preferencesPath = path5.join(profileDir, "Default", "Preferences");
    if (!fs5.existsSync(preferencesPath)) return;
    const preferences = this.readJsonFile(preferencesPath, {});
    this.cleanupExtensionPreferences(preferences);
    this.writeJsonFile(preferencesPath, preferences);
  }
  cleanupVolatileProfileState(profileDir) {
    const defaultDir = path5.join(profileDir, "Default");
    const removablePaths = [
      path5.join(profileDir, "BrowserMetrics"),
      path5.join(profileDir, "BrowserMetrics-spare.pma"),
      path5.join(profileDir, "ChromeFeatureState"),
      path5.join(profileDir, "Crashpad"),
      path5.join(profileDir, "DawnGraphiteCache"),
      path5.join(profileDir, "DawnWebGPUCache"),
      path5.join(profileDir, "GPUCache"),
      path5.join(profileDir, "GraphiteDawnCache"),
      path5.join(profileDir, "GrShaderCache"),
      path5.join(profileDir, "Network Persistent State"),
      path5.join(profileDir, "ShaderCache"),
      path5.join(profileDir, "segmentation_platform", "ukm_db"),
      path5.join(profileDir, "segmentation_platform", "ukm_db-shm"),
      path5.join(profileDir, "segmentation_platform", "ukm_db-wal"),
      path5.join(defaultDir, "DIPS"),
      path5.join(defaultDir, "DIPS-shm"),
      path5.join(defaultDir, "DIPS-wal"),
      path5.join(defaultDir, "LOCK"),
      path5.join(defaultDir, "Network Persistent State"),
      path5.join(defaultDir, "QuotaManager"),
      path5.join(defaultDir, "QuotaManager-journal"),
      path5.join(defaultDir, "Secure Preferences"),
      path5.join(defaultDir, "SharedStorage-shm"),
      path5.join(defaultDir, "SharedStorage-wal")
    ];
    for (const target of removablePaths) {
      this.removePath(target);
    }
  }
  languageHeader(languages) {
    return languages.map((language, index) => index === 0 ? language : `${language};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`).join(",");
  }
  async resolveProxy(profile) {
    const proxyId = profile.proxyId;
    let proxy = proxyId ? proxyService.getById(proxyId) : null;
    if (proxyId) {
      if (!proxy) throw new Error(`Proxy \u0111\xE3 ch\u1ECDn kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i: ${proxyId}`);
      if (proxy.status !== "alive") {
        const checkedProxy = await proxyService.checkProxy(proxyId).catch(() => proxyService.getById(proxyId));
        if (checkedProxy) proxy = checkedProxy;
      }
      if (!proxy || proxy.status !== "alive") {
        throw new Error(`Proxy ${proxy?.host || proxyId}:${proxy?.port || ""} kh\xF4ng ho\u1EA1t \u0111\u1ED9ng. D\u1EEBng launch \u0111\u1EC3 tr\xE1nh l\u1ED9 IP th\u1EADt.`);
      }
    }
    if (!proxyId && profile.proxy?.server) {
      const checkedProxy = await proxyService.checkCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password);
      if (checkedProxy.status !== "alive") {
        throw new Error(`Proxy nh\u1EADp tay ${profile.proxy.server} kh\xF4ng ho\u1EA1t \u0111\u1ED9ng. D\u1EEBng launch \u0111\u1EC3 tr\xE1nh l\u1ED9 IP th\u1EADt.`);
      }
      return checkedProxy;
    }
    return proxy || null;
  }
  stopProcessesUsingProfileDir(profileDir) {
    const pids = this.getProcessesUsingProfileDir(profileDir);
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
      }
    }
    if (pids.length) {
      const start = Date.now();
      while (Date.now() - start < 800) {
      }
    }
  }
  getProcessesUsingProfileDir(profileDir) {
    const currentPid = String(process.pid);
    const profileId = path5.basename(profileDir);
    const patterns = [profileDir, `${path5.sep}profiles_data${path5.sep}${profileId}`];
    const pids = /* @__PURE__ */ new Set();
    for (const pattern of patterns) {
      const result = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
      for (const line of result.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === currentPid) continue;
        const pid = Number(trimmed);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
    return Array.from(pids);
  }
  focusProcess(pid) {
    if (process.platform === "darwin") {
      const script = `
tell application "System Events"
  set targetProcess to first process whose unix id is ${pid}
  set frontmost of targetProcess to true
end tell`;
      const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
      if (result.status === 0) return true;
    }
    return false;
  }
  focusProfile(profileId) {
    const profileDir = path5.join(this.dataDir, profileId);
    const current = this.activeProcesses.get(profileId);
    const pids = [
      ...current?.pid && current.exitCode === null && !current.killed ? [current.pid] : [],
      ...this.getProcessesUsingProfileDir(profileDir)
    ];
    const uniquePids = Array.from(new Set(pids));
    for (const pid of uniquePids) {
      if (this.focusProcess(pid)) return true;
    }
    return false;
  }
  getProfileExtensionPaths(profile) {
    const paths = Array.isArray(profile.extensionPaths) ? profile.extensionPaths : [];
    return paths.map((extensionPath) => extensionPath.trim()).filter(Boolean).filter((extensionPath) => {
      if (!fs5.existsSync(extensionPath)) return false;
      const stat = fs5.statSync(extensionPath);
      return stat.isDirectory() && fs5.existsSync(path5.join(extensionPath, "manifest.json"));
    });
  }
  resolveStartupUrl(profile, explicitUrl) {
    if (explicitUrl) return explicitUrl;
    if (profile.fingerprint?.startUrlMode === "blank") return "about:blank";
    if (profile.fingerprint?.startUrlMode === "custom" && profile.startUrl) return profile.startUrl;
    return "https://gemini.google.com";
  }
  async writeOrbitaPreferences(profile, profileDir, startupUrl, proxy) {
    const fingerprint = profile.fingerprint;
    const defaultDir = path5.join(profileDir, "Default");
    const preferencesPath = path5.join(defaultDir, "Preferences");
    const preferences = this.readJsonFile(preferencesPath, {});
    this.cleanupExtensionPreferences(preferences);
    const languages = fingerprint.languages?.length ? fingerprint.languages : ["en-US", "en"];
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const deviceScaleFactor = fingerprint.screen?.deviceScaleFactor || 1;
    const mediaDevices = fingerprint.mediaDevices || { videoInput: 1, audioInput: 1, audioOutput: 1 };
    const canvasNoise = this.stableFraction(`${profile.id}:${fingerprint.canvasSeed}:canvas`);
    const audioNoise = this.stableFraction(`${profile.id}:${fingerprint.audioSeed}:audio`) * 1e-6;
    const proxyServer = proxy ? `${proxy.host}:${proxy.port}` : profile.proxy?.server?.replace(/^[a-z]+:\/\//i, "");
    const proxyProtocol = proxy?.protocol || (profile.proxy?.server?.match(/^([a-z]+):\/\//i)?.[1] || "http");
    const webRtcEnabled = fingerprint.webRtcMode !== "off";
    const pluginsEnabled = fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== "off";
    const canvasMode = fingerprint.canvasMode === "block" ? "block" : fingerprint.canvasMode === "off" ? "off" : "noise";
    const isMobile = this.isMobileFingerprint(fingerprint);
    preferences.gologin = {
      ...preferences.gologin || {},
      audioContext: {
        enable: fingerprint.audioMode !== "off",
        noiseValue: audioNoise
      },
      canvasMode,
      canvasNoise,
      client_rects_noise_enable: true,
      deviceMemory: (fingerprint.hardware?.memory || 8) * 1024,
      dns: fingerprint.customDns || "",
      doNotTrack: true,
      geoLocation: fingerprint.geolocation ? {
        accuracy: fingerprint.geolocation.accuracy || 100,
        latitude: fingerprint.geolocation.latitude,
        longitude: fingerprint.geolocation.longitude,
        mode: "prompt"
      } : { mode: "block" },
      getClientRectsNoice: canvasNoise,
      get_client_rects_noise: canvasNoise,
      hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
      is_m1: fingerprint.os === "mac",
      langHeader: this.languageHeader(languages),
      languages: languages.join(","),
      mediaDevices: {
        audioInputs: mediaDevices.audioInput ?? 1,
        audioOutputs: mediaDevices.audioOutput ?? 1,
        enable: true,
        uid: this.stableId(`${profile.id}:media`),
        videoInputs: mediaDevices.videoInput ?? 1
      },
      mobile: {
        device_scale_factor: deviceScaleFactor + 1e-8,
        enable: isMobile,
        height,
        width
      },
      name: profile.name,
      navigator: {
        max_touch_points: this.getMaxTouchPoints(fingerprint),
        platform: fingerprint.platform
      },
      plugins: {
        all_enable: pluginsEnabled,
        flash_enable: false
      },
      profile_id: profile.id,
      proxy: proxyServer ? {
        mode: "fixed_servers",
        password: proxy?.password || profile.proxy?.password || "",
        schema: proxyProtocol,
        server: proxyServer,
        username: proxy?.username || profile.proxy?.username || ""
      } : { mode: "direct" },
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
        systemExtensions: !!fingerprint.storage?.systemExtensions
      },
      timezone: {
        id: fingerprint.timezone || "UTC"
      },
      userAgent: fingerprint.userAgent || profile.userAgent,
      webGl: {
        mode: fingerprint.webgl?.mode !== "off",
        renderer: fingerprint.webgl?.renderer || "",
        vendor: fingerprint.webgl?.vendor || ""
      },
      webgl: {
        metadata: {
          mode: fingerprint.webgl?.mode !== "off",
          renderer: fingerprint.webgl?.renderer || "",
          vendor: fingerprint.webgl?.vendor || ""
        }
      },
      webglNoiceEnable: fingerprint.webgl?.mode === "noise",
      webglNoiseValue: Math.round(canvasNoise * 1e5) / 1e3,
      webgl_noice_enable: fingerprint.webgl?.mode === "noise",
      webgl_noise_enable: fingerprint.webgl?.mode === "noise",
      webgl_noise_value: Math.round(canvasNoise * 1e5) / 1e3,
      webRTC: {
        customize: true,
        enable: webRtcEnabled,
        enabled: webRtcEnabled,
        fillBasedOnIp: webRtcEnabled,
        isEmptyIceList: true,
        localIpMasking: !webRtcEnabled,
        localIps: [],
        mode: webRtcEnabled ? "alerted" : "disabled",
        publicIp: ""
      },
      webrtc: {
        enable: webRtcEnabled,
        mode: webRtcEnabled ? "alerted" : "disabled",
        should_fill_empty_ice_list: true
      }
    };
    preferences.proxy = proxyServer ? {
      mode: "fixed_servers",
      server: `${proxyProtocol}://${proxyServer}`
    } : { mode: "direct" };
    preferences.intl = {
      ...preferences.intl || {},
      accept_languages: languages.join(","),
      app_locale: languages[0],
      selected_languages: languages.join(",")
    };
    preferences.browser = {
      ...preferences.browser || {},
      window_placement: {
        bottom: Math.min(height + 60, height + 60),
        left: 0,
        maximized: false,
        right: width,
        top: 60,
        work_area_bottom: height + 60,
        work_area_left: 0,
        work_area_right: width,
        work_area_top: 0
      }
    };
    preferences.session = {
      ...preferences.session || {},
      restore_on_startup: 4,
      startup_urls: [startupUrl]
    };
    preferences.signin = {
      ...preferences.signin || {},
      allowed: true,
      signin_with_explicit_browser_signin_on: true
    };
    preferences.profile = {
      ...preferences.profile || {},
      name: profile.name,
      password_manager_enabled: fingerprint.storage?.savePasswords !== false
    };
    preferences.credentials_enable_service = fingerprint.storage?.savePasswords !== false;
    preferences.history = {
      ...preferences.history || {},
      saving_disabled: fingerprint.storage?.saveHistory === false
    };
    preferences.bookmark = {
      ...preferences.bookmark || {},
      saving_disabled: fingerprint.storage?.saveBookmarks === false
    };
    this.writeJsonFile(preferencesPath, preferences);
    this.writeJsonFile(path5.join(profileDir, "kct-orbita-fingerprint.json"), {
      profileId: profile.id,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      fingerprint: preferences.gologin
    });
  }
  writeBrowserProfileSnapshot(profile, profileDir, startupUrl, proxy) {
    const fingerprint = profile.fingerprint;
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const remote = this.getRemoteSession(profile.id);
    this.writeJsonFile(path5.join(profileDir, "kct-browser-profile.json"), {
      name: profile.name,
      role: "owner",
      id: profile.id,
      notes: profile.notes || "",
      browserType: "orbita",
      lockEnabled: !!fingerprint.storage?.lockSession,
      timezone: {
        id: fingerprint.timezone || "UTC"
      },
      navigator: {
        userAgent: fingerprint.userAgent || profile.userAgent,
        resolution: `${width}x${height}`,
        language: fingerprint.languages?.[0] || "en-US",
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints: this.getMaxTouchPoints(fingerprint)
      },
      geolocation: fingerprint.geolocation || {},
      debugMode: true,
      canBeRunning: true,
      isRunning: this.isProfileRunning(profile.id),
      proxy: proxy ? {
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        username: proxy.username || "",
        password: proxy.password || "",
        status: proxy.status,
        geo: proxy.geo || {}
      } : {},
      proxyType: proxy?.protocol || "",
      proxyRegion: proxy?.geo?.countryCode || profile.locationCountryCode || "",
      createdAt: new Date(profile.createdAt).toISOString(),
      updatedAt: now,
      lastActivity: now,
      userChromeExtensions: profile.extensionPaths || [],
      remoteOrbitaUrl: remote?.versionUrl || "",
      webGLMetadata: {
        vendor: fingerprint.webgl?.vendor || "",
        renderer: fingerprint.webgl?.renderer || "",
        mode: fingerprint.webgl?.mode === "off" ? "real" : "mask"
      },
      isM1: fingerprint.os === "mac",
      isPinned: !!profile.pinned,
      updateUALastChosenBrowserV: fingerprint.chromeVersion,
      isRunDisabled: false,
      runDisabledReason: "",
      isWeb: false,
      os: {
        type: fingerprint.os,
        platform: fingerprint.platform
      },
      osSpec: {
        chromeVersion: fingerprint.chromeVersion,
        screen: fingerprint.screen
      },
      host: proxy?.host || "",
      port: proxy?.port || 0,
      status: "running",
      folders: profile.folderName ? [profile.folderName] : [],
      sharedEmails: [],
      shareId: "",
      chromeExtensions: profile.extensionPaths || [],
      tags: [],
      proxyEnabled: !!proxy,
      isAutoGenerated: false,
      isBookmarksSynced: !!fingerprint.storage?.saveBookmarks,
      defaultProps: {
        profileNameIsDefault: !profile.name,
        profileNotesIsDefault: !profile.notes
      },
      autoLang: true,
      fonts: {
        families: fingerprint.fonts || [],
        enableMasking: fingerprint.fontsMode !== "real",
        enableDomRect: true
      },
      facebookAccountData: {
        date: "",
        token: "",
        fbIdAccount: "",
        email: "",
        password: "",
        googleDriveUrl: "",
        fb2faToolUrl: "",
        fbUrl: "",
        uaVersion: fingerprint.chromeVersion,
        cookies: "",
        notParsedData: []
      },
      order: 0,
      startupUrl,
      consistency: {
        languageMatchesTimezone: Array.isArray(fingerprint.languages) && fingerprint.languages.length > 0 && !!fingerprint.timezone,
        proxyGeoApplied: !proxy || !!proxy.geo,
        nativeOrbitaPreferencesWritten: true
      }
    });
  }
  writeFingerprintSnapshot(profile, profileDir) {
    const fingerprint = profile.fingerprint;
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const pluginsEnabled = fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== "off";
    this.writeJsonFile(path5.join(profileDir, "kct-fingerprint.json"), {
      navigator: {
        userAgent: fingerprint.userAgent || profile.userAgent,
        resolution: `${width}x${height}`,
        language: fingerprint.languages?.[0] || "en-US",
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints: this.getMaxTouchPoints(fingerprint)
      },
      plugins: {
        enableVulnerable: pluginsEnabled,
        enableFlash: false
      },
      canvas: {
        mode: fingerprint.canvasMode === "off" ? "real" : fingerprint.canvasMode === "block" ? "block" : "noise"
      },
      mediaDevices: {
        videoInputs: fingerprint.mediaDevices?.videoInput ?? 1,
        audioInputs: fingerprint.mediaDevices?.audioInput ?? 1,
        audioOutputs: fingerprint.mediaDevices?.audioOutput ?? 1
      },
      webGLMetadata: {
        mode: fingerprint.webgl?.mode === "off" ? "real" : "mask",
        vendor: fingerprint.webgl?.vendor || "",
        renderer: fingerprint.webgl?.renderer || ""
      },
      os: {
        type: fingerprint.os,
        platform: fingerprint.platform
      },
      osSpec: {
        chromeVersion: fingerprint.chromeVersion,
        screen: fingerprint.screen,
        timezone: fingerprint.timezone,
        languages: fingerprint.languages || []
      },
      devicePixelRatio: fingerprint.screen?.deviceScaleFactor || 1,
      fonts: fingerprint.fonts || [],
      extensionsToNewProfiles: profile.extensionPaths || [],
      userExtensionsToNewProfiles: profile.extensionPaths || [],
      autoLang: true
    });
  }
  async openProfileBrowser(profile, url, profileDir, options = {}) {
    fs5.mkdirSync(profileDir, { recursive: true });
    this.stopProcessesUsingProfileDir(profileDir);
    cleanupBrowserLock(profileDir);
    this.removePath(path5.join(profileDir, "kct_proxy_auth_extension"));
    this.cleanupProfilePreferences(profileDir);
    this.cleanupVolatileProfileState(profileDir);
    const browser = this.getBrowserExecutable();
    const proxy = await this.resolveProxy(profile);
    if (browser.name === "Orbita") {
      await this.writeOrbitaPreferences(profile, profileDir, url, proxy);
    }
    const fingerprint = profile.fingerprint;
    const languages = fingerprint.languages?.length ? fingerprint.languages : ["en-US", "en"];
    const width = fingerprint.screen?.width || profile.viewport?.width || 1280;
    const height = fingerprint.screen?.height || profile.viewport?.height || 800;
    const args = [
      `--user-data-dir=${profileDir}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      proxy ? "--webrtc-ip-handling-policy=default_public_interface_only" : "--webrtc-ip-handling-policy=disable_non_proxied_udp"
    ];
    if (browser.name !== "Orbita") {
      args.push(
        "--new-window",
        `--user-agent=${fingerprint.userAgent || profile.userAgent}`,
        `--window-size=${width},${height}`
      );
    }
    if (options.remoteDebuggingPort) {
      args.push(`--remote-debugging-address=127.0.0.1`);
      args.push(`--remote-debugging-port=${options.remoteDebuggingPort}`);
    }
    args.push(`--lang=${languages[0]}`);
    const extensionPaths = fingerprint.storage?.allowInstallExtensions !== false ? this.getProfileExtensionPaths(profile) : [];
    if (proxy?.status === "alive") {
      args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`);
      if (browser.name !== "Orbita" && proxy.username && proxy.password) {
        const extensionDir = path5.join(profileDir, "kct_proxy_auth_extension");
        fs5.mkdirSync(extensionDir, { recursive: true });
        fs5.writeFileSync(path5.join(extensionDir, "manifest.json"), JSON.stringify({
          manifest_version: 3,
          name: "KCT Proxy Auth",
          version: "1.0.0",
          permissions: ["webRequest", "webRequestAuthProvider"],
          host_permissions: ["<all_urls>"],
          background: { service_worker: "background.js" }
        }, null, 2));
        fs5.writeFileSync(path5.join(extensionDir, "background.js"), `
chrome.webRequest.onAuthRequired.addListener(
  () => ({ authCredentials: { username: ${JSON.stringify(proxy.username)}, password: ${JSON.stringify(proxy.password)} } }),
  { urls: ['<all_urls>'] },
  ['blocking']
);
`);
        args.push(`--load-extension=${extensionDir}`);
      }
    } else if (browser.name !== "Orbita" && profile.proxy?.server) {
      args.push(`--proxy-server=${profile.proxy.server}`);
    }
    if (extensionPaths.length) {
      const existingLoadExtension = args.findIndex((arg) => arg.startsWith("--load-extension="));
      if (existingLoadExtension >= 0) {
        args[existingLoadExtension] = `${args[existingLoadExtension]},${extensionPaths.join(",")}`;
      } else {
        args.push(`--load-extension=${extensionPaths.join(",")}`);
      }
    }
    if (browser.name === "Orbita") {
      args.push("--donut-pie=undefined");
      args.push("--component-updater=fast-update,initial-delay=0.1");
      args.push("--disable-features=PrintCompositorLPAC");
      args.push("--disable-quic");
      args.push("--font-masking-mode=1");
      args.push("--disable-encryption");
      args.push(`--window-size=${width},${height}`);
    }
    const customLaunchArgs = Array.isArray(profile.launchArgs) ? profile.launchArgs : [];
    for (const customArg of customLaunchArgs) {
      const arg = customArg.trim();
      if (!arg || arg === url || arg.startsWith("--user-data-dir=") || arg.startsWith("--profile-directory=")) continue;
      args.push(arg);
    }
    args.push(url);
    this.writeJsonFile(path5.join(profileDir, "kct-last-launch.json"), {
      profileId: profile.id,
      launchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      browser,
      args: args.map((arg) => arg.replace(/\/\/([^:@/]+):([^@/]+)@/g, "//***:***@")),
      proxy: proxy ? {
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        hasAuth: !!(proxy.username && proxy.password),
        geo: proxy.geo || null
      } : null,
      remoteDebugging: options.remoteDebuggingPort ? {
        host: "127.0.0.1",
        port: options.remoteDebuggingPort,
        versionUrl: `http://127.0.0.1:${options.remoteDebuggingPort}/json/version`
      } : null,
      extensions: extensionPaths
    });
    const child = spawn(browser.executable, args, {
      detached: true,
      stdio: "ignore",
      cwd: browser.cwd
    });
    this.activeProcesses.set(profile.id, child);
    if (options.remoteDebuggingPort) {
      this.remoteSessions.set(profile.id, {
        profileId: profile.id,
        port: options.remoteDebuggingPort,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        url
      });
    }
    this.writeBrowserProfileSnapshot(profile, profileDir, url, proxy);
    this.writeFingerprintSnapshot(profile, profileDir);
    child.on("exit", () => {
      this.activeProcesses.delete(profile.id);
      this.remoteSessions.delete(profile.id);
    });
    child.unref();
  }
  async launchProfile(profile, options = {}) {
    const profileDir = path5.join(this.dataDir, profile.id);
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
      fingerprint: profile.fingerprint
    });
    const normalizedProfile = {
      ...profile,
      userAgent: fingerprint.userAgent,
      viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
      fingerprint
    };
    const url = this.resolveStartupUrl(profile, options.url);
    await this.openProfileBrowser(normalizedProfile, url, profileDir, { remoteDebuggingPort: options.remoteDebuggingPort });
    return { launched: true };
  }
  async stopProfile(profileId) {
    const child = this.activeProcesses.get(profileId);
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    const profileDir = path5.join(this.dataDir, profileId);
    for (const pid of this.getProcessesUsingProfileDir(profileDir)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
      }
    }
    this.activeProcesses.delete(profileId);
    this.remoteSessions.delete(profileId);
  }
  async repairProfile(profileId) {
    const profileDir = path5.join(this.dataDir, profileId);
    fs5.mkdirSync(profileDir, { recursive: true });
    await this.stopProfile(profileId).catch(() => {
    });
    this.stopProcessesUsingProfileDir(profileDir);
    cleanupBrowserLock(profileDir);
    this.removePath(path5.join(profileDir, "kct_proxy_auth_extension"));
    this.cleanupProfilePreferences(profileDir);
    this.cleanupVolatileProfileState(profileDir);
    return {
      success: true,
      profileDir,
      repairedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  isProfileRunning(profileId) {
    const child = this.activeProcesses.get(profileId);
    if (child && child.exitCode === null && !child.killed) return true;
    const profileDir = path5.join(this.dataDir, profileId);
    return this.getProcessesUsingProfileDir(profileDir).length > 0;
  }
  getActiveContext(profileId) {
    return this.activeProcesses.get(profileId);
  }
  getRemoteSessions() {
    return Array.from(this.remoteSessions.values()).map((session) => ({
      ...session,
      versionUrl: `http://127.0.0.1:${session.port}/json/version`,
      tabsUrl: `http://127.0.0.1:${session.port}/json/list`
    }));
  }
  getRemoteSession(profileId) {
    return this.getRemoteSessions().find((session) => session.profileId === profileId) || null;
  }
};
var browserService = new BrowserService();

// server/cookies.ts
import fs6 from "fs";
import path6 from "path";
function getCookiesPath(profileId, platform) {
  return path6.join(getDataDir(), "profiles_cookies", `${profileId}_${platform}.json`);
}
function loadCookies(profileId, platform) {
  const file = getCookiesPath(profileId, platform);
  if (!fs6.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs6.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveCookies(profileId, platform, cookies) {
  const dir = path6.join(getDataDir(), "profiles_cookies");
  if (!fs6.existsSync(dir)) fs6.mkdirSync(dir, { recursive: true });
  fs6.writeFileSync(getCookiesPath(profileId, platform), JSON.stringify(normalizeCookies(cookies), null, 2));
}
function cookieKey(cookie) {
  return [cookie?.name || "", cookie?.domain || "", cookie?.path || "/"].join("||");
}
function sameSiteValue(value) {
  if (typeof value !== "string") return void 0;
  const lower = value.toLowerCase();
  if (lower === "strict") return "Strict";
  if (lower === "lax") return "Lax";
  if (lower === "none" || lower === "no_restriction") return "None";
  return void 0;
}
function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== "object") return null;
  const cleaned = { ...cookie };
  if (!cleaned.name && cleaned.key) cleaned.name = cleaned.key;
  if (cleaned.value === void 0 && cleaned.val !== void 0) cleaned.value = cleaned.val;
  if (cleaned.value === void 0 || cleaned.value === null) cleaned.value = "";
  cleaned.value = String(cleaned.value);
  if (!cleaned.name) return null;
  if ("expirationDate" in cleaned) cleaned.expires = cleaned.expirationDate;
  if ("expiry" in cleaned) cleaned.expires = cleaned.expiry;
  if ("expiration" in cleaned) cleaned.expires = cleaned.expiration;
  if (typeof cleaned.expires === "string") {
    const numeric = Number(cleaned.expires);
    cleaned.expires = Number.isFinite(numeric) ? numeric : void 0;
  }
  if (cleaned.expires && cleaned.expires > 9999999999) cleaned.expires = Math.floor(cleaned.expires / 1e3);
  if (cleaned.expires === -1 || cleaned.expires === 0 || cleaned.session) delete cleaned.expires;
  if (cleaned.url && !cleaned.domain) {
    try {
      const url = new URL(cleaned.url);
      cleaned.domain = url.hostname;
      cleaned.path = cleaned.path || url.pathname || "/";
      cleaned.secure = cleaned.secure ?? url.protocol === "https:";
    } catch {
    }
  }
  if (!cleaned.domain && cleaned.host) cleaned.domain = cleaned.host;
  if (!cleaned.domain) return null;
  cleaned.path = cleaned.path || "/";
  cleaned.httpOnly = Boolean(cleaned.httpOnly ?? cleaned.http_only);
  cleaned.secure = Boolean(cleaned.secure);
  const sameSite = sameSiteValue(cleaned.sameSite || cleaned.same_site || cleaned.samesite);
  if (sameSite) cleaned.sameSite = sameSite;
  else delete cleaned.sameSite;
  for (const key of ["expirationDate", "expiry", "expiration", "hostOnly", "session", "storeId", "id", "partitionKey", "sourcePort", "sourceScheme", "priority", "sameParty", "url", "host", "key", "val", "http_only", "same_site", "samesite"]) {
    delete cleaned[key];
  }
  return cleaned;
}
function normalizeCookies(cookies) {
  const merged = /* @__PURE__ */ new Map();
  for (const raw of Array.isArray(cookies) ? cookies : []) {
    const cookie = normalizeCookie(raw);
    if (cookie) merged.set(cookieKey(cookie), cookie);
  }
  return Array.from(merged.values());
}
function parseJsonCookies(input) {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.cookies)) return parsed.cookies;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (parsed.name && (parsed.domain || parsed.url)) return [parsed];
    return null;
  } catch {
    return null;
  }
}
function parseNetscapeCookies(input) {
  const cookies = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("# ") || line === "#HttpOnly_") continue;
    const httpOnly = line.startsWith("#HttpOnly_");
    const normalizedLine = httpOnly ? line.replace(/^#HttpOnly_/, "") : line;
    const parts = normalizedLine.split("	");
    if (parts.length < 7) continue;
    const [domain, , pathValue, secure, expires, name, ...valueParts] = parts;
    cookies.push({
      domain,
      path: pathValue || "/",
      secure: /^true$/i.test(secure),
      httpOnly,
      expires: Number(expires) || void 0,
      name,
      value: valueParts.join("	")
    });
  }
  return cookies;
}
function parseNameValueCookies(input, domain) {
  if (!domain) return [];
  return input.split(/;\s*/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    return {
      name: part.slice(0, index).trim(),
      value: part.slice(index + 1),
      domain,
      path: "/"
    };
  }).filter(Boolean);
}
function parseCookieInput(input, defaultDomain) {
  if (Array.isArray(input)) return normalizeCookies(input);
  if (input && typeof input === "object") {
    if (Array.isArray(input.cookies)) return normalizeCookies(input.cookies);
    return normalizeCookies([input]);
  }
  if (typeof input !== "string") return [];
  const text = input.trim();
  if (!text) return [];
  const jsonCookies = parseJsonCookies(text);
  if (jsonCookies) return normalizeCookies(jsonCookies);
  const netscapeCookies = parseNetscapeCookies(text);
  if (netscapeCookies.length) return normalizeCookies(netscapeCookies);
  return normalizeCookies(parseNameValueCookies(text, defaultDomain));
}
function exportCookies(cookies, format = "json") {
  const normalized = normalizeCookies(cookies);
  if (format === "netscape") {
    return [
      "# Netscape HTTP Cookie File",
      ...normalized.map((cookie) => [
        cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain,
        cookie.domain?.startsWith(".") ? "TRUE" : "FALSE",
        cookie.path || "/",
        cookie.secure ? "TRUE" : "FALSE",
        Math.floor(cookie.expires || 0),
        cookie.name,
        cookie.value
      ].join("	"))
    ].join("\n");
  }
  if (format === "header") {
    return normalized.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  return JSON.stringify(normalized, null, 2);
}
function cleanCookiesForPlaywright(cookies) {
  return normalizeCookies(cookies).map((cookie) => {
    const cleaned = { ...cookie };
    for (const key of ["hostOnly", "session", "storeId", "id", "partitionKey", "sourcePort", "sourceScheme", "priority", "sameParty"]) {
      delete cleaned[key];
    }
    return cleaned;
  }).filter((cookie) => cookie.domain && cookie.path);
}

// server/mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import net from "net";
import { z } from "zod";
var COOKIE_PLATFORMS = ["chatgpt", "gemini"];
var MCP_TOOL_NAMES = [
  "kct_health",
  "kct_list_profiles",
  "kct_get_profile",
  "kct_launch_profile",
  "kct_stop_profile",
  "kct_repair_profile",
  "kct_list_proxies",
  "kct_import_proxies",
  "kct_check_proxies",
  "kct_get_cookies",
  "kct_save_cookies",
  "kct_remote_chrome_start",
  "kct_remote_chrome_list",
  "kct_remote_chrome_version"
];
function findAvailablePort(startPort = 9222) {
  return new Promise((resolve) => {
    const tryPort = (port2) => {
      const server = net.createServer();
      server.once("error", () => tryPort(port2 + 1));
      server.once("listening", () => server.close(() => resolve(port2)));
      server.listen(port2, "127.0.0.1");
    };
    tryPort(startPort);
  });
}
async function readChromeJson(port2, pathName = "/json/version") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`http://127.0.0.1:${port2}${pathName}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
function loadProfiles() {
  const profiles = readJson("profiles.json", []);
  return Array.isArray(profiles) ? profiles : [];
}
function findProfile(profileId) {
  return loadProfiles().find((profile) => profile.id === profileId);
}
function redactProxy(proxy) {
  return {
    ...proxy,
    username: proxy.username ? "***" : void 0,
    password: proxy.password ? "***" : void 0,
    hasAuth: !!(proxy.username || proxy.password)
  };
}
function redactProfile(profile) {
  return {
    ...profile,
    proxy: profile.proxy ? {
      server: profile.proxy.server,
      username: profile.proxy.username ? "***" : void 0,
      password: profile.proxy.password ? "***" : void 0,
      hasAuth: !!(profile.proxy.username || profile.proxy.password)
    } : void 0,
    isRunning: browserService.isProfileRunning(profile.id)
  };
}
function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}
function errorResult(message, details) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, details }, null, 2)
      }
    ],
    isError: true
  };
}
function requireProfile(profileId) {
  const profile = findProfile(profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  return profile;
}
function createKctMcpServer() {
  const server = new McpServer({
    name: "kctlogin",
    version: "0.1.0"
  });
  server.registerTool(
    "kct_health",
    {
      title: "KCT Health",
      description: "Check KCTLogin runtime, data directory, and available MCP tools."
    },
    async () => {
      try {
        return textResult({
          ok: true,
          app: "kctlogin",
          runtime: browserService.getRuntimeInfo(),
          tools: MCP_TOOL_NAMES
        });
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_list_profiles",
    {
      title: "List Profiles",
      description: "List KCTLogin browser profiles with runtime state and redacted proxy credentials.",
      inputSchema: {
        includeFingerprint: z.boolean().optional().default(false)
      }
    },
    async ({ includeFingerprint }) => {
      const profiles = loadProfiles().map((profile) => {
        const redacted = redactProfile(profile);
        if (includeFingerprint) return redacted;
        const { fingerprint: _fingerprint, ...summary } = redacted;
        return summary;
      });
      return textResult({ profiles });
    }
  );
  server.registerTool(
    "kct_get_profile",
    {
      title: "Get Profile",
      description: "Get one KCTLogin profile by id. Proxy credentials are redacted.",
      inputSchema: {
        profileId: z.string().min(1),
        includeFingerprint: z.boolean().optional().default(true)
      }
    },
    async ({ profileId, includeFingerprint }) => {
      const profile = requireProfile(profileId);
      const redacted = redactProfile(profile);
      if (includeFingerprint) return textResult({ profile: redacted });
      const { fingerprint: _fingerprint, ...summary } = redacted;
      return textResult({ profile: summary });
    }
  );
  server.registerTool(
    "kct_launch_profile",
    {
      title: "Launch Profile",
      description: "Launch a KCTLogin profile in Orbita/Chrome.",
      inputSchema: {
        profileId: z.string().min(1),
        url: z.string().url().optional()
      }
    },
    async ({ profileId, url }) => {
      try {
        const profile = requireProfile(profileId);
        await browserService.launchProfile(profile, { mode: "visible", url });
        return textResult({ success: true, profileId, isRunning: browserService.isProfileRunning(profileId) });
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_stop_profile",
    {
      title: "Stop Profile",
      description: "Stop a running KCTLogin profile.",
      inputSchema: {
        profileId: z.string().min(1)
      }
    },
    async ({ profileId }) => {
      await browserService.stopProfile(profileId);
      return textResult({ success: true, profileId, isRunning: browserService.isProfileRunning(profileId) });
    }
  );
  server.registerTool(
    "kct_repair_profile",
    {
      title: "Repair Profile",
      description: "Clean stale locks and old proxy auth extension data for a profile.",
      inputSchema: {
        profileId: z.string().min(1)
      }
    },
    async ({ profileId }) => {
      try {
        requireProfile(profileId);
        return textResult(await browserService.repairProfile(profileId));
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_list_proxies",
    {
      title: "List Proxies",
      description: "List proxies with credentials redacted.",
      inputSchema: {
        status: z.enum(["alive", "dead", "checking", "unknown"]).optional()
      }
    },
    async ({ status }) => {
      const proxies = proxyService.getAll().filter((proxy) => !status || proxy.status === status).map(redactProxy);
      return textResult({ proxies });
    }
  );
  server.registerTool(
    "kct_import_proxies",
    {
      title: "Import Proxies",
      description: "Import proxies from text. Supports host:port and host:port:user:pass lines.",
      inputSchema: {
        input: z.string().min(1),
        group: z.string().optional().default("MCP Imported")
      }
    },
    async ({ input, group }) => {
      const added = proxyService.addProxies(input, group).map(redactProxy);
      return textResult({ success: true, count: added.length, proxies: added });
    }
  );
  server.registerTool(
    "kct_check_proxies",
    {
      title: "Check Proxies",
      description: "Check one or more stored proxies by id.",
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1),
        concurrency: z.number().int().min(1).max(10).optional().default(3)
      }
    },
    async ({ ids, concurrency }) => {
      try {
        const results = ids.length === 1 ? [await proxyService.checkProxy(ids[0])] : await proxyService.checkBatch(ids, concurrency);
        return textResult({ results: results.filter(Boolean).map((proxy) => redactProxy(proxy)) });
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_get_cookies",
    {
      title: "Get Cookies",
      description: "Read saved cookies for a profile/platform.",
      inputSchema: {
        profileId: z.string().min(1),
        platform: z.enum(COOKIE_PLATFORMS),
        format: z.enum(["json", "netscape", "header"]).optional().default("json")
      }
    },
    async ({ profileId, platform, format }) => {
      try {
        requireProfile(profileId);
        const cookies = loadCookies(profileId, platform);
        if (format === "json") return textResult({ cookies });
        return textResult(exportCookies(cookies, format));
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_save_cookies",
    {
      title: "Save Cookies",
      description: "Save cookies for a profile/platform from JSON, Netscape, or Cookie header text.",
      inputSchema: {
        profileId: z.string().min(1),
        platform: z.enum(COOKIE_PLATFORMS),
        cookies: z.any(),
        domain: z.string().optional()
      }
    },
    async ({ profileId, platform, cookies, domain }) => {
      try {
        requireProfile(profileId);
        const parsed = parseCookieInput(cookies, domain);
        if (!parsed.length) return errorResult("Kh\xF4ng parse \u0111\u01B0\u1EE3c cookie input");
        saveCookies(profileId, platform, parsed);
        return textResult({ success: true, count: parsed.length });
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_remote_chrome_start",
    {
      title: "Start Remote Chrome",
      description: "Launch a profile with Chrome DevTools Protocol enabled on 127.0.0.1.",
      inputSchema: {
        profileId: z.string().min(1),
        port: z.number().int().min(1024).max(65535).optional(),
        url: z.string().url().optional()
      }
    },
    async ({ profileId, port: port2, url }) => {
      try {
        const profile = requireProfile(profileId);
        const remotePort = port2 || await findAvailablePort(9222);
        await browserService.launchProfile(profile, { mode: "remote", url, remoteDebuggingPort: remotePort });
        let version = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            version = await readChromeJson(remotePort, "/json/version");
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        }
        return textResult({
          success: true,
          profileId,
          port: remotePort,
          versionUrl: `http://127.0.0.1:${remotePort}/json/version`,
          tabsUrl: `http://127.0.0.1:${remotePort}/json/list`,
          webSocketDebuggerUrl: version?.webSocketDebuggerUrl || null
        });
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  server.registerTool(
    "kct_remote_chrome_list",
    {
      title: "List Remote Chrome Sessions",
      description: "List active Chrome DevTools Protocol sessions launched by KCTLogin."
    },
    async () => textResult({ sessions: browserService.getRemoteSessions() })
  );
  server.registerTool(
    "kct_remote_chrome_version",
    {
      title: "Remote Chrome Version",
      description: "Read /json/version from an active remote Chrome session.",
      inputSchema: {
        profileId: z.string().min(1)
      }
    },
    async ({ profileId }) => {
      try {
        const session = browserService.getRemoteSession(profileId);
        if (!session) return errorResult("Remote Chrome session not found");
        return textResult(await readChromeJson(session.port, "/json/version"));
      } catch (error) {
        return errorResult(error.message);
      }
    }
  );
  return server;
}
async function main() {
  const server = createKctMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("[KCTLogin MCP] Server error:", error);
    process.exit(1);
  });
}

// server/proxyDeviceService.ts
var ProxyDeviceService = class {
  devices = [];
  constructor() {
    this.devices = readJson("proxy_devices.json", []);
  }
  save() {
    writeJson("proxy_devices.json", this.devices);
  }
  getAll() {
    return [...this.devices].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  getById(id) {
    return this.devices.find((device) => device.id === id);
  }
  create(input) {
    if (!input.name?.trim()) throw new Error("Device name is required");
    if (!input.host?.trim()) throw new Error("Device host/IP is required");
    if (!input.port || Number.isNaN(Number(input.port))) throw new Error("Device port is required");
    const device = {
      id: Math.random().toString(36).slice(2, 11),
      name: input.name.trim(),
      model: input.model?.trim() || void 0,
      host: input.host.trim(),
      port: Number(input.port),
      protocol: input.protocol || "http",
      username: input.username?.trim() || void 0,
      password: input.password || void 0,
      notes: input.notes?.trim() || void 0,
      proxyStatus: "unknown",
      smsStatus: input.smsStatus || "unknown",
      createdAt: Date.now()
    };
    this.devices.unshift(device);
    this.save();
    return device;
  }
  update(id, updates) {
    const index = this.devices.findIndex((device) => device.id === id);
    if (index === -1) return null;
    this.devices[index] = {
      ...this.devices[index],
      ...updates,
      id,
      port: updates.port === void 0 ? this.devices[index].port : Number(updates.port)
    };
    this.save();
    return this.devices[index];
  }
  delete(id) {
    const before = this.devices.length;
    this.devices = this.devices.filter((device) => device.id !== id);
    this.save();
    return this.devices.length !== before;
  }
  async check(id) {
    const device = this.getById(id);
    if (!device) throw new Error("Proxy device not found");
    this.update(id, { proxyStatus: "checking" });
    const checked = await proxyService.checkCustomProxy(
      `${device.protocol}://${device.host}:${device.port}`,
      device.username,
      device.password
    );
    const updated = this.update(id, {
      proxyStatus: checked.status === "alive" ? "connected" : "disconnected",
      ip: checked.geo?.ip,
      country: checked.geo?.country,
      countryCode: checked.geo?.countryCode,
      lastChecked: Date.now()
    });
    return { device: updated, proxy: checked };
  }
  addToProxyManager(id) {
    const device = this.getById(id);
    if (!device) throw new Error("Proxy device not found");
    const auth = device.username ? `${encodeURIComponent(device.username)}:${encodeURIComponent(device.password || "")}@` : "";
    const input = `${device.protocol}://${auth}${device.host}:${device.port}`;
    const added = proxyService.addProxies(input, `Device: ${device.name}`);
    const proxy = added[0] || null;
    if (proxy) this.update(id, { proxyId: proxy.id });
    return proxy;
  }
};
var proxyDeviceService = new ProxyDeviceService();

// server/index.ts
var app = express();
var port = Number(process.env.PORT || 3002);
var profilesDataDir = getProfilesDataDir();
var dataDir = getDataDir();
var execFileAsync = promisify(execFile);
app.use(cors());
app.use(express.json({ limit: "60mb" }));
var SUPPORTED_IMAGE_MIME_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
var SUPPORTED_VIDEO_MIME_TYPES = /* @__PURE__ */ new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
var veoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (SUPPORTED_VIDEO_MIME_TYPES.has(file.mimetype) || /\.(mp4|mov|m4v|webm)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Vui l\xF2ng upload video MP4, MOV, M4V ho\u1EB7c WebM."));
  }
});
function loadProfiles2() {
  const profiles = readJson("profiles.json", []);
  return Array.isArray(profiles) ? profiles : [];
}
function isoDate(value) {
  if (typeof value === "string") return value;
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? (/* @__PURE__ */ new Date()).toISOString() : date.toISOString();
}
async function decodeImageData(input) {
  const inputBuffer = Buffer.isBuffer(input) ? input : input instanceof ArrayBuffer ? Buffer.from(input) : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const { data, info } = await sharp(inputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  };
}
async function encodeImageData(imageData) {
  return sharp(Buffer.from(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength), {
    raw: {
      width: imageData.width,
      height: imageData.height,
      channels: 4
    }
  }).png().toBuffer();
}
function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl || "");
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  return {
    mimeType,
    buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64")
  };
}
function even(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}
function buildVeoZoomFilter(inputWidth, inputHeight, zoom) {
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
async function getVideoSize(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    videoPath
  ], { maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c k\xEDch th\u01B0\u1EDBc video.");
  return { width: Number(stream.width), height: Number(stream.height) };
}
function getCurrentVersions(profiles) {
  const firstFingerprint = profiles.find((profile) => profile.fingerprint?.chromeVersion)?.fingerprint;
  const latestVersionFile = path7.join(process.cwd(), "vendor", "orbita-browser-146", "version", "latest-version.txt");
  const orbitaVersion = fs7.existsSync(latestVersionFile) ? fs7.readFileSync(latestVersionFile, "utf8").trim() : "146";
  const browserVersion = firstFingerprint?.chromeVersion || "146.0.0.0";
  return {
    currentOrbitaMajorV: String(orbitaVersion).split(".")[0] || "146",
    currentBrowserV: browserVersion,
    currentTestBrowserV: browserVersion,
    currentTestOrbitaMajorV: String(orbitaVersion).split(".")[0] || "146"
  };
}
function mapProfileForExport(profile, order) {
  const fingerprint = normalizeFingerprint({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    fingerprint: profile.fingerprint
  });
  const maxTouchPoints = fingerprint.os === "android" ? Math.max(1, fingerprint.maxTouchPoints ?? 5) : 0;
  const selectedProxy = profile.proxyId ? proxyService.getById(profile.proxyId) : profile.proxy?.server ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password) : null;
  const proxyHost = selectedProxy?.host || profile.proxy?.server?.replace(/^[a-z]+:\/\//i, "").split(":")[0] || "";
  const proxyPort = selectedProxy?.port || Number(profile.proxy?.server?.split(":").pop()) || 0;
  const createdAt = isoDate(profile.createdAt);
  const updatedAt = isoDate(profile.updatedAt || profile.createdAt);
  const isRunning = browserService.isProfileRunning(profile.id);
  return {
    name: profile.name,
    role: "owner",
    id: profile.id,
    notes: profile.notes || "",
    browserType: "orbita",
    lockEnabled: !!fingerprint.storage?.lockSession,
    timezone: {
      id: fingerprint.timezone
    },
    navigator: {
      userAgent: fingerprint.userAgent,
      resolution: `${fingerprint.screen.width}x${fingerprint.screen.height}`,
      language: fingerprint.languages[0] || "en-US",
      platform: fingerprint.platform,
      hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
      deviceMemory: fingerprint.hardware?.memory || 8,
      maxTouchPoints
    },
    fingerprint: {
      navigator: {
        userAgent: fingerprint.userAgent,
        resolution: `${fingerprint.screen.width}x${fingerprint.screen.height}`,
        language: fingerprint.languages[0] || "en-US",
        platform: fingerprint.platform,
        hardwareConcurrency: fingerprint.hardware?.concurrency || 8,
        deviceMemory: fingerprint.hardware?.memory || 8,
        maxTouchPoints
      },
      plugins: {
        enableVulnerable: fingerprint.storage?.browserPlugins !== false && fingerprint.pluginsMode !== "off",
        enableFlash: false
      },
      canvas: {
        mode: fingerprint.canvasMode === "off" ? "real" : fingerprint.canvasMode === "block" ? "block" : "noise"
      },
      mediaDevices: {
        videoInputs: fingerprint.mediaDevices?.videoInput ?? 1,
        audioInputs: fingerprint.mediaDevices?.audioInput ?? 1,
        audioOutputs: fingerprint.mediaDevices?.audioOutput ?? 1
      },
      webGLMetadata: {
        mode: fingerprint.webgl?.mode === "off" ? "real" : "mask",
        vendor: fingerprint.webgl?.vendor || "",
        renderer: fingerprint.webgl?.renderer || ""
      },
      os: {
        type: fingerprint.os,
        platform: fingerprint.platform
      },
      osSpec: {
        chromeVersion: fingerprint.chromeVersion,
        screen: fingerprint.screen,
        timezone: fingerprint.timezone,
        languages: fingerprint.languages || []
      },
      devicePixelRatio: fingerprint.screen?.deviceScaleFactor || 1,
      fonts: fingerprint.fonts || [],
      extensionsToNewProfiles: profile.extensionPaths || [],
      userExtensionsToNewProfiles: profile.extensionPaths || [],
      autoLang: true
    },
    geolocation: fingerprint.geolocation || {},
    debugMode: true,
    canBeRunning: true,
    isRunning,
    proxy: selectedProxy ? {
      id: selectedProxy.id,
      host: selectedProxy.host,
      port: selectedProxy.port,
      username: selectedProxy.username || "",
      password: selectedProxy.password || "",
      protocol: selectedProxy.protocol,
      status: selectedProxy.status,
      geo: selectedProxy.geo || {}
    } : {},
    proxyType: selectedProxy?.protocol || "",
    proxyRegion: selectedProxy?.geo?.countryCode || profile.locationCountryCode || "",
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
      viewCustomExtensions: true
    },
    remoteOrbitaUrl: browserService.getRemoteSession(profile.id)?.versionUrl || "",
    webGLMetadata: {
      vendor: fingerprint.webgl?.vendor || "",
      renderer: fingerprint.webgl?.renderer || "",
      mode: fingerprint.webgl?.mode === "off" ? "real" : "mask"
    },
    isM1: fingerprint.os === "mac",
    isPinned: !!profile.pinned,
    updateUALastChosenBrowserV: fingerprint.chromeVersion,
    isRunDisabled: false,
    runDisabledReason: "",
    isWeb: false,
    os: {
      type: fingerprint.os,
      platform: fingerprint.platform
    },
    osSpec: {
      chromeVersion: fingerprint.chromeVersion,
      screen: fingerprint.screen
    },
    host: proxyHost,
    port: proxyPort,
    status: isRunning ? "running" : "ready",
    folders: profile.folderName ? [profile.folderName] : [],
    sharedEmails: [],
    shareId: "",
    chromeExtensions: profile.extensionPaths || [],
    tags: [],
    proxyEnabled: !!selectedProxy,
    isAutoGenerated: false,
    isBookmarksSynced: !!fingerprint.storage?.saveBookmarks,
    defaultProps: {
      profileNameIsDefault: !profile.name,
      profileNotesIsDefault: !profile.notes
    },
    autoLang: true,
    fonts: {
      families: fingerprint.fonts || [],
      enableMasking: fingerprint.fontsMode !== "real",
      enableDomRect: true
    },
    facebookAccountData: {
      date: "",
      token: "",
      fbIdAccount: "",
      email: "",
      password: "",
      googleDriveUrl: "",
      fb2faToolUrl: "",
      fbUrl: "",
      uaVersion: fingerprint.chromeVersion,
      cookies: "",
      notParsedData: []
    },
    order
  };
}
function writeProfilesExport(profiles) {
  const versions = getCurrentVersions(profiles);
  writeJson("profiles_export.json", {
    profiles: profiles.map((profile, index) => mapProfileForExport(profile, index + 1)),
    allProfilesCount: profiles.length,
    ...versions,
    isFolderDeleted: false
  });
}
function getImportProfileItems(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.profiles)) return input.profiles;
  return [];
}
function isBrowserOS(value) {
  return value === "windows" || value === "mac" || value === "android";
}
function inferImportedOS(userAgent = "", platform = "") {
  if (/Android|Mobile/i.test(userAgent) || /Linux arm/i.test(platform)) return "android";
  if (/Windows/i.test(userAgent) || platform === "Win32") return "windows";
  return "mac";
}
function parseResolution(value) {
  const match = String(value || "").match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}
function isSafeRelativePath(value) {
  const normalized = path7.normalize(String(value || ""));
  return normalized && !path7.isAbsolute(normalized) && !normalized.startsWith("..") && !normalized.split(path7.sep).includes("..");
}
function shouldExportCookieFile(relativePath) {
  const baseName = path7.basename(relativePath).toLowerCase();
  if (baseName === "singletoncookie") return false;
  return baseName === "cookies" || baseName === "cookies-journal" || baseName === "cookies-wal" || baseName === "cookies-shm" || baseName === "safe browsing cookies" || baseName === "safe browsing cookies-journal" || baseName === "safe browsing cookies-wal" || baseName === "safe browsing cookies-shm";
}
function collectCookieFiles(profileId) {
  const profileDir = path7.join(profilesDataDir, profileId);
  const files = [];
  if (!fs7.existsSync(profileDir)) return files;
  const walk = (dir) => {
    for (const name of fs7.readdirSync(dir)) {
      const fullPath = path7.join(dir, name);
      let stat;
      try {
        stat = fs7.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const relativePath = path7.relative(profileDir, fullPath);
      if (!shouldExportCookieFile(relativePath)) continue;
      files.push({
        path: relativePath,
        data: fs7.readFileSync(fullPath).toString("base64"),
        size: stat.size
      });
    }
  };
  walk(profileDir);
  return files;
}
function collectSavedCookieFiles(profileId) {
  const cookiesDir = path7.join(dataDir, "profiles_cookies");
  if (!fs7.existsSync(cookiesDir)) return [];
  return fs7.readdirSync(cookiesDir).filter((name) => name.startsWith(`${profileId}_`) && name.endsWith(".json")).map((name) => {
    const fullPath = path7.join(cookiesDir, name);
    return {
      name,
      data: fs7.readFileSync(fullPath).toString("base64"),
      size: fs7.statSync(fullPath).size
    };
  });
}
function restoreCookieFiles(profileId, files) {
  if (!Array.isArray(files)) return 0;
  const profileDir = path7.join(profilesDataDir, profileId);
  let restored = 0;
  for (const file of files) {
    if (!isSafeRelativePath(file?.path) || typeof file?.data !== "string") continue;
    const target = path7.join(profileDir, file.path);
    fs7.mkdirSync(path7.dirname(target), { recursive: true });
    fs7.writeFileSync(target, Buffer.from(file.data, "base64"));
    restored += 1;
  }
  return restored;
}
function restoreSavedCookieFiles(sourceProfileId, targetProfileId, files) {
  if (!Array.isArray(files)) return 0;
  const cookiesDir = path7.join(dataDir, "profiles_cookies");
  let restored = 0;
  for (const file of files) {
    if (typeof file?.name !== "string" || typeof file?.data !== "string") continue;
    const suffix = file.name.startsWith(`${sourceProfileId}_`) ? file.name.slice(sourceProfileId.length + 1) : file.name.replace(/^[^_]+_/, "");
    const safeSuffix = suffix.replace(/[^a-z0-9_.-]/gi, "");
    if (!safeSuffix.endsWith(".json")) continue;
    fs7.mkdirSync(cookiesDir, { recursive: true });
    fs7.writeFileSync(path7.join(cookiesDir, `${targetProfileId}_${safeSuffix}`), Buffer.from(file.data, "base64"));
    restored += 1;
  }
  return restored;
}
function buildProfileExportPayload(profile) {
  return {
    ...profile,
    browserCookieFiles: collectCookieFiles(profile.id),
    savedCookieFiles: collectSavedCookieFiles(profile.id)
  };
}
function mapImportedProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.fingerprint?.screen || raw.userAgent || raw.viewport) {
    const { browserCookieFiles, savedCookieFiles, ...profile } = raw;
    return profile;
  }
  const exportFingerprint = raw.fingerprint || {};
  const navigatorData = exportFingerprint.navigator || raw.navigator || {};
  const osData = exportFingerprint.os || raw.os || {};
  const os3 = isBrowserOS(osData.type) ? osData.type : inferImportedOS(navigatorData.userAgent, navigatorData.platform);
  const template = generateRandomFingerprint(os3);
  const resolution = parseResolution(navigatorData.resolution);
  const screen = exportFingerprint.osSpec?.screen || raw.osSpec?.screen || (resolution ? {
    width: resolution.width,
    height: resolution.height,
    colorDepth: 24,
    availWidth: resolution.width,
    availHeight: resolution.height,
    deviceScaleFactor: exportFingerprint.devicePixelRatio || 1
  } : template.screen);
  const proxy = raw.proxy?.host && raw.proxy?.port ? {
    server: `${raw.proxy.protocol || raw.proxyType || "http"}://${raw.proxy.host}:${raw.proxy.port}`,
    username: raw.proxy.username || void 0,
    password: raw.proxy.password || void 0
  } : void 0;
  return {
    name: raw.name || "Imported profile",
    notes: raw.notes || "",
    folderName: Array.isArray(raw.folders) ? raw.folders[0] : void 0,
    pinned: !!raw.isPinned,
    proxy,
    locationCountryCode: raw.proxyRegion || raw.proxy?.geo?.countryCode || void 0,
    extensionPaths: raw.userChromeExtensions || raw.chromeExtensions || exportFingerprint.userExtensionsToNewProfiles || [],
    fingerprint: {
      ...template,
      userAgent: navigatorData.userAgent || template.userAgent,
      platform: navigatorData.platform || osData.platform || template.platform,
      os: os3,
      chromeVersion: exportFingerprint.osSpec?.chromeVersion || raw.osSpec?.chromeVersion || template.chromeVersion,
      screen,
      webgl: {
        vendor: exportFingerprint.webGLMetadata?.vendor || raw.webGLMetadata?.vendor || template.webgl.vendor,
        renderer: exportFingerprint.webGLMetadata?.renderer || raw.webGLMetadata?.renderer || template.webgl.renderer,
        mode: exportFingerprint.webGLMetadata?.mode === "real" ? "off" : "noise"
      },
      hardware: {
        concurrency: Number(navigatorData.hardwareConcurrency) || template.hardware.concurrency,
        memory: Number(navigatorData.deviceMemory) || template.hardware.memory
      },
      maxTouchPoints: Number(navigatorData.maxTouchPoints) || template.maxTouchPoints,
      languages: exportFingerprint.osSpec?.languages || raw.osSpec?.languages || (navigatorData.language ? [navigatorData.language, String(navigatorData.language).split("-")[0]] : template.languages),
      timezone: raw.timezone?.id || exportFingerprint.osSpec?.timezone || template.timezone,
      geolocation: raw.geolocation?.latitude && raw.geolocation?.longitude ? raw.geolocation : template.geolocation,
      canvasMode: exportFingerprint.canvas?.mode === "block" ? "block" : exportFingerprint.canvas?.mode === "real" ? "off" : "noise",
      fonts: exportFingerprint.fonts || raw.fonts?.families || template.fonts,
      mediaDevices: {
        videoInput: Number(exportFingerprint.mediaDevices?.videoInputs) || template.mediaDevices.videoInput,
        audioInput: Number(exportFingerprint.mediaDevices?.audioInputs) || template.mediaDevices.audioInput,
        audioOutput: Number(exportFingerprint.mediaDevices?.audioOutputs) || template.mediaDevices.audioOutput
      },
      storage: {
        ...template.storage,
        lockSession: !!raw.lockEnabled
      }
    }
  };
}
function buildUniqueProfileId(existingIds, requestedId) {
  const cleanRequestedId = String(requestedId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
  if (cleanRequestedId && !existingIds.has(cleanRequestedId)) {
    existingIds.add(cleanRequestedId);
    return cleanRequestedId;
  }
  let id = Math.random().toString(36).slice(2, 11);
  while (existingIds.has(id)) id = Math.random().toString(36).slice(2, 11);
  existingIds.add(id);
  return id;
}
function saveProfiles(profiles) {
  writeJson("profiles.json", profiles);
  writeProfilesExport(profiles);
}
function readTextTail(file, maxChars = 18e3) {
  if (!fs7.existsSync(file)) return "";
  const stat = fs7.statSync(file);
  const start = Math.max(0, stat.size - maxChars);
  const fd = fs7.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs7.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs7.closeSync(fd);
  }
}
function readJsonFile2(file, fallback = null) {
  if (!fs7.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs7.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function findAvailablePort2(startPort = 9222) {
  return new Promise((resolve) => {
    const tryPort = (port2) => {
      const server = net2.createServer();
      server.once("error", () => tryPort(port2 + 1));
      server.once("listening", () => {
        server.close(() => resolve(port2));
      });
      server.listen(port2, "127.0.0.1");
    };
    tryPort(startPort);
  });
}
async function readChromeJson2(port2, pathName = "/json/version") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`http://127.0.0.1:${port2}${pathName}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Chrome CDP returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
function analyzeBrowserLog(log) {
  const lines = log.split("\n").map((line) => line.trim()).filter(Boolean);
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
    /net error:\s*-[0-9]+/i
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
    /Banner not shown/i
  ];
  const critical = [];
  const warnings = [];
  const noise = [];
  for (const line of lines) {
    if (criticalPatterns.some((pattern) => pattern.test(line))) critical.push(line);
    else if (noisePatterns.some((pattern) => pattern.test(line))) noise.push(line);
    else if (/\b(ERROR|WARNING)\b/i.test(line)) warnings.push(line);
  }
  return {
    critical: critical.slice(-20),
    warnings: warnings.slice(-20),
    noiseCount: noise.length
  };
}
function analyzeGoLoginCompatibility(input) {
  const { profile, preferences, launch, runtime, proxy, fingerprint } = input;
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const gologin = preferences?.gologin || {};
  const extensionSettings = preferences?.extensions?.settings || {};
  const staleProxyExtension = Object.values(extensionSettings).some((item) => {
    const extensionPath = String(item?.path || "");
    const extensionName = String(item?.manifest?.name || "");
    return extensionPath.includes("kct_proxy_auth_extension") || extensionName === "KCT Proxy Auth";
  });
  const foreignComponentExtensions = Object.values(extensionSettings).filter((item) => {
    const extensionPath = String(item?.path || "");
    return item?.location === 5 && (extensionPath.includes("/.gologin/browser/orbita-browser") || extensionPath.includes("/Applications/Google Chrome.app") || extensionPath.includes("/Applications/Chromium.app"));
  });
  const launchArgs = Array.isArray(launch?.args) ? launch.args : [];
  const proxyServer = proxy ? `${proxy.host}:${proxy.port}` : "";
  const savedProxyServer = gologin?.proxy?.server || "";
  const prefsProxyServer = preferences?.proxy?.server || "";
  const languages = Array.isArray(profile.fingerprint?.languages) ? profile.fingerprint.languages.join(",") : "";
  const expectedTimezone = profile.fingerprint?.timezone;
  add(
    "orbita-bundled",
    "Orbita ri\xEAng trong app",
    runtime?.orbitaBundled ? "pass" : "fail",
    runtime?.browser?.executable || "Kh\xF4ng t\xECm th\u1EA5y Orbita"
  );
  add(
    "orbita-fonts",
    "Font mask gi\u1ED1ng GoLogin",
    runtime?.fontsCount >= 200 ? "pass" : "warn",
    `${runtime?.fontsCount || 0} font proxy trong ${runtime?.fontsDir || "vendor/fonts"}`
  );
  add(
    "proxy-native",
    "Proxy ghi native cho Orbita",
    !proxy ? "warn" : savedProxyServer === proxyServer ? "pass" : "fail",
    !proxy ? "Profile kh\xF4ng ch\u1ECDn proxy" : `selected=${proxyServer}, gologin.proxy=${savedProxyServer || "tr\u1ED1ng"}`
  );
  add(
    "proxy-args",
    "Launch args d\xF9ng proxy",
    !proxy ? "warn" : launchArgs.some((arg) => arg === `--proxy-server=${proxy.protocol}://${proxyServer}`) ? "pass" : "fail",
    launchArgs.find((arg) => arg.startsWith("--proxy-server=")) || "Kh\xF4ng c\xF3 --proxy-server"
  );
  add(
    "proxy-pref-clean",
    "Proxy pref kh\xF4ng nh\xFAng credentials",
    !prefsProxyServer || !prefsProxyServer.includes("@") ? "pass" : "warn",
    prefsProxyServer || "Kh\xF4ng ghi preferences.proxy"
  );
  add(
    "geo-language",
    "Language theo IP/profile",
    gologin.languages === languages ? "pass" : "fail",
    `fingerprint=${languages || "-"}, gologin=${gologin.languages || "-"}`
  );
  add(
    "geo-timezone",
    "Timezone theo IP/profile",
    gologin?.timezone?.id === expectedTimezone ? "pass" : "fail",
    `fingerprint=${expectedTimezone || "-"}, gologin=${gologin?.timezone?.id || "-"}`
  );
  add(
    "google-signin",
    "Kh\xF4ng ch\u1EB7n Google sign-in",
    preferences?.signin?.allowed === false ? "fail" : "pass",
    `signin.allowed=${String(preferences?.signin?.allowed)}`
  );
  add(
    "no-kct-extension",
    "Kh\xF4ng c\xF2n extension proxy KCT",
    staleProxyExtension ? "fail" : "pass",
    staleProxyExtension ? "Preferences c\xF2n KCT Proxy Auth" : "S\u1EA1ch extension proxy c\u0169"
  );
  add(
    "no-foreign-components",
    "Kh\xF4ng tr\u1ECF v\u1EC1 GoLogin/Chrome ngo\xE0i app",
    foreignComponentExtensions.length ? "fail" : "pass",
    foreignComponentExtensions.length ? `${foreignComponentExtensions.length} component extension c\xF2n path ngo\xE0i app` : "S\u1EA1ch path component ngo\xE0i app"
  );
  add(
    "quic-disabled",
    "T\u1EAFt QUIC khi d\xF9ng proxy",
    launchArgs.includes("--disable-quic") ? "pass" : "warn",
    launchArgs.includes("--disable-quic") ? "C\xF3 --disable-quic" : "Ch\u01B0a c\xF3 --disable-quic trong l\u1EA7n launch g\u1EA7n nh\u1EA5t"
  );
  add(
    "dns-rules",
    "Kh\xF4ng ch\u1EB7n DNS Google",
    launchArgs.some((arg) => arg.startsWith("--host-resolver-rules=")) ? "fail" : "pass",
    launchArgs.find((arg) => arg.startsWith("--host-resolver-rules=")) || "Kh\xF4ng d\xF9ng host-resolver-rules"
  );
  add(
    "fingerprint-core",
    "Core fingerprint Orbita",
    gologin.userAgent && gologin.webGl && gologin.audioContext && gologin.mediaDevices ? "pass" : "fail",
    `UA=${gologin.userAgent ? "ok" : "missing"}, WebGL=${gologin.webGl ? "ok" : "missing"}, Audio=${gologin.audioContext ? "ok" : "missing"}, Media=${gologin.mediaDevices ? "ok" : "missing"}`
  );
  add(
    "profile-extensions",
    "Extension theo profile",
    Array.isArray(profile.extensionPaths) && profile.extensionPaths.length ? launchArgs.some((arg) => arg.startsWith("--load-extension=")) ? "pass" : "fail" : "warn",
    Array.isArray(profile.extensionPaths) && profile.extensionPaths.length ? launchArgs.find((arg) => arg.startsWith("--load-extension=")) || "Ch\u01B0a load extension trong l\u1EA7n launch g\u1EA7n nh\u1EA5t" : "Profile ch\u01B0a c\u1EA5u h\xECnh extension"
  );
  return {
    score: checks.filter((check) => check.status === "pass").length,
    total: checks.length,
    checks,
    lastLaunchAt: launch?.launchedAt || null,
    reference: {
      source: "Local GoLogin Orbita layout + Orbita Preferences keys",
      note: "GoLogin profile cache tr\xEAn m\xE1y kh\xF4ng c\xF2n Preferences m\u1EABu \u0111\u1EA7y \u0111\u1EE7, n\xEAn audit d\u1EF1a tr\xEAn Orbita binary, fonts folder, launch args v\xE0 gologin.* prefs th\u1EF1c t\u1EBF."
    },
    savedFingerprintKeys: Object.keys(fingerprint?.fingerprint || {}).sort()
  };
}
function analyzeFingerprintConsistency(profile, proxy) {
  const fingerprint = normalizeFingerprint({
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    fingerprint: profile.fingerprint
  });
  const issues = [];
  const renderer = fingerprint.webgl?.renderer || "";
  const ua = fingerprint.userAgent || "";
  const isWindows = fingerprint.os === "windows";
  const isAndroid = fingerprint.os === "android";
  const add = (id, status, detail) => issues.push({ id, status, detail });
  add("ua-os", isWindows ? ua.includes("Windows NT") ? "pass" : "fail" : isAndroid ? /Android|Mobile/i.test(ua) ? "pass" : "fail" : ua.includes("Macintosh") ? "pass" : "fail", `${fingerprint.os} / ${ua}`);
  add("platform-os", isWindows ? fingerprint.platform === "Win32" ? "pass" : "fail" : isAndroid ? /Linux arm/i.test(fingerprint.platform) ? "pass" : "fail" : fingerprint.platform === "MacIntel" ? "pass" : "fail", fingerprint.platform);
  add("webgl-os", isWindows ? /Direct3D|D3D11/i.test(renderer) ? "pass" : "fail" : isAndroid ? /Adreno|Mali|PowerVR/i.test(renderer) ? "pass" : "fail" : !/Direct3D|D3D11/i.test(renderer) && /Apple|OpenGL Engine|Radeon/i.test(renderer) ? "pass" : "fail", renderer);
  add("touch-profile", isAndroid ? (fingerprint.maxTouchPoints || 0) > 0 ? "pass" : "fail" : (fingerprint.maxTouchPoints || 0) === 0 ? "pass" : "warn", `${fingerprint.maxTouchPoints || 0} touch points`);
  add("hardware-range", fingerprint.hardware.concurrency >= 2 && fingerprint.hardware.concurrency <= 16 && [2, 4, 8, 16].includes(fingerprint.hardware.memory) ? "pass" : "warn", `${fingerprint.hardware.concurrency} cores / ${fingerprint.hardware.memory}GB`);
  add("locale-proxy", proxy?.geo ? proxy.geo.timezone === fingerprint.timezone ? "pass" : "warn" : "warn", proxy?.geo ? `${proxy.geo.countryCode} ${proxy.geo.timezone} / ${fingerprint.timezone}` : "No proxy geo");
  add("font-os", fingerprint.fonts?.length ? "pass" : "fail", `${fingerprint.fonts?.slice(0, 6).join(", ")}`);
  add("chrome-version", fingerprint.chromeVersion.startsWith("146.") ? "pass" : "warn", fingerprint.chromeVersion);
  return {
    ok: issues.every((issue) => issue.status === "pass"),
    issues
  };
}
async function getProxyWithGeo(proxyId) {
  if (!proxyId) return null;
  let proxy = proxyService.getById(proxyId);
  if (!proxy) return null;
  if (!proxy.geo && proxy.status !== "dead") {
    const checkedProxy = await proxyService.checkProxy(proxyId).catch(() => proxyService.getById(proxyId));
    if (checkedProxy) proxy = checkedProxy;
  }
  return proxy;
}
async function normalizeProfileFingerprint(input, fallback) {
  const fingerprint = normalizeFingerprint({
    userAgent: input.userAgent || input.fingerprint?.userAgent || fallback?.userAgent || "",
    viewport: input.viewport || fallback?.viewport || { width: 1920, height: 1080 },
    fingerprint: input.fingerprint || fallback?.fingerprint || generateRandomFingerprint()
  });
  const proxyId = input.proxyId === void 0 ? fallback?.proxyId : input.proxyId;
  if (proxyId) {
    const proxy = await getProxyWithGeo(proxyId);
    if (proxy?.geo) return applyGeoToFingerprint(fingerprint, proxy.geo);
  }
  const customProxy = input.proxy === void 0 ? fallback?.proxy : input.proxy;
  if (!proxyId && customProxy?.server) {
    const proxy = await proxyService.checkCustomProxy(customProxy.server, customProxy.username, customProxy.password).catch(() => null);
    if (proxy?.geo) return applyGeoToFingerprint(fingerprint, proxy.geo);
  }
  const countryCode = input.locationCountryCode || fallback?.locationCountryCode;
  if (countryCode) return applyGeoToFingerprint(fingerprint, { countryCode });
  return fingerprint;
}
async function prepareProfileForLaunch(profileId) {
  const profiles = loadProfiles2();
  const index = profiles.findIndex((item) => item.id === profileId);
  if (index === -1) return null;
  const existing = profiles[index];
  const fingerprint = await normalizeProfileFingerprint(existing);
  const prepared = {
    ...existing,
    fingerprint,
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    updatedAt: Date.now()
  };
  profiles[index] = prepared;
  saveProfiles(profiles);
  return prepared;
}
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "kctlogin" });
});
app.get("/api/runtime", (_req, res) => {
  try {
    res.json({
      ...browserService.getRuntimeInfo(),
      storage: getDataDirInfo()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/remove-gemini-logo", async (req, res) => {
  try {
    const parsed = parseImageDataUrl(req.body?.imageDataUrl);
    if (!parsed) {
      return res.status(400).json({ error: "Vui l\xF2ng upload \u1EA3nh PNG, JPG ho\u1EB7c WebP h\u1EE3p l\u1EC7." });
    }
    if (parsed.buffer.byteLength > 40 * 1024 * 1024) {
      return res.status(413).json({ error: "\u1EA2nh qu\xE1 l\u1EDBn. Vui l\xF2ng d\xF9ng \u1EA3nh d\u01B0\u1EDBi 40MB." });
    }
    const result = await removeWatermarkFromBuffer(parsed.buffer, {
      mimeType: parsed.mimeType,
      decodeImageData,
      encodeImageData
    });
    res.json({
      imageDataUrl: `data:image/png;base64,${result.buffer.toString("base64")}`,
      mimeType: "image/png",
      meta: result.meta
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Kh\xF4ng th\u1EC3 remove logo Gemini." });
  }
});
app.post("/api/remove-veo-logo", veoUpload.single("video"), async (req, res) => {
  const tempDir = path7.join(os2.tmpdir(), `kct-veo-${randomUUID()}`);
  let inputPath = "";
  let outputPath = "";
  try {
    if (!req.file) return res.status(400).json({ error: "Vui l\xF2ng upload video." });
    fs7.mkdirSync(tempDir, { recursive: true });
    const extension = path7.extname(req.file.originalname || "").toLowerCase() || ".mp4";
    inputPath = path7.join(tempDir, `input${extension}`);
    outputPath = path7.join(tempDir, "veo-logo-removed.mp4");
    fs7.writeFileSync(inputPath, req.file.buffer);
    const requestedZoom = Number(req.body?.zoom || 1.12);
    const zoom = Number.isFinite(requestedZoom) ? Math.min(Math.max(requestedZoom, 1), 1.35) : 1.12;
    const { width, height } = await getVideoSize(inputPath);
    const filter = buildVeoZoomFilter(width, height, zoom);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ], { maxBuffer: 10 * 1024 * 1024 });
    res.download(outputPath, `${path7.parse(req.file.originalname || "video").name}-veo-logo-removed.mp4`, (downloadError) => {
      fs7.rmSync(tempDir, { recursive: true, force: true });
      if (downloadError && !res.headersSent) {
        res.status(500).json({ error: downloadError.message });
      }
    });
  } catch (error) {
    fs7.rmSync(tempDir, { recursive: true, force: true });
    res.status(500).json({
      error: error.message?.includes("ffmpeg") || error.stderr ? "Kh\xF4ng th\u1EC3 x\u1EED l\xFD video b\u1EB1ng ffmpeg. Vui l\xF2ng ki\u1EC3m tra video \u0111\u1EA7u v\xE0o." : error.message || "Kh\xF4ng th\u1EC3 remove logo VEO."
    });
  }
});
app.get("/api/mcp", (_req, res) => {
  res.json({
    name: "kctlogin",
    transport: "stdio",
    command: "npm",
    args: ["run", "mcp:stdio"],
    cwd: process.cwd(),
    tools: MCP_TOOL_NAMES
  });
});
app.get("/api/tokens", (_req, res) => {
  res.json(apiTokenService.list());
});
app.post("/api/tokens", (req, res) => {
  const token = apiTokenService.create(req.body?.name || "API token");
  res.json(token);
});
app.delete("/api/tokens/:id", (req, res) => {
  res.json({ success: apiTokenService.delete(req.params.id) });
});
app.get("/api/remote-chrome/sessions", (_req, res) => {
  res.json(browserService.getRemoteSessions());
});
app.post("/api/remote-chrome/:id/start", async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  try {
    const requestedPort = Number(req.body?.port || 0);
    const port2 = requestedPort > 0 ? requestedPort : await findAvailablePort2(9222);
    await browserService.launchProfile(profile, {
      mode: "remote",
      url: req.body?.url,
      remoteDebuggingPort: port2
    });
    let version = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        version = await readChromeJson2(port2, "/json/version");
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    res.json({
      success: true,
      profileId: profile.id,
      port: port2,
      versionUrl: `http://127.0.0.1:${port2}/json/version`,
      tabsUrl: `http://127.0.0.1:${port2}/json/list`,
      webSocketDebuggerUrl: version?.webSocketDebuggerUrl || null,
      version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/remote-chrome/:id/version", async (req, res) => {
  const session = browserService.getRemoteSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Remote Chrome session not found" });
  try {
    res.json(await readChromeJson2(session.port, "/json/version"));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/verify/:id", (req, res) => {
  const profile = loadProfiles2().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).send("Profile not found");
  res.type("html").send(`<!doctype html>
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
  <p id="status">\u0110ang \u0111o fingerprint...</p>
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
app.get("/api/fingerprint/random", async (req, res) => {
  const os3 = req.query.os === "android" ? "android" : req.query.os === "mac" ? "mac" : req.query.os === "windows" ? "windows" : void 0;
  const deviceCategory = req.query.deviceCategory === "desktop" ? "desktop" : req.query.deviceCategory === "tablet" ? "tablet" : req.query.deviceCategory === "mobile" ? "mobile" : void 0;
  let fingerprint = generateRandomFingerprint(os3, void 0, deviceCategory);
  const proxyId = typeof req.query.proxyId === "string" ? req.query.proxyId : void 0;
  const countryCode = typeof req.query.countryCode === "string" ? req.query.countryCode : void 0;
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
app.get("/api/profiles", async (_req, res) => {
  const profiles = await Promise.all(loadProfiles2().map(async (profile) => {
    let fingerprint = normalizeFingerprint({
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      fingerprint: profile.fingerprint
    });
    const proxy = await getProxyWithGeo(profile.proxyId);
    if (proxy?.geo) fingerprint = applyGeoToFingerprint(fingerprint, proxy.geo);
    else if (profile.locationCountryCode) fingerprint = applyGeoToFingerprint(fingerprint, { countryCode: profile.locationCountryCode });
    return {
      ...profile,
      fingerprint,
      isRunning: browserService.isProfileRunning(profile.id)
    };
  }));
  res.json(profiles);
});
app.get("/api/profiles/export", (_req, res) => {
  const profiles = loadProfiles2();
  const fileName = `kctlogin-profiles-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.json({
    format: "kctlogin-profiles-v2",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    count: profiles.length,
    includes: {
      profiles: true,
      browserCookieFiles: true,
      savedCookieFiles: true
    },
    profiles: profiles.map(buildProfileExportPayload)
  });
});
app.post("/api/profiles/import", async (req, res) => {
  const items = getImportProfileItems(req.body);
  if (!items.length) return res.status(400).json({ error: "File kh\xF4ng c\xF3 danh s\xE1ch profiles h\u1EE3p l\u1EC7." });
  const profiles = loadProfiles2();
  const existingIds = new Set(profiles.map((profile) => profile.id).filter(Boolean));
  const imported = [];
  const skipped = [];
  for (const [index, item] of items.entries()) {
    try {
      const mapped = mapImportedProfile(item);
      if (!mapped) {
        skipped.push({ index, reason: "D\u1EEF li\u1EC7u profile kh\xF4ng h\u1EE3p l\u1EC7" });
        continue;
      }
      const id = buildUniqueProfileId(existingIds, mapped.id);
      const fallbackFingerprint = generateRandomFingerprint();
      const fingerprint = normalizeFingerprint({
        userAgent: mapped.userAgent || mapped.fingerprint?.userAgent || fallbackFingerprint.userAgent,
        viewport: mapped.viewport || {
          width: mapped.fingerprint?.screen?.width || fallbackFingerprint.screen.width,
          height: mapped.fingerprint?.screen?.height || fallbackFingerprint.screen.height
        },
        fingerprint: mapped.fingerprint || fallbackFingerprint
      });
      const profile = {
        ...mapped,
        id,
        name: String(mapped.name || `Imported profile ${imported.length + 1}`),
        isRunning: false,
        createdAt: typeof mapped.createdAt === "number" ? mapped.createdAt : Date.now(),
        updatedAt: Date.now(),
        userAgent: fingerprint.userAgent,
        viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
        fingerprint
      };
      if (profile.proxyId && !proxyService.getById(profile.proxyId)) delete profile.proxyId;
      delete profile.settingsTab;
      profiles.push(profile);
      imported.push(profile);
      fs7.mkdirSync(path7.join(profilesDataDir, id), { recursive: true });
      restoreCookieFiles(id, item?.browserCookieFiles);
      restoreSavedCookieFiles(String(item?.id || mapped.id || ""), id, item?.savedCookieFiles);
    } catch (error) {
      skipped.push({ index, reason: error.message || "Kh\xF4ng import \u0111\u01B0\u1EE3c profile" });
    }
  }
  if (!imported.length) return res.status(400).json({ error: "Kh\xF4ng import \u0111\u01B0\u1EE3c profile n\xE0o.", skipped });
  saveProfiles(profiles);
  res.json({ success: true, imported: imported.length, skipped });
});
app.post("/api/profiles", async (req, res) => {
  const profiles = loadProfiles2();
  const fingerprint = await normalizeProfileFingerprint(req.body);
  const profile = {
    ...req.body,
    id: Math.random().toString(36).slice(2, 11),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    fingerprint
  };
  profiles.push(profile);
  saveProfiles(profiles);
  res.json(profile);
});
app.put("/api/profiles/:id", async (req, res) => {
  const profiles = loadProfiles2();
  const index = profiles.findIndex((profile) => profile.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Profile not found" });
  const updated = { ...profiles[index], ...req.body, id: req.params.id, createdAt: profiles[index].createdAt, updatedAt: Date.now() };
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
app.delete("/api/profiles/:id", async (req, res) => {
  const id = req.params.id;
  await browserService.stopProfile(id).catch(() => {
  });
  const dir = path7.join(profilesDataDir, id);
  if (fs7.existsSync(dir)) fs7.rmSync(dir, { recursive: true, force: true });
  saveProfiles(loadProfiles2().filter((profile) => profile.id !== id));
  res.json({ success: true });
});
app.post("/api/profiles/:id/clone", async (req, res) => {
  const sourceId = req.params.id;
  const profiles = loadProfiles2();
  const source = profiles.find((profile) => profile.id === sourceId);
  if (!source) return res.status(404).json({ error: "Source profile not found" });
  const fingerprint = await normalizeProfileFingerprint(req.body, source);
  const nextId = Math.random().toString(36).slice(2, 11);
  const cloned = {
    ...source,
    ...req.body,
    id: nextId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: fingerprint.userAgent,
    viewport: { width: fingerprint.screen.width, height: fingerprint.screen.height },
    fingerprint
  };
  const sourceDir = path7.join(profilesDataDir, sourceId);
  const targetDir = path7.join(profilesDataDir, nextId);
  const cloneBrowserData = req.body?.cloneBrowserData === true;
  if (cloneBrowserData && fs7.existsSync(sourceDir)) {
    fs7.cpSync(sourceDir, targetDir, { recursive: true });
    for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const lockPath = path7.join(targetDir, lock);
      if (fs7.existsSync(lockPath)) fs7.rmSync(lockPath, { force: true });
    }
    for (const snapshot of ["kct-last-launch.json", "kct-verify-report.json"]) {
      const snapshotPath = path7.join(targetDir, snapshot);
      if (fs7.existsSync(snapshotPath)) fs7.rmSync(snapshotPath, { force: true });
    }
  } else {
    fs7.mkdirSync(targetDir, { recursive: true });
  }
  if (req.body?.cloneCookies === true || cloneBrowserData) {
    for (const platform of ["chatgpt", "gemini"]) {
      const sourceCookie = getCookiesPath(sourceId, platform);
      const targetCookie = getCookiesPath(nextId, platform);
      if (fs7.existsSync(sourceCookie)) {
        fs7.mkdirSync(path7.dirname(targetCookie), { recursive: true });
        fs7.copyFileSync(sourceCookie, targetCookie);
      }
    }
  }
  profiles.push(cloned);
  saveProfiles(profiles);
  res.json(cloned);
});
app.post("/api/profiles/:id/launch", async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  try {
    const result = await browserService.launchProfile(profile, { mode: "visible" });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/profiles/:id/diagnostics", async (req, res) => {
  const profile = loadProfiles2().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const profileDir = path7.join(profilesDataDir, profile.id);
  const preferences = readJsonFile2(path7.join(profileDir, "Default", "Preferences"), {});
  const securePreferences = readJsonFile2(path7.join(profileDir, "Default", "Secure Preferences"), {});
  const fingerprint = readJsonFile2(path7.join(profileDir, "kct-orbita-fingerprint.json"), null);
  const verifyReport = readJsonFile2(path7.join(profileDir, "kct-verify-report.json"), null);
  const launch = readJsonFile2(path7.join(profileDir, "kct-last-launch.json"), null);
  const proxy = profile.proxyId ? proxyService.getById(profile.proxyId) : profile.proxy?.server ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password) : null;
  const log = readTextTail(path7.join(profileDir, "chrome_debug.log"));
  const runtime = browserService.getRuntimeInfo();
  res.json({
    profile: {
      id: profile.id,
      name: profile.name,
      isRunning: browserService.isProfileRunning(profile.id),
      profileDir
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
    logAnalysis: analyzeBrowserLog(log)
  });
});
app.post("/api/profiles/:id/verify-report", (req, res) => {
  const profile = loadProfiles2().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const report = req.body || {};
  const expected = profile.fingerprint;
  const checks = [
    { id: "userAgent", pass: report.userAgent === expected.userAgent, expected: expected.userAgent, actual: report.userAgent },
    { id: "platform", pass: report.platform === expected.platform, expected: expected.platform, actual: report.platform },
    { id: "timezone", pass: report.timezone === expected.timezone, expected: expected.timezone, actual: report.timezone },
    { id: "languages", pass: Array.isArray(report.languages) && expected.languages.every((item, index) => report.languages[index] === item), expected: expected.languages, actual: report.languages },
    { id: "webdriver", pass: report.webdriver !== true, expected: "not true", actual: report.webdriver },
    { id: "hardwareConcurrency", pass: !expected.hardware?.concurrency || report.hardwareConcurrency === expected.hardware.concurrency, expected: expected.hardware?.concurrency, actual: report.hardwareConcurrency },
    { id: "deviceMemory", pass: !expected.hardware?.memory || report.deviceMemory === expected.hardware.memory, expected: expected.hardware?.memory, actual: report.deviceMemory }
  ];
  const result = {
    ok: checks.every((check) => check.pass),
    profileId: profile.id,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    checks,
    report
  };
  const profileDir = path7.join(profilesDataDir, profile.id);
  fs7.mkdirSync(profileDir, { recursive: true });
  fs7.writeFileSync(path7.join(profileDir, "kct-verify-report.json"), JSON.stringify(result, null, 2));
  res.json(result);
});
app.post("/api/profiles/:id/check-proxy", async (req, res) => {
  const profile = loadProfiles2().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  if (!profile.proxyId && !profile.proxy?.server) return res.status(400).json({ error: "Profile ch\u01B0a ch\u1ECDn proxy" });
  try {
    if (profile.proxyId) res.json(await proxyService.checkProxy(profile.proxyId));
    else res.json(await proxyService.checkCustomProxy(profile.proxy.server, profile.proxy?.username, profile.proxy?.password));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/profiles/:id/check-google", async (req, res) => {
  const profile = loadProfiles2().find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  const proxy = profile.proxyId ? proxyService.getById(profile.proxyId) : profile.proxy?.server ? proxyService.parseCustomProxy(profile.proxy.server, profile.proxy.username, profile.proxy.password) : null;
  if (!proxy) return res.status(400).json({ error: "Profile ch\u01B0a ch\u1ECDn proxy" });
  try {
    const targets = ["https://accounts.google.com", "https://gemini.google.com", "https://play.google.com/log?format=json"];
    const results = await Promise.all(targets.map((target) => proxyService.checkTarget(proxy, target)));
    res.json({ ok: results.every((result) => result.ok), results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/profiles/:id/login", async (req, res) => {
  const profile = await prepareProfileForLaunch(req.params.id);
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  try {
    await browserService.launchProfile(profile, { mode: "login", url: req.body?.url });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/profiles/:id/stop", async (req, res) => {
  await browserService.stopProfile(req.params.id);
  saveProfiles(loadProfiles2().map((item) => item.id === req.params.id ? { ...item, updatedAt: Date.now() } : item));
  res.json({ success: true });
});
app.post("/api/profiles/:id/repair", async (req, res) => {
  if (!loadProfiles2().some((profile) => profile.id === req.params.id)) return res.status(404).json({ error: "Profile not found" });
  try {
    res.json(await browserService.repairProfile(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/profiles/:id/logout", async (req, res) => {
  const id = req.params.id;
  await browserService.stopProfile(id).catch(() => {
  });
  for (const platform of ["chatgpt", "gemini"]) {
    const file = getCookiesPath(id, platform);
    if (fs7.existsSync(file)) fs7.unlinkSync(file);
  }
  res.json({ success: true });
});
app.get("/api/profiles/:id/cookies/:platform", (req, res) => {
  const platform = req.params.platform;
  if (!["chatgpt", "gemini"].includes(platform)) return res.status(400).json({ error: "Invalid platform" });
  if (!loadProfiles2().some((profile) => profile.id === req.params.id)) return res.status(404).json({ error: "Profile not found" });
  const cookies = loadCookies(req.params.id, platform);
  const format = String(req.query.format || "json");
  if (format === "netscape" || format === "header") {
    res.type("text/plain").send(exportCookies(cookies, format));
    return;
  }
  res.json({ cookies });
});
app.post("/api/profiles/:id/cookies/:platform", (req, res) => {
  const platform = req.params.platform;
  if (!["chatgpt", "gemini"].includes(platform)) return res.status(400).json({ error: "Invalid platform" });
  const cookies = parseCookieInput(req.body.cookies ?? req.body.text ?? req.body, req.body.domain);
  if (!cookies.length) return res.status(400).json({ error: "Kh\xF4ng parse \u0111\u01B0\u1EE3c cookie. H\u1ED7 tr\u1EE3 JSON array, object {cookies}, Netscape, ho\u1EB7c header name=value; name2=value2 k\xE8m domain." });
  saveCookies(req.params.id, platform, cookies);
  res.json({ success: true, count: cookies.length, cookies });
});
app.post("/api/profiles/:id/import-cookies", async (req, res) => {
  const { cookies, text, platform = "gemini", domain } = req.body;
  const parsed = parseCookieInput(cookies ?? text, domain);
  if (!parsed.length) return res.status(400).json({ error: "Kh\xF4ng parse \u0111\u01B0\u1EE3c cookie import" });
  const converted = cleanCookiesForPlaywright(parsed);
  saveCookies(req.params.id, platform, converted);
  res.json({ success: true, count: converted.length, platform, cookies: converted });
});
app.get("/api/proxies", (_req, res) => {
  res.json(proxyService.getAll());
});
app.post("/api/proxies", (req, res) => {
  if (!req.body.input) return res.status(400).json({ error: "input is required" });
  res.json(proxyService.addProxies(req.body.input, req.body.group));
});
app.post("/api/proxies/fetch-free", async (_req, res) => {
  try {
    res.json(await proxyService.fetchFreeProxies());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/proxies/check", async (req, res) => {
  const { ids, concurrency } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array is required" });
  if (ids.length === 1) return res.json(await proxyService.checkProxy(ids[0]));
  res.json(await proxyService.checkBatch(ids, concurrency || 3));
});
app.put("/api/proxies/:id", (req, res) => {
  const updated = proxyService.updateProxy(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Proxy not found" });
  res.json(updated);
});
app.delete("/api/proxies/:id", (req, res) => {
  proxyService.deleteProxy(req.params.id);
  res.json({ success: true });
});
app.get("/api/proxy-devices", (_req, res) => {
  res.json(proxyDeviceService.getAll());
});
app.get("/api/proxy-devices/network", (_req, res) => {
  const interfaces = os2.networkInterfaces();
  const addresses = Object.entries(interfaces).flatMap(([name, items]) => (items || []).filter((item) => item.family === "IPv4" && !item.internal).map((item) => ({ name, address: item.address, cidr: item.cidr })));
  res.json({ addresses });
});
app.post("/api/proxy-devices", (req, res) => {
  try {
    res.json(proxyDeviceService.create(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.put("/api/proxy-devices/:id", (req, res) => {
  const updated = proxyDeviceService.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Proxy device not found" });
  res.json(updated);
});
app.delete("/api/proxy-devices/:id", (req, res) => {
  res.json({ success: proxyDeviceService.delete(req.params.id) });
});
app.post("/api/proxy-devices/:id/check", async (req, res) => {
  try {
    res.json(await proxyDeviceService.check(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/proxy-devices/:id/add-proxy", (req, res) => {
  try {
    res.json(proxyDeviceService.addToProxyManager(req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
var distDir = path7.join(process.env.KCT_APP_ROOT || process.cwd(), "dist");
if (fs7.existsSync(path7.join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|verify\/).*/, (_req, res) => {
    res.sendFile(path7.join(distDir, "index.html"));
  });
}
app.listen(port, () => {
  console.log(`[KCTLogin] Server running at http://localhost:${port}`);
});
