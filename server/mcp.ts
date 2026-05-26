import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import net from 'net';
import { z } from 'zod';
import { browserService, type Profile } from './browser';
import { exportCookies, loadCookies, parseCookieInput, saveCookies } from './cookies';
import { readJson } from './jsonStore';
import { proxyService, type Proxy } from './proxyService';

const COOKIE_PLATFORMS = ['chatgpt', 'gemini'] as const;

export const MCP_TOOL_NAMES = [
  'kct_health',
  'kct_list_profiles',
  'kct_get_profile',
  'kct_launch_profile',
  'kct_stop_profile',
  'kct_repair_profile',
  'kct_list_proxies',
  'kct_import_proxies',
  'kct_check_proxies',
  'kct_get_cookies',
  'kct_save_cookies',
  'kct_remote_chrome_start',
  'kct_remote_chrome_list',
  'kct_remote_chrome_version',
] as const;

function findAvailablePort(startPort = 9222): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
      server.once('listening', () => server.close(() => resolve(port)));
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

function loadProfiles(): Profile[] {
  const profiles = readJson<Profile[]>('profiles.json', []);
  return Array.isArray(profiles) ? profiles : [];
}

function findProfile(profileId: string) {
  return loadProfiles().find((profile) => profile.id === profileId);
}

function redactProxy(proxy: Proxy) {
  return {
    ...proxy,
    username: proxy.username ? '***' : undefined,
    password: proxy.password ? '***' : undefined,
    hasAuth: !!(proxy.username || proxy.password),
  };
}

function redactProfile(profile: Profile) {
  return {
    ...profile,
    proxy: profile.proxy
      ? {
          server: profile.proxy.server,
          username: profile.proxy.username ? '***' : undefined,
          password: profile.proxy.password ? '***' : undefined,
          hasAuth: !!(profile.proxy.username || profile.proxy.password),
        }
      : undefined,
    isRunning: browserService.isProfileRunning(profile.id),
  };
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(message: string, details?: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, details }, null, 2),
      },
    ],
    isError: true,
  };
}

