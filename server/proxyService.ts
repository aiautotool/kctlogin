import { chromium, type Browser } from 'playwright';
import axios from 'axios';
import { readJson, writeJson } from './jsonStore';

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export interface ProxyGeo {
  country: string;
  countryCode: string;
  city: string;
  timezone: string;
  isp: string;
  ip: string;
  latitude?: number;
  longitude?: number;
}

export interface Proxy {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: ProxyProtocol;
  status: 'alive' | 'dead' | 'checking' | 'unknown';
  geo?: ProxyGeo;
  latency?: number;
  lastChecked?: number;
  createdAt?: number;
  group?: string;
}

export class ProxyParser {
  static parse(input: string): Partial<Proxy>[] {
    const lines = input.split(/[\n,;]/).map((line) => line.trim()).filter(Boolean);
    const results: Partial<Proxy>[] = [];

    for (const line of lines) {
      try {
        if (line.includes('://')) {
          const url = new URL(line);
          results.push({
            protocol: url.protocol.replace(':', '') as ProxyProtocol,
            host: url.hostname,
            port: Number(url.port),
            username: url.username || undefined,
            password: url.password || undefined,
          });
          continue;
        }

        const parts = line.split(':');
        if (parts.length === 2 || parts.length === 4) {
          results.push({
            protocol: 'http',
            host: parts[0],
            port: Number(parts[1]),
            username: parts[2] || undefined,
            password: parts[3] || undefined,
          });
        }
      } catch (error) {
        console.warn('[ProxyParser] Skip proxy:', line, error);
      }
    }

    return results;
  }
}

class ProxyService {
  private proxies: Proxy[] = [];

  constructor() {
    this.proxies = readJson<Proxy[]>('proxies.json', []);
  }

  private save() {
    writeJson('proxies.json', this.proxies);
  }

  getAll() {
    return [...this.proxies].sort((a, b) => (b.createdAt || b.lastChecked || 0) - (a.createdAt || a.lastChecked || 0));
  }

  getById(id: string) {
    return this.proxies.find((proxy) => proxy.id === id);
  }

  addProxies(input: string, group = 'Imported') {
    const added: Proxy[] = [];
    for (const parsed of ProxyParser.parse(input)) {
      if (!parsed.host || !parsed.port || Number.isNaN(parsed.port)) continue;
      const proxy: Proxy = {
        id: Math.random().toString(36).slice(2, 9),
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
        protocol: parsed.protocol || 'http',
        status: 'unknown',
        createdAt: Date.now(),
        group,
      };
      this.proxies.unshift(proxy);
      added.push(proxy);
    }
    this.save();
    return added;
  }

  updateProxy(id: string, updates: Partial<Proxy>) {
    const index = this.proxies.findIndex((proxy) => proxy.id === id);
    if (index === -1) return null;
    this.proxies[index] = { ...this.proxies[index], ...updates };
    this.save();
    return this.proxies[index];
  }

  deleteProxy(id: string) {
    this.proxies = this.proxies.filter((proxy) => proxy.id !== id);
    this.save();
  }

  private async probeProxy(proxy: Proxy) {
    let browser: Browser | null = null;
    const startedAt = Date.now();

    try {
      let geo: any;
      if (proxy.protocol === 'http' || proxy.protocol === 'https') {
        const response = await axios.get('http://ip-api.com/json', {
          timeout: 20000,
          proxy: {
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username && proxy.password ? {
              username: proxy.username,
              password: proxy.password,
            } : undefined,
          },
        });
        geo = response.data;
      } else {
        browser = await chromium.launch({
          headless: true,
          proxy: {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password,
          },
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('http://ip-api.com/json', { waitUntil: 'domcontentloaded', timeout: 20000 });
        geo = JSON.parse(await page.textContent('body') || '{}');
      }

      if (geo.status !== 'success') throw new Error(geo.message || 'IP API failed');

      return {
        ...proxy,
        status: 'alive' as const,
        latency: Date.now() - startedAt,
        lastChecked: Date.now(),
        geo: {
          ip: geo.query,
          country: geo.country,
          countryCode: geo.countryCode,
          city: geo.city,
          timezone: geo.timezone,
          isp: geo.isp,
          latitude: typeof geo.lat === 'number' ? geo.lat : undefined,
          longitude: typeof geo.lon === 'number' ? geo.lon : undefined,
        },
      };
    } catch (error: any) {
      console.warn(`[ProxyService] Check failed for ${proxy.host}:${proxy.port}: ${error.message}`);
      return {
        ...proxy,
        status: 'dead' as const,
        latency: -1,
        lastChecked: Date.now(),
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  parseCustomProxy(server: string, username?: string, password?: string): Proxy | null {
    const parsed = ProxyParser.parse(server)[0];
    if (!parsed?.host || !parsed.port || Number.isNaN(parsed.port)) return null;
    return {
      id: 'custom',
      host: parsed.host,
      port: parsed.port,
      username: parsed.username || username,
      password: parsed.password || password,
      protocol: parsed.protocol || 'http',
      status: 'unknown',
      group: 'Custom',
    };
  }

  async checkCustomProxy(server: string, username?: string, password?: string) {
    const proxy = this.parseCustomProxy(server, username, password);
    if (!proxy) throw new Error('Custom proxy không hợp lệ');
    return this.probeProxy(proxy);
  }

  async checkTarget(proxy: Proxy, target = 'https://accounts.google.com') {
    const startedAt = Date.now();
    let browser: Browser | null = null;
    try {
      if (proxy.protocol === 'http' || proxy.protocol === 'https') {
        const response = await axios.get(target, {
          timeout: 20000,
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 500,
          proxy: {
            protocol: proxy.protocol,
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username && proxy.password ? {
              username: proxy.username,
              password: proxy.password,
            } : undefined,
          },
        });
        return {
          ok: true,
          target,
          status: response.status,
          latency: Date.now() - startedAt,
          finalUrl: response.request?.res?.responseUrl || target,
        };
      }

      browser = await chromium.launch({
        headless: true,
        proxy: {
          server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
          username: proxy.username,
          password: proxy.password,
        },
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
      return {
        ok: !!response && response.status() < 500,
        target,
        status: response?.status() || 0,
        latency: Date.now() - startedAt,
        finalUrl: page.url(),
      };
    } catch (error: any) {
      return {
        ok: false,
        target,
        status: 0,
        latency: Date.now() - startedAt,
        error: error.message,
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  async checkProxy(id: string) {
    const proxy = this.getById(id);
    if (!proxy) throw new Error('Proxy not found');

    this.updateProxy(id, { status: 'checking' });
    const checked = await this.probeProxy(proxy);
    return this.updateProxy(id, checked);
  }

  async checkBatch(ids: string[], concurrency = 3) {
    const results: Proxy[] = [];
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
      'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
      'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    ];

    let input = '';
    for (const source of sources) {
      try {
        const response = await axios.get(source, { timeout: 10000 });
        input += `${response.data}\n`;
      } catch {
        console.warn(`[ProxyService] Fetch failed: ${source}`);
      }
    }

    const lines = input.split('\n').filter(Boolean).slice(0, 100);
    return this.addProxies(lines.join('\n'), 'Free Scraped');
  }
}

export const proxyService = new ProxyService();
