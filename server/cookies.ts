import fs from 'fs';
import path from 'path';
import { getDataDir } from './dataDir';

export function getCookiesPath(profileId: string, platform: string): string {
  return path.join(getDataDir(), 'profiles_cookies', `${profileId}_${platform}.json`);
}

export function loadCookies(profileId: string, platform: string): any[] {
  const file = getCookiesPath(profileId, platform);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCookies(profileId: string, platform: string, cookies: any[]): void {
  const dir = path.join(getDataDir(), 'profiles_cookies');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCookiesPath(profileId, platform), JSON.stringify(normalizeCookies(cookies), null, 2));
}

function cookieKey(cookie: any): string {
  return [cookie?.name || '', cookie?.domain || '', cookie?.path || '/'].join('||');
}

export function persistCookies(profileId: string, platform: string, cookies: any[]): any[] {
  const merged = new Map<string, any>();
  for (const cookie of loadCookies(profileId, platform)) {
    if (cookie?.name && typeof cookie.value === 'string') merged.set(cookieKey(cookie), cookie);
  }
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (cookie?.name && typeof cookie.value === 'string') merged.set(cookieKey(cookie), cookie);
  }
  const next = Array.from(merged.values());
  if (next.length) saveCookies(profileId, platform, next);
  return next;
}

function sameSiteValue(value: any) {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  if (lower === 'strict') return 'Strict';
  if (lower === 'lax') return 'Lax';
  if (lower === 'none' || lower === 'no_restriction') return 'None';
  return undefined;
}

function normalizeCookie(cookie: any) {
  if (!cookie || typeof cookie !== 'object') return null;
  const cleaned: any = { ...cookie };
  if (!cleaned.name && cleaned.key) cleaned.name = cleaned.key;
  if (cleaned.value === undefined && cleaned.val !== undefined) cleaned.value = cleaned.val;
  if (cleaned.value === undefined || cleaned.value === null) cleaned.value = '';
  cleaned.value = String(cleaned.value);
  if (!cleaned.name) return null;

  if ('expirationDate' in cleaned) cleaned.expires = cleaned.expirationDate;
  if ('expiry' in cleaned) cleaned.expires = cleaned.expiry;
  if ('expiration' in cleaned) cleaned.expires = cleaned.expiration;
  if (typeof cleaned.expires === 'string') {
    const numeric = Number(cleaned.expires);
    cleaned.expires = Number.isFinite(numeric) ? numeric : undefined;
  }
  if (cleaned.expires && cleaned.expires > 9999999999) cleaned.expires = Math.floor(cleaned.expires / 1000);
  if (cleaned.expires === -1 || cleaned.expires === 0 || cleaned.session) delete cleaned.expires;

  if (cleaned.url && !cleaned.domain) {
    try {
      const url = new URL(cleaned.url);
      cleaned.domain = url.hostname;
      cleaned.path = cleaned.path || url.pathname || '/';
      cleaned.secure = cleaned.secure ?? url.protocol === 'https:';
    } catch {}
  }
  if (!cleaned.domain && cleaned.host) cleaned.domain = cleaned.host;
  if (!cleaned.domain) return null;
  cleaned.path = cleaned.path || '/';
  cleaned.httpOnly = Boolean(cleaned.httpOnly ?? cleaned.http_only);
  cleaned.secure = Boolean(cleaned.secure);
  const sameSite = sameSiteValue(cleaned.sameSite || cleaned.same_site || cleaned.samesite);
  if (sameSite) cleaned.sameSite = sameSite;
  else delete cleaned.sameSite;

  for (const key of ['expirationDate', 'expiry', 'expiration', 'hostOnly', 'session', 'storeId', 'id', 'partitionKey', 'sourcePort', 'sourceScheme', 'priority', 'sameParty', 'url', 'host', 'key', 'val', 'http_only', 'same_site', 'samesite']) {
    delete cleaned[key];
  }
  return cleaned;
}

export function normalizeCookies(cookies: any[]): any[] {
  const merged = new Map<string, any>();
  for (const raw of Array.isArray(cookies) ? cookies : []) {
    const cookie = normalizeCookie(raw);
    if (cookie) merged.set(cookieKey(cookie), cookie);
  }
  return Array.from(merged.values());
}

function parseJsonCookies(input: string): any[] | null {
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

function parseNetscapeCookies(input: string): any[] {
  const cookies: any[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('# ') || line === '#HttpOnly_') continue;
    const httpOnly = line.startsWith('#HttpOnly_');
    const normalizedLine = httpOnly ? line.replace(/^#HttpOnly_/, '') : line;
    const parts = normalizedLine.split('\t');
    if (parts.length < 7) continue;
    const [domain, , pathValue, secure, expires, name, ...valueParts] = parts;
    cookies.push({
      domain,
      path: pathValue || '/',
      secure: /^true$/i.test(secure),
      httpOnly,
      expires: Number(expires) || undefined,
      name,
      value: valueParts.join('\t'),
    });
  }
  return cookies;
}

function parseNameValueCookies(input: string, domain?: string): any[] {
  if (!domain) return [];
  return input
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1),
        domain,
        path: '/',
      };
    })
    .filter(Boolean) as any[];
}

export function parseCookieInput(input: any, defaultDomain?: string): any[] {
  if (Array.isArray(input)) return normalizeCookies(input);
  if (input && typeof input === 'object') {
    if (Array.isArray(input.cookies)) return normalizeCookies(input.cookies);
    return normalizeCookies([input]);
  }
  if (typeof input !== 'string') return [];
  const text = input.trim();
  if (!text) return [];
  const jsonCookies = parseJsonCookies(text);
  if (jsonCookies) return normalizeCookies(jsonCookies);
  const netscapeCookies = parseNetscapeCookies(text);
  if (netscapeCookies.length) return normalizeCookies(netscapeCookies);
  return normalizeCookies(parseNameValueCookies(text, defaultDomain));
}

export function exportCookies(cookies: any[], format: 'json' | 'netscape' | 'header' = 'json') {
  const normalized = normalizeCookies(cookies);
  if (format === 'netscape') {
    return [
      '# Netscape HTTP Cookie File',
      ...normalized.map((cookie) => [
        cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain,
        cookie.domain?.startsWith('.') ? 'TRUE' : 'FALSE',
        cookie.path || '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        Math.floor(cookie.expires || 0),
        cookie.name,
        cookie.value,
      ].join('\t')),
    ].join('\n');
  }
  if (format === 'header') {
    return normalized.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }
  return JSON.stringify(normalized, null, 2);
}

export function cleanCookiesForPlaywright(cookies: any[]): any[] {
  return normalizeCookies(cookies).map((cookie) => {
    const cleaned: any = { ...cookie };
    for (const key of ['hostOnly', 'session', 'storeId', 'id', 'partitionKey', 'sourcePort', 'sourceScheme', 'priority', 'sameParty']) {
      delete cleaned[key];
    }
    return cleaned;
  }).filter((cookie) => cookie.domain && cookie.path);
}
