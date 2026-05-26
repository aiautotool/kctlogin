import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import axios from 'axios';
import {
  Copy,
  Bug,
  Cookie,
  Download,
  FolderOpen,
  Globe,
  History,
  Link,
  LogOut,
  MoreHorizontal,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { ProfileModal } from './components/ProfileModal';
import { ProxyManager } from './components/ProxyManager';
import { Sidebar, type Tab } from './components/Sidebar';
import { ApiMcpPanel } from './components/ApiMcpPanel';
import { ProxyDevices } from './components/ProxyDevices';
import { RemoveLogo } from './components/RemoveLogo';

const API_BASE = '/api';

type BrowserOS = 'windows' | 'mac' | 'android';

export interface Fingerprint {
  userAgent: string;
  platform: string;
  os: BrowserOS;
  chromeVersion: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
    availWidth: number;
    availHeight: number;
    deviceScaleFactor: number;
  };
  webgl: { vendor: string; renderer: string; mode: 'noise' | 'off' };
  hardware: { concurrency: number; memory: number };
  maxTouchPoints: number;
  languages: string[];
  timezone: string;
  geolocation?: { latitude: number; longitude: number; accuracy: number };
  canvasSeed: number;
  canvasMode: 'noise' | 'off' | 'block';
  audioSeed: number;
  audioMode: 'noise' | 'off';
  fonts: string[];
  mediaDevices: { videoInput: number; audioInput: number; audioOutput: number };
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

export interface Profile {
  id: string;
  name: string;
  isRunning: boolean;
  userAgent: string;
  viewport: { width: number; height: number };
  proxyId?: string;
  proxy?: { server: string; username?: string; password?: string };
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

function App() {
  const isTrayMode = new URLSearchParams(window.location.search).get('tray') === 'removeLogo';
  const [activeTab, setActiveTab] = useState<Tab>('profiles');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isCloneMode, setIsCloneMode] = useState(false);
  const [menuProfileId, setMenuProfileId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ profile: Profile; x: number; y: number } | null>(null);
  const [quickNoteProfile, setQuickNoteProfile] = useState<Profile | null>(null);
  const [quickNoteInput, setQuickNoteInput] = useState('');
  const [folderProfile, setFolderProfile] = useState<Profile | null>(null);
  const [folderNameInput, setFolderNameInput] = useState('');
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const fetchProfiles = async () => {
    try {
      const response = await axios.get(`${API_BASE}/profiles`);
      setProfiles(response.data);
    } catch (error) {
      console.error('Lỗi khi tải profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
    const timer = window.setInterval(fetchProfiles, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const closeContextMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('mousedown', closeContextMenu);
    document.addEventListener('scroll', closeContextMenu, true);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeContextMenu);
      document.removeEventListener('scroll', closeContextMenu, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  const handleSaveProfile = async (profileData: any, cookies?: {
    chatgpt?: any[];
    gemini?: any[];
    chatgptText?: string;
    geminiText?: string;
    chatgptDomain?: string;
    geminiDomain?: string;
  }) => {
    try {
      let savedProfile: Profile;
      if (isCloneMode && editingProfile) {
        savedProfile = (await axios.post(`${API_BASE}/profiles/${editingProfile.id}/clone`, profileData)).data;
      } else if (editingProfile) {
        savedProfile = (await axios.put(`${API_BASE}/profiles/${editingProfile.id}`, profileData)).data;
      } else {
        savedProfile = (await axios.post(`${API_BASE}/profiles`, profileData)).data;
      }

      if (cookies?.chatgpt) {
        await axios.post(`${API_BASE}/profiles/${savedProfile.id}/cookies/chatgpt`, { cookies: cookies.chatgpt });
      }
      if (cookies?.gemini) {
        await axios.post(`${API_BASE}/profiles/${savedProfile.id}/cookies/gemini`, { cookies: cookies.gemini });
      }
      if (cookies?.chatgptText) {
        await axios.post(`${API_BASE}/profiles/${savedProfile.id}/cookies/chatgpt`, {
          text: cookies.chatgptText,
          domain: cookies.chatgptDomain,
        });
      }
      if (cookies?.geminiText) {
        await axios.post(`${API_BASE}/profiles/${savedProfile.id}/cookies/gemini`, {
          text: cookies.geminiText,
          domain: cookies.geminiDomain,
        });
      }

      setIsModalOpen(false);
      setEditingProfile(null);
      setIsCloneMode(false);
      fetchProfiles();
    } catch (error: any) {
      alert(`Không thể lưu profile: ${error.response?.data?.error || error.message}`);
    }
  };

  const launch = async (id: string) => {
    try {
      setContextMenu(null);
      await axios.post(`${API_BASE}/profiles/${id}/launch`);
      fetchProfiles();
    } catch (error: any) {
      alert(`Lỗi khởi động: ${error.response?.data?.error || error.message}`);
    }
  };

  const stop = async (id: string) => {
    setContextMenu(null);
    await axios.post(`${API_BASE}/profiles/${id}/stop`).catch(() => alert('Không thể dừng profile'));
    fetchProfiles();
  };

  const logout = async (id: string) => {
    if (!confirm('Logout profile này và xóa cookie ChatGPT/Gemini đã lưu?')) return;
    await axios.post(`${API_BASE}/profiles/${id}/logout`).catch(() => alert('Không thể logout profile'));
    fetchProfiles();
  };

  const remove = async (id: string) => {
    if (!confirm('Xóa profile này? Dữ liệu trình duyệt riêng của profile cũng sẽ bị xóa.')) return;
    await axios.delete(`${API_BASE}/profiles/${id}`).catch(() => alert('Không thể xóa profile'));
    fetchProfiles();
  };

  const openDiagnostics = async (id: string) => {
    setDiagnosticsLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/profiles/${id}/diagnostics`);
      setDiagnostics(response.data);
    } catch (error: any) {
      alert(`Không thể mở diagnostics: ${error.response?.data?.error || error.message}`);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const checkProfileProxy = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/profiles/${id}/check-proxy`);
      const response = await axios.get(`${API_BASE}/profiles/${id}/diagnostics`);
      setDiagnostics(response.data);
      fetchProfiles();
    } catch (error: any) {
      alert(`Không thể check proxy: ${error.response?.data?.error || error.message}`);
    }
  };

  const checkProfileGoogle = async (id: string) => {
    try {
      setDiagnosticsLoading(true);
      const response = await axios.post(`${API_BASE}/profiles/${id}/check-google`);
      alert(response.data.ok ? 'Proxy vào Google/Gemini OK' : `Proxy có endpoint Google lỗi: ${JSON.stringify(response.data.results, null, 2)}`);
    } catch (error: any) {
      alert(`Không thể check Google/Gemini: ${error.response?.data?.error || error.message}`);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const repairProfile = async (id: string) => {
    try {
      setDiagnosticsLoading(true);
      await axios.post(`${API_BASE}/profiles/${id}/repair`);
      const response = await axios.get(`${API_BASE}/profiles/${id}/diagnostics`);
      setDiagnostics(response.data);
      fetchProfiles();
    } catch (error: any) {
      alert(`Không thể repair profile: ${error.response?.data?.error || error.message}`);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const updateProfilePatch = async (profile: Profile, patch: Partial<Profile>) => {
    try {
      await axios.put(`${API_BASE}/profiles/${profile.id}`, patch);
      setMenuProfileId(null);
      setContextMenu(null);
      fetchProfiles();
      return true;
    } catch (error: any) {
      alert(`Không thể cập nhật profile: ${error.response?.data?.error || error.message}`);
      return false;
    }
  };

  const exportProfiles = () => {
    const link = document.createElement('a');
    link.href = `${API_BASE}/profiles/export`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const importProfiles = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await axios.post(`${API_BASE}/profiles/import`, payload);
      const skipped = response.data?.skipped?.length ? `, bỏ qua ${response.data.skipped.length}` : '';
      alert(`Đã import ${response.data.imported} profile${skipped}.`);
      fetchProfiles();
    } catch (error: any) {
      alert(`Không thể import profile: ${error.response?.data?.error || error.message}`);
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const openProfileSettings = (profile: Profile, tab?: 'basic' | 'fingerprint' | 'cookies') => {
    setEditingProfile({ ...profile, settingsTab: tab } as Profile & { settingsTab?: string });
    setIsCloneMode(false);
    setIsModalOpen(true);
    setMenuProfileId(null);
    setContextMenu(null);
  };

  const openQuickNote = (profile: Profile) => {
    setQuickNoteProfile(profile);
    setQuickNoteInput(profile.notes || '');
    setMenuProfileId(null);
    setContextMenu(null);
  };

  const saveQuickNote = async () => {
    if (!quickNoteProfile) return;
    const saved = await updateProfilePatch(quickNoteProfile, { notes: quickNoteInput.trim() || undefined });
    if (!saved) return;
    setQuickNoteProfile(null);
    setQuickNoteInput('');
  };

  const openProfileContextMenu = (event: MouseEvent<HTMLTableRowElement>, profile: Profile) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 240;
    const menuHeight = 148;
    setMenuProfileId(null);
    setContextMenu({
      profile,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 12),
    });
  };

  const copyRunLink = async (profile: Profile) => {
    await navigator.clipboard.writeText(`kctlogin://run/${profile.id}`).catch(() => {});
    setMenuProfileId(null);
  };

  const copyId = async (profile: Profile) => {
    await navigator.clipboard.writeText(profile.id).catch(() => {});
    setMenuProfileId(null);
  };

  const saveFolder = async () => {
    if (!folderProfile) return;
    const saved = await updateProfilePatch(folderProfile, { folderName: folderNameInput.trim() || undefined });
    if (!saved) return;
    setFolderProfile(null);
    setFolderNameInput('');
  };

  const filteredProfiles = profiles
    .filter((profile) => profile.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));

  const pageTitle: Record<Tab, string> = {
    profiles: 'All profiles',
    proxies: 'Proxies',
    apiMcp: 'API & MCP',
    proxyDevices: 'Proxy Devices',
    removeLogo: 'Remove Logo',
  };

  if (isTrayMode) {
    return (
      <div className="min-h-screen bg-[#030712] overflow-hidden">
        <RemoveLogo compact />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030712] flex overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 h-screen overflow-hidden flex flex-col">
        <header className="h-16 border-b border-white/5 bg-gray-900/40 backdrop-blur-md px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">
              {pageTitle[activeTab]}
            </h2>
            {loading && activeTab === 'profiles' && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />}
          </div>
          <div className="flex items-center gap-3">
            {activeTab === 'profiles' && (
              <>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => importProfiles(event.target.files?.[0])}
                />
                <button
                  onClick={exportProfiles}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg"
                  title="Export danh sách profile"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg"
                  title="Import danh sách profile"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setEditingProfile(null);
                    setIsCloneMode(false);
                    setIsModalOpen(true);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" /> Tạo Profile
                </button>
              </>
            )}
            <button onClick={fetchProfiles} className="p-2 text-gray-400 hover:text-white" title="Làm mới">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
          {activeTab === 'profiles' ? (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="glass-effect p-5 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-xl">
                      <Users className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Tổng Profile</p>
                      <p className="text-2xl font-bold text-white">{profiles.length}</p>
                    </div>
                  </div>
                </div>
                <div className="glass-effect p-5 rounded-2xl border-l-4 border-l-green-500/50">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-green-500/10 rounded-xl">
                      <Play className="w-6 h-6 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Đang Chạy</p>
                      <p className="text-2xl font-bold text-white">{profiles.filter((p) => p.isRunning).length}</p>
                    </div>
                  </div>
                </div>
                <div className="glass-effect p-5 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-xl">
                      <Globe className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Có Proxy</p>
                      <p className="text-2xl font-bold text-white">{profiles.filter((p) => p.proxyId || p.proxy).length}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-effect rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-white/5 flex items-center justify-between gap-4">
                  <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Tìm kiếm profile..."
                      className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Profile</th>
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Trạng thái</th>
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Notes</th>
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Proxy & Location</th>
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Ngày tạo</th>
                        <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredProfiles.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500 text-sm">
                            Chưa có profile nào. Tạo profile mới để bắt đầu.
                          </td>
                        </tr>
                      ) : filteredProfiles.map((profile) => (
                        <tr
                          key={profile.id}
                          onClick={() => launch(profile.id)}
                          onContextMenu={(event) => openProfileContextMenu(event, profile)}
                          className="cursor-pointer hover:bg-white/[0.02]"
                          title={profile.isRunning ? 'Bấm để đưa cửa sổ profile lên trước. Chuột phải để thao tác nhanh.' : 'Bấm để chạy profile. Chuột phải để thao tác nhanh.'}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${profile.isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                              <div>
                                <p className="font-medium text-gray-200 inline-flex items-center gap-2">
                                  {profile.pinned && <Pin className="w-3.5 h-3.5 text-blue-300" />}
                                  {profile.name}
                                </p>
                                <p className="text-[10px] text-gray-500 font-mono">
                                  {profile.folderName ? `${profile.folderName} · ` : ''}{profile.id}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              profile.isRunning ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'
                            }`}>
                              {profile.isRunning ? 'Đang chạy' : 'Đã dừng'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              <p className="text-xs text-gray-300 max-w-[280px] truncate">{profile.notes || 'Không có ghi chú'}</p>
                              <p className="text-[10px] text-gray-500">{profile.fingerprint?.os === 'android' ? 'Android' : profile.fingerprint?.platform === 'Win32' ? 'Windows' : 'macOS'} · {profile.viewport?.width}x{profile.viewport?.height}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              <p className="text-xs text-gray-300">
                                {profile.proxyId || profile.proxy?.server ? 'Có proxy' : 'No proxy'}
                              </p>
                              <p className="text-[10px] text-gray-500">
                                {profile.fingerprint?.timezone || profile.locationCountryCode || '-'}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {new Date(profile.createdAt).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              {profile.isRunning ? (
                                <button onClick={() => stop(profile.id)} className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg" title="Dừng">
                                  <Square className="w-4 h-4" />
                                </button>
                              ) : (
                                <button onClick={() => launch(profile.id)} className="p-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg" title="Chạy">
                                  <Play className="w-4 h-4" />
                                </button>
                              )}
                              <div className="relative">
                                <button
                                  onClick={() => setMenuProfileId(menuProfileId === profile.id ? null : profile.id)}
                                  className="p-2 hover:bg-white/5 text-gray-400 hover:text-white rounded-lg"
                                  title="More settings"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                                {menuProfileId === profile.id && (
                                  <div className="absolute right-0 top-10 z-30 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#171a28] shadow-2xl">
                                    <button onClick={() => openProfileSettings(profile, 'fingerprint')} className="profile-menu-item"><Settings2 className="w-4 h-4" /> Settings</button>
                                    <button onClick={() => { setFolderProfile(profile); setFolderNameInput(profile.folderName || ''); setMenuProfileId(null); }} className="profile-menu-item"><FolderOpen className="w-4 h-4" /> Folders</button>
                                    <button onClick={() => navigator.clipboard.writeText(JSON.stringify(profile, null, 2))} className="profile-menu-item"><Globe className="w-4 h-4" /> Share</button>
                                    <button onClick={() => { setEditingProfile(profile); setIsCloneMode(true); setIsModalOpen(true); setMenuProfileId(null); }} className="profile-menu-item"><Copy className="w-4 h-4" /> Clone</button>
                                    <div className="my-1 border-t border-white/10" />
                                    <button onClick={() => launch(profile.id)} className="profile-menu-item"><Play className="w-4 h-4" /> Run</button>
                                    <button onClick={() => openProfileSettings(profile, 'cookies')} className="profile-menu-item"><Cookie className="w-4 h-4" /> Cookies</button>
                                    <button onClick={() => openDiagnostics(profile.id)} className="profile-menu-item"><History className="w-4 h-4" /> History / Diagnostics</button>
                                    <div className="my-1 border-t border-white/10" />
                                    <button onClick={() => copyRunLink(profile)} className="profile-menu-item"><Link className="w-4 h-4" /> Copy Run link</button>
                                    <button onClick={() => copyId(profile)} className="profile-menu-item"><Copy className="w-4 h-4" /> Copy ID</button>
                                    <button onClick={() => updateProfilePatch(profile, { pinned: !profile.pinned })} className="profile-menu-item"><Pin className="w-4 h-4" /> {profile.pinned ? 'Unpin' : 'Pin'}</button>
                                    <div className="my-1 border-t border-white/10" />
                                    {!profile.isRunning && <button onClick={() => logout(profile.id)} className="profile-menu-item"><LogOut className="w-4 h-4" /> Logout cookies</button>}
                                    <button onClick={() => alert('Automation sẽ được nối với MCP ở bước sau.')} className="profile-menu-item"><RefreshCw className="w-4 h-4" /> Automation</button>
                                    <button onClick={() => remove(profile.id)} className="profile-menu-item danger"><Trash2 className="w-4 h-4" /> Delete</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === 'proxies' ? (
            <ProxyManager />
          ) : activeTab === 'apiMcp' ? (
            <ApiMcpPanel />
          ) : activeTab === 'proxyDevices' ? (
            <ProxyDevices />
          ) : (
            <RemoveLogo />
          )}
        </div>
      </main>

      <ProfileModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingProfile(null);
          setIsCloneMode(false);
        }}
        onSave={handleSaveProfile}
        initialData={editingProfile ?? undefined}
        isClone={isCloneMode}
      />

      {contextMenu && (
        <div
          className="fixed z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#171a28] shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.profile.isRunning ? (
            <button onClick={() => stop(contextMenu.profile.id)} className="profile-menu-item">
              <Square className="w-4 h-4 text-red-300" /> Stop profile
            </button>
          ) : (
            <button onClick={() => launch(contextMenu.profile.id)} className="profile-menu-item">
              <Play className="w-4 h-4 text-green-300" /> Start profile
            </button>
          )}
          <button onClick={() => openQuickNote(contextMenu.profile)} className="profile-menu-item">
            <Pencil className="w-4 h-4" /> Edit note nhanh
          </button>
          <div className="my-1 border-t border-white/10" />
          <button onClick={() => openProfileSettings(contextMenu.profile, 'fingerprint')} className="profile-menu-item">
            <Settings2 className="w-4 h-4" /> Mở settings
          </button>
        </div>
      )}

      {quickNoteProfile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-gray-950 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Edit note nhanh</h3>
                <p className="text-xs text-gray-500">{quickNoteProfile.name}</p>
              </div>
              <button
                onClick={() => {
                  setQuickNoteProfile(null);
                  setQuickNoteInput('');
                }}
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <textarea
                value={quickNoteInput}
                onChange={(event) => setQuickNoteInput(event.target.value)}
                autoFocus
                rows={5}
                placeholder="Nhập ghi chú cho profile này..."
                className="w-full resize-none px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setQuickNoteProfile(null);
                    setQuickNoteInput('');
                  }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Hủy
                </button>
                <button onClick={saveQuickNote} className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white">
                  Lưu note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {folderProfile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Add to folder</h3>
                <p className="text-xs text-gray-500">{folderProfile.name}</p>
              </div>
              <button onClick={() => setFolderProfile(null)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300">
                Nhập tên folder để nhóm profile và dễ lọc/quản lý nhiều account.
              </div>
              <input
                value={folderNameInput}
                onChange={(event) => setFolderNameInput(event.target.value)}
                placeholder="Ví dụ: Facebook / Google / Client A"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <div className="flex justify-end gap-3">
                <button onClick={() => setFolderProfile(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Hủy</button>
                <button onClick={saveFolder} className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white">
                  Lưu folder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {diagnostics && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-2xl border border-white/10 bg-gray-950 shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Profile Diagnostics</h3>
                <p className="text-xs text-gray-500 font-mono">{diagnostics.profile?.name} · {diagnostics.profile?.id}</p>
              </div>
              <button onClick={() => setDiagnostics(null)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Browser</p>
                  <p className="mt-2 text-sm text-gray-200">{diagnostics.runtime?.browser?.name}</p>
                  <p className="mt-1 text-[11px] text-gray-500 break-all font-mono">{diagnostics.runtime?.browser?.executable}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Proxy chọn</p>
                  <p className="mt-2 text-sm text-gray-200">
                    {diagnostics.selectedProxy ? `${diagnostics.selectedProxy.host}:${diagnostics.selectedProxy.port}` : 'Không có'}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">{diagnostics.selectedProxy?.status || '-'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Proxy trong Orbita</p>
                  <p className="mt-2 text-sm text-gray-200">
                    {diagnostics.savedProxy?.server || 'Chưa ghi'}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">{diagnostics.savedProxy?.schema || '-'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => checkProfileProxy(diagnostics.profile.id)}
                  className="px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-sm"
                >
                  Check proxy profile
                </button>
                <button
                  onClick={() => checkProfileGoogle(diagnostics.profile.id)}
                  className="px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 text-sm"
                >
                  Check Google/Gemini
                </button>
                <button
                  onClick={() => repairProfile(diagnostics.profile.id)}
                  className="px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-sm"
                >
                  Repair profile
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(`http://127.0.0.1:3002/verify/${diagnostics.profile.id}`)}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm"
                >
                  Copy verify URL
                </button>
                {diagnosticsLoading && <span className="text-xs text-gray-500">Đang tải...</span>}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-medium text-gray-300">
                  Runtime fingerprint verify
                </div>
                <div className="p-4">
                  {diagnostics.verifyReport ? (
                    <div className="space-y-2">
                      <p className={diagnostics.verifyReport.ok ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>
                        {diagnostics.verifyReport.ok ? 'PASS' : 'Có lệch fingerprint'} · {diagnostics.verifyReport.createdAt}
                      </p>
                      {diagnostics.verifyReport.checks?.map((check: any) => (
                        <div key={check.id} className="grid grid-cols-[140px_70px_1fr] gap-3 text-xs font-mono">
                          <span className="text-gray-400">{check.id}</span>
                          <span className={check.pass ? 'text-emerald-300' : 'text-red-300'}>{check.pass ? 'pass' : 'fail'}</span>
                          <span className="text-gray-500 break-words">actual: {JSON.stringify(check.actual)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Chưa có report. Copy verify URL rồi mở trong cửa sổ Orbita profile.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-200">GoLogin compatibility</p>
                    <p className="text-xs text-gray-500">
                      {diagnostics.goLoginCompatibility?.score || 0}/{diagnostics.goLoginCompatibility?.total || 0} checks · launch {diagnostics.goLoginCompatibility?.lastLaunchAt || 'chưa có'}
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-white/10">
                  {diagnostics.goLoginCompatibility?.checks?.map((check: any) => (
                    <div key={check.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${
                          check.status === 'pass' ? 'bg-emerald-400' : check.status === 'warn' ? 'bg-amber-400' : 'bg-red-400'
                        }`} />
                        <span className="text-sm text-gray-200">{check.label}</span>
                      </div>
                      <p className="text-xs text-gray-500 font-mono break-words">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-200">Phân tích log</p>
                  <span className="text-xs text-gray-500">Noise đã ẩn: {diagnostics.logAnalysis?.noiseCount || 0}</span>
                </div>
                {diagnostics.logAnalysis?.critical?.length ? (
                  <div className="mt-3 space-y-2">
                    {diagnostics.logAnalysis.critical.map((line: string, index: number) => (
                      <p key={index} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 font-mono break-words">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-emerald-300">Chưa thấy lỗi critical trong log gần nhất.</p>
                )}
                {diagnostics.logAnalysis?.warnings?.length ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-gray-400">Xem warnings còn lại</summary>
                    <div className="mt-2 space-y-2">
                      {diagnostics.logAnalysis.warnings.map((line: string, index: number) => (
                        <p key={index} className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 font-mono break-words">
                          {line}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-medium text-gray-300">Orbita log gần nhất</div>
                <pre className="p-4 max-h-[360px] overflow-auto text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap font-mono">
                  {diagnostics.lastLog || 'Chưa có chrome_debug.log'}
                </pre>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-medium text-gray-300">Fingerprint đã ghi cho Orbita</div>
                <pre className="p-4 max-h-[320px] overflow-auto text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap font-mono">
                  {JSON.stringify(diagnostics.savedFingerprint?.fingerprint || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
