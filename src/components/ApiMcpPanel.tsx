import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import { CheckCircle2, Clipboard, Code2, Key, Network, Play, RefreshCw, Server, Terminal, Trash2 } from 'lucide-react';

const API_BASE = '/api';

const API_ENDPOINTS = [
  'GET /api/health',
  'GET /api/runtime',
  'GET /api/mcp',
  'GET /api/tokens',
  'POST /api/tokens',
  'GET /api/remote-chrome/sessions',
  'POST /api/remote-chrome/:id/start',
  'GET /api/remote-chrome/:id/version',
  'GET /api/profiles',
  'POST /api/profiles/:id/launch',
  'POST /api/profiles/:id/stop',
  'GET /api/profiles/:id/diagnostics',
  'GET /api/proxies',
  'POST /api/proxies/check',
];

type Panel = 'api' | 'remoteChrome' | 'mcp';

export function ApiMcpPanel() {
  const [activePanel, setActivePanel] = useState<Panel>('api');
  const [health, setHealth] = useState<any>(null);
  const [runtime, setRuntime] = useState<any>(null);
  const [mcp, setMcp] = useState<any>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [newToken, setNewToken] = useState<any>(null);
  const [tokenName, setTokenName] = useState('Automation token');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [remotePort, setRemotePort] = useState('');
  const [remoteResult, setRemoteResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, runtimeRes, mcpRes, tokenRes, profilesRes, sessionRes] = await Promise.all([
        axios.get(`${API_BASE}/health`),
        axios.get(`${API_BASE}/runtime`),
        axios.get(`${API_BASE}/mcp`),
        axios.get(`${API_BASE}/tokens`),
        axios.get(`${API_BASE}/profiles`),
        axios.get(`${API_BASE}/remote-chrome/sessions`),
      ]);
      setHealth(healthRes.data);
      setRuntime(runtimeRes.data);
      setMcp(mcpRes.data);
      setTokens(tokenRes.data);
      setProfiles(profilesRes.data);
      setSessions(sessionRes.data);
      if (!selectedProfileId && profilesRes.data?.[0]?.id) setSelectedProfileId(profilesRes.data[0].id);
    } catch (error) {
      console.error('Không thể tải API & MCP:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const mcpCommand = useMemo(() => {
    if (!mcp) return 'npm run mcp:stdio';
    return [mcp.command, ...(mcp.args || [])].join(' ');
  }, [mcp]);

  const mcpJson = useMemo(() => JSON.stringify({
    mcpServers: {
      kctlogin: {
        command: mcp?.command || 'npm',
        args: mcp?.args || ['run', 'mcp:stdio'],
        cwd: mcp?.cwd || '/Users/vkct/Documents/kenh1/kctlogin',
      },
    },
  }, null, 2), [mcp]);

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(key);
    window.setTimeout(() => setCopied(''), 1500);
  };

  const createToken = async () => {
    const response = await axios.post(`${API_BASE}/tokens`, { name: tokenName || 'API token' });
    setNewToken(response.data);
    await load();
  };

  const deleteToken = async (id: string) => {
    if (!confirm('Xóa access token này?')) return;
    await axios.delete(`${API_BASE}/tokens/${id}`);
    await load();
  };

  const startRemoteChrome = async () => {
    if (!selectedProfileId) return;
    const response = await axios.post(`${API_BASE}/remote-chrome/${selectedProfileId}/start`, {
      port: remotePort ? Number(remotePort) : undefined,
    });
    setRemoteResult(response.data);
    await load();
  };

  return (
    <div className="grid min-h-[calc(100vh-130px)] grid-cols-1 overflow-hidden rounded-2xl border border-white/10 bg-[#151723] lg:grid-cols-[360px_1fr]">
      <aside className="border-b border-white/10 bg-[#121520] p-6 lg:border-b-0 lg:border-r">
        <div className="mb-8">
          <p className="text-base font-semibold text-gray-200">trinhnd19@gmail.com</p>
          <p className="mt-1 text-xs text-gray-500">Local workspace API</p>
        </div>

        <div className="space-y-1">
          <button
            onClick={() => setActivePanel('api')}
            className={`w-full border-r-2 px-4 py-3 text-left text-sm ${activePanel === 'api' ? 'border-emerald-400 bg-white/5 text-emerald-300' : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            API
          </button>
          <button
            onClick={() => setActivePanel('remoteChrome')}
            className={`w-full border-r-2 px-4 py-3 text-left text-sm ${activePanel === 'remoteChrome' ? 'border-emerald-400 bg-white/5 text-emerald-300' : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            Remote Chrome
          </button>
          <button
            onClick={() => setActivePanel('mcp')}
            className={`w-full border-r-2 px-4 py-3 text-left text-sm ${activePanel === 'mcp' ? 'border-emerald-400 bg-white/5 text-emerald-300' : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            MCP
          </button>
        </div>
      </aside>

      <section className="overflow-y-auto p-6 lg:p-10 custom-scrollbar">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-medium text-gray-100">
              {activePanel === 'api' ? 'API' : activePanel === 'remoteChrome' ? 'Remote Chrome' : 'MCP'}
            </h2>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-gray-400">
              {activePanel === 'api'
                ? 'Tạo access token và dùng REST API để tự động hóa profile, proxy, cookies và diagnostics.'
                : activePanel === 'remoteChrome'
                  ? 'Mở profile với Chrome DevTools Protocol để Playwright/Puppeteer hoặc bot bên ngoài connect qua websocket.'
                  : 'Chạy MCP server local để agent gọi trực tiếp profile, proxy, cookies và Remote Chrome tools.'}
            </p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mb-10 flex flex-wrap gap-4">
          <button onClick={() => copy('postman', 'http://localhost:3002/api')} className="api-pill">Postman</button>
          <button onClick={() => copy('github', 'npm run mcp:stdio')} className="api-pill">GitHub</button>
          <button onClick={() => setActivePanel('mcp')} className="api-pill">MCP</button>
          <button onClick={() => setActivePanel('api')} className="api-pill">API</button>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <StatusCard icon={<CheckCircle2 className="w-5 h-5 text-emerald-300" />} label="API Server" value={health?.ok ? 'Online' : 'Checking'} detail="http://localhost:3002" />
          <StatusCard icon={<Server className="w-5 h-5 text-blue-300" />} label="Chrome Runtime" value={runtime?.browser?.name || '-'} detail={runtime?.browser?.executable || '-'} />
          <StatusCard icon={<Terminal className="w-5 h-5 text-violet-300" />} label="MCP Tools" value={`${mcp?.tools?.length || 0} tools`} detail={mcp?.transport || 'stdio'} />
        </div>

        {activePanel === 'api' && (
          <div className="space-y-8">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-2xl font-medium text-gray-100">Access tokens</h3>
              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-200 outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="Token name"
                />
                <button onClick={createToken} className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-gray-950 hover:bg-emerald-400">
                  New Token
                </button>
              </div>
              {newToken?.token && (
                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-emerald-200">Copy token ngay, token chỉ hiện một lần.</p>
                    <button onClick={() => copy('new-token', newToken.token)} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-200">
                      {copied === 'new-token' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-3 break-all font-mono text-xs text-emerald-100">{newToken.token}</p>
                </div>
              )}
              <div className="mt-6 overflow-hidden rounded-xl border border-white/10">
                <div className="grid grid-cols-[60px_1fr_180px_70px] bg-white/[0.03] px-4 py-3 text-sm font-semibold text-gray-400">
                  <span>#</span><span>Name</span><span>Created</span><span></span>
                </div>
                {tokens.length ? tokens.map((token, index) => (
                  <div key={token.id} className="grid grid-cols-[60px_1fr_180px_70px] items-center border-t border-white/10 px-4 py-3 text-sm text-gray-300">
                    <span>{index + 1}</span>
                    <span className="inline-flex items-center gap-2"><Key className="w-4 h-4 text-gray-500" />{token.name}</span>
                    <span className="text-xs text-gray-500">{new Date(token.createdAt).toLocaleString('vi-VN')}</span>
                    <button onClick={() => deleteToken(token.id)} className="rounded-lg p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )) : (
                  <div className="border-t border-white/10 px-4 py-6 text-sm text-gray-500">Chưa có token.</div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-xl font-medium text-gray-100">API endpoints</h3>
              <div className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-2">
                {API_ENDPOINTS.map((endpoint) => (
                  <button key={endpoint} onClick={() => copy(endpoint, endpoint)} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-left font-mono text-xs text-gray-300 hover:bg-white/[0.06]">
                    {endpoint}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {activePanel === 'remoteChrome' && (
          <div className="space-y-8">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-2xl font-medium text-gray-100">Start Remote Chrome</h3>
              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_auto]">
                <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-200 outline-none">
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.id}</option>)}
                </select>
                <input value={remotePort} onChange={(event) => setRemotePort(event.target.value)} placeholder="9222 auto" className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-200 outline-none" />
                <button onClick={startRemoteChrome} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-gray-950 hover:bg-emerald-400">
                  <Play className="w-4 h-4" /> Start
                </button>
              </div>
              {remoteResult && (
                <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <p className="text-sm font-medium text-emerald-200">Remote Chrome ready</p>
                  <p className="mt-3 break-all font-mono text-xs text-emerald-100">{remoteResult.webSocketDebuggerUrl || remoteResult.versionUrl}</p>
                  <button onClick={() => copy('ws', remoteResult.webSocketDebuggerUrl || remoteResult.versionUrl)} className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-200">
                    {copied === 'ws' ? 'Copied' : 'Copy connection'}
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-xl font-medium text-gray-100">Active remote sessions</h3>
              <div className="mt-5 space-y-3">
                {sessions.length ? sessions.map((session) => (
                  <div key={session.profileId} className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{session.profileId}</p>
                        <p className="mt-1 text-xs text-gray-500">{session.startedAt}</p>
                      </div>
                      <button onClick={() => copy(session.profileId, session.versionUrl)} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-200">Copy URL</button>
                    </div>
                    <p className="mt-3 break-all font-mono text-xs text-gray-400">{session.versionUrl}</p>
                  </div>
                )) : <p className="text-sm text-gray-500">Chưa có remote Chrome session.</p>}
              </div>
            </section>
          </div>
        )}

        {activePanel === 'mcp' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-2xl font-medium text-gray-100">MCP local config</h3>
                <button onClick={() => copy('mcp', mcpCommand)} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-200">
                  <Clipboard className="w-4 h-4" /> {copied === 'mcp' ? 'Copied' : 'Copy command'}
                </button>
              </div>
              <pre className="mt-5 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-gray-200">{mcpCommand}</pre>
              <div className="mt-5 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-200">JSON config</h4>
                <button onClick={() => copy('mcp-json', mcpJson)} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-200">{copied === 'mcp-json' ? 'Copied' : 'Copy JSON'}</button>
              </div>
              <pre className="mt-3 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-gray-300">{mcpJson}</pre>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="text-xl font-medium text-gray-100">Tools</h3>
              <div className="mt-4 max-h-[560px] overflow-y-auto custom-scrollbar divide-y divide-white/5">
                {(mcp?.tools || []).map((tool: string) => (
                  <div key={tool} className="flex items-center gap-3 py-3">
                    <Code2 className="w-4 h-4 text-blue-300" />
                    <span className="font-mono text-xs text-gray-200">{tool}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-white/5 p-3">{icon}</div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-100">{value}</p>
        </div>
      </div>
      <p className="mt-4 truncate font-mono text-[11px] text-gray-500">{detail}</p>
    </div>
  );
}