function requireProfile(profileId: string) {
  const profile = findProfile(profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  return profile;
}

export function createKctMcpServer() {
  const server = new McpServer({
    name: 'kctlogin',
    version: '0.1.0',
  });

  server.registerTool(
    'kct_health',
    {
      title: 'KCT Health',
      description: 'Check KCTLogin runtime, data directory, and available MCP tools.',
    },
    async () => {
      try {
        return textResult({
          ok: true,
          app: 'kctlogin',
          runtime: browserService.getRuntimeInfo(),
          tools: MCP_TOOL_NAMES,
        });
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_list_profiles',
    {
      title: 'List Profiles',
      description: 'List KCTLogin browser profiles with runtime state and redacted proxy credentials.',
      inputSchema: {
        includeFingerprint: z.boolean().optional().default(false),
      },
    },
    async ({ includeFingerprint }) => {
      const profiles = loadProfiles().map((profile) => {
        const redacted = redactProfile(profile);
        if (includeFingerprint) return redacted;
        const { fingerprint: _fingerprint, ...summary } = redacted;
        return summary;
      });
      return textResult({ profiles });
    },
  );

  server.registerTool(
    'kct_get_profile',
    {
      title: 'Get Profile',
      description: 'Get one KCTLogin profile by id. Proxy credentials are redacted.',
      inputSchema: {
        profileId: z.string().min(1),
        includeFingerprint: z.boolean().optional().default(true),
      },
    },
    async ({ profileId, includeFingerprint }) => {
      const profile = requireProfile(profileId);
      const redacted = redactProfile(profile);
      if (includeFingerprint) return textResult({ profile: redacted });
      const { fingerprint: _fingerprint, ...summary } = redacted;
      return textResult({ profile: summary });
    },
  );

  server.registerTool(
    'kct_launch_profile',
    {
      title: 'Launch Profile',
      description: 'Launch a KCTLogin profile in Orbita/Chrome.',
      inputSchema: {
        profileId: z.string().min(1),
        url: z.string().url().optional(),
      },
    },
    async ({ profileId, url }) => {
      try {
        const profile = requireProfile(profileId);
        await browserService.launchProfile(profile, { mode: 'visible', url });
        return textResult({ success: true, profileId, isRunning: browserService.isProfileRunning(profileId) });
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_stop_profile',
    {
      title: 'Stop Profile',
      description: 'Stop a running KCTLogin profile.',
      inputSchema: {
        profileId: z.string().min(1),
      },
    },
    async ({ profileId }) => {
      await browserService.stopProfile(profileId);
      return textResult({ success: true, profileId, isRunning: browserService.isProfileRunning(profileId) });
    },
  );

  server.registerTool(
    'kct_repair_profile',
    {
      title: 'Repair Profile',
      description: 'Clean stale locks and old proxy auth extension data for a profile.',
      inputSchema: {
        profileId: z.string().min(1),
      },
    },
    async ({ profileId }) => {
      try {
        requireProfile(profileId);
        return textResult(await browserService.repairProfile(profileId));
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_list_proxies',
    {
      title: 'List Proxies',
      description: 'List proxies with credentials redacted.',
      inputSchema: {
        status: z.enum(['alive', 'dead', 'checking', 'unknown']).optional(),
      },
    },
    async ({ status }) => {
      const proxies = proxyService
        .getAll()
        .filter((proxy) => !status || proxy.status === status)
        .map(redactProxy);
      return textResult({ proxies });
    },
  );

  server.registerTool(
    'kct_import_proxies',
    {
      title: 'Import Proxies',
      description: 'Import proxies from text. Supports host:port and host:port:user:pass lines.',
      inputSchema: {
        input: z.string().min(1),
        group: z.string().optional().default('MCP Imported'),
      },
    },
    async ({ input, group }) => {
      const added = proxyService.addProxies(input, group).map(redactProxy);
      return textResult({ success: true, count: added.length, proxies: added });
    },
  );

  server.registerTool(
    'kct_check_proxies',
    {
      title: 'Check Proxies',
      description: 'Check one or more stored proxies by id.',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1),
        concurrency: z.number().int().min(1).max(10).optional().default(3),
      },
    },
    async ({ ids, concurrency }) => {
      try {
        const results = ids.length === 1
          ? [await proxyService.checkProxy(ids[0])]
          : await proxyService.checkBatch(ids, concurrency);
        return textResult({ results: results.filter(Boolean).map((proxy) => redactProxy(proxy as Proxy)) });
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_get_cookies',
    {
      title: 'Get Cookies',
      description: 'Read saved cookies for a profile/platform.',
      inputSchema: {
        profileId: z.string().min(1),
        platform: z.enum(COOKIE_PLATFORMS),
        format: z.enum(['json', 'netscape', 'header']).optional().default('json'),
      },
    },
    async ({ profileId, platform, format }) => {
      try {
        requireProfile(profileId);
        const cookies = loadCookies(profileId, platform);
        if (format === 'json') return textResult({ cookies });
        return textResult(exportCookies(cookies, format));
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_save_cookies',
    {
      title: 'Save Cookies',
      description: 'Save cookies for a profile/platform from JSON, Netscape, or Cookie header text.',
      inputSchema: {
        profileId: z.string().min(1),
        platform: z.enum(COOKIE_PLATFORMS),
        cookies: z.any(),
        domain: z.string().optional(),
      },
    },
    async ({ profileId, platform, cookies, domain }) => {
      try {
        requireProfile(profileId);
        const parsed = parseCookieInput(cookies, domain);
        if (!parsed.length) return errorResult('Không parse được cookie input');
        saveCookies(profileId, platform, parsed);
        return textResult({ success: true, count: parsed.length });
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_remote_chrome_start',
    {
      title: 'Start Remote Chrome',
      description: 'Launch a profile with Chrome DevTools Protocol enabled on 127.0.0.1.',
      inputSchema: {
        profileId: z.string().min(1),
        port: z.number().int().min(1024).max(65535).optional(),
        url: z.string().url().optional(),
      },
    },
    async ({ profileId, port, url }) => {
      try {
        const profile = requireProfile(profileId);
        const remotePort = port || await findAvailablePort(9222);
        await browserService.launchProfile(profile, { mode: 'remote', url, remoteDebuggingPort: remotePort });
        let version: any = null;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          try {
            version = await readChromeJson(remotePort, '/json/version');
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
          webSocketDebuggerUrl: version?.webSocketDebuggerUrl || null,
        });
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  server.registerTool(
    'kct_remote_chrome_list',
    {
      title: 'List Remote Chrome Sessions',
      description: 'List active Chrome DevTools Protocol sessions launched by KCTLogin.',
    },
    async () => textResult({ sessions: browserService.getRemoteSessions() }),
  );

  server.registerTool(
    'kct_remote_chrome_version',
    {
      title: 'Remote Chrome Version',
      description: 'Read /json/version from an active remote Chrome session.',
      inputSchema: {
        profileId: z.string().min(1),
      },
    },
    async ({ profileId }) => {
      try {
        const session = browserService.getRemoteSession(profileId);
        if (!session) return errorResult('Remote Chrome session not found');
        return textResult(await readChromeJson(session.port, '/json/version'));
      } catch (error: any) {
        return errorResult(error.message);
      }
    },
  );

  return server;
}

async function main() {
  const server = createKctMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error('[KCTLogin MCP] Server error:', error);
    process.exit(1);
  });
}
