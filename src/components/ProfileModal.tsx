import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Shield, Monitor, Key, Server, PlusCircle, RefreshCw, ChevronDown } from 'lucide-react';
import type { Proxy } from './ProxyManager';

const API_BASE = '/api';

type BrowserOS = 'windows' | 'mac' | 'android';
type DeviceCategory = 'desktop' | 'mobile' | 'tablet';

const COUNTRY_FINGERPRINT: Record<string, { timezone: string; languages: string[] }> = {
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
  SG: { timezone: 'Asia/Singapore', languages: ['en-SG', 'en-US', 'en'] },
  ID: { timezone: 'Asia/Jakarta', languages: ['id-ID', 'id', 'en-US', 'en'] },
  PH: { timezone: 'Asia/Manila', languages: ['en-PH', 'en-US', 'en'] },
  MY: { timezone: 'Asia/Kuala_Lumpur', languages: ['ms-MY', 'ms', 'en-US', 'en'] },
  IN: { timezone: 'Asia/Kolkata', languages: ['en-IN', 'hi-IN', 'en'] },
};

const LOCATION_OPTIONS = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'FR', name: 'France' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'IN', name: 'India' },
];

const formatMode = (mode: string) => {
  const labels: Record<string, string> = {
    basedOnIp: 'Based on IP',
    previousTabs: 'Previously opened tabs',
    masked: 'Masked',
    real: 'Real',
    noise: 'Masked with noise',
    off: 'Off',
    block: 'Blocked',
  };
  return labels[mode] || mode;
};

const DEVICE_CATEGORY_OPTIONS: Array<{ value: DeviceCategory; label: string }> = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'tablet', label: 'Tablet' },
];

const inferDeviceCategory = (fingerprint?: Fingerprint): DeviceCategory => {
  if (!fingerprint) return 'mobile';
  if (fingerprint.deviceCategory) return fingerprint.deviceCategory;
  if (fingerprint.os !== 'android') return 'desktop';
  return /Mobile/i.test(fingerprint.userAgent) ? 'mobile' : 'tablet';
};

const getDefaultOsForDeviceCategory = (deviceCategory: DeviceCategory): BrowserOS => (
  deviceCategory === 'desktop' ? 'windows' : 'android'
);

const getOsOptionsForDeviceCategory = (deviceCategory: DeviceCategory): Array<{ value: BrowserOS; label: string }> => (
  deviceCategory === 'desktop'
    ? [
      { value: 'windows', label: 'Windows desktop' },
      { value: 'mac', label: 'macOS desktop' },
    ]
    : [
      { value: 'android', label: deviceCategory === 'tablet' ? 'Android tablet' : 'Android mobile' },
    ]
);

const applyProxyGeoToFingerprint = (current: Fingerprint, proxy?: Proxy): Fingerprint => {
  if (!proxy?.geo) return current;
  const geo = COUNTRY_FINGERPRINT[proxy.geo.countryCode?.toUpperCase() || ''];
  return {
    ...current,
    languages: geo?.languages || current.languages,
    timezone: proxy.geo.timezone || geo?.timezone || current.timezone,
    geolocation: typeof proxy.geo.latitude === 'number' && typeof proxy.geo.longitude === 'number' ? {
      latitude: proxy.geo.latitude,
      longitude: proxy.geo.longitude,
      accuracy: 50,
    } : current.geolocation,
  };
};

const applyCountryToFingerprint = (current: Fingerprint, countryCode?: string): Fingerprint => {
  const geo = countryCode ? COUNTRY_FINGERPRINT[countryCode.toUpperCase()] : undefined;
  if (!geo) return current;
  return {
    ...current,
    languages: geo.languages,
    timezone: geo.timezone,
    geolocation: undefined,
  };
};

const inferCountryFromFingerprint = (fingerprint?: Fingerprint) => {
  if (!fingerprint) return 'US';
  const match = Object.entries(COUNTRY_FINGERPRINT).find(([, value]) => value.timezone === fingerprint.timezone);
  return match?.[0] || 'US';
};

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

interface Profile {
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
  settingsTab?: 'basic' | 'fingerprint' | 'cookies';
  startUrl?: string;
  fingerprint: Fingerprint;
  createdAt: number;
  updatedAt?: number;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: any, cookies?: {
    chatgpt?: any[];
    gemini?: any[];
    chatgptText?: string;
    geminiText?: string;
    chatgptDomain?: string;
    geminiDomain?: string;
  }) => void;
  initialData?: Profile;
  isClone?: boolean;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, onSave, initialData, isClone }) => {
  const [name, setName] = useState('');
  const [fingerprint, setFingerprint] = useState<Fingerprint | null>(null);
  const [selectedOS, setSelectedOS] = useState<BrowserOS>('android');
  const [selectedDeviceCategory, setSelectedDeviceCategory] = useState<DeviceCategory>('mobile');

  // Proxy state
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState<string>('');
  const [proxyServer, setProxyServer] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');
  const [showCustomProxy, setShowCustomProxy] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('US');
  const [extensionPaths, setExtensionPaths] = useState('');
  const [launchArgs, setLaunchArgs] = useState('');
  const [notes, setNotes] = useState('');
  const [startUrl, setStartUrl] = useState('https://gemini.google.com');

  // Cookie states
  const [chatgptCookies, setChatgptCookies] = useState('');
  const [geminiCookies, setGeminiCookies] = useState('');
  const [chatgptCookieDomain, setChatgptCookieDomain] = useState('.openai.com');
  const [geminiCookieDomain, setGeminiCookieDomain] = useState('.google.com');
  const [activeTab, setActiveTab] = useState<'basic' | 'fingerprint' | 'cookies'>('basic');

  const fetchProxies = async () => {
    try {
      const res = await axios.get(`${API_BASE}/proxies`);
      setProxies(res.data);
    } catch (e) {
      console.error('Failed to fetch proxies:', e);
    }
  };

  useEffect(() => {
    const fetchExistingCookies = async () => {
      if (initialData && isOpen) {
        try {
          const [chatgptRes, geminiRes] = await Promise.all([
            axios.get(`${API_BASE}/profiles/${initialData.id}/cookies/chatgpt`),
            axios.get(`${API_BASE}/profiles/${initialData.id}/cookies/gemini`)
          ]);

          if (chatgptRes.data.cookies && chatgptRes.data.cookies.length > 0) {
            setChatgptCookies(JSON.stringify(chatgptRes.data.cookies, null, 2));
          }
          if (geminiRes.data.cookies && geminiRes.data.cookies.length > 0) {
            setGeminiCookies(JSON.stringify(geminiRes.data.cookies, null, 2));
          }
        } catch (e) {
          console.error('[ProfileModal] Failed to fetch cookies:', e);
        }
      }
    };

    if (initialData && isOpen) {
      setName(isClone ? `${initialData.name} (Clone)` : initialData.name);
      setFingerprint(initialData.fingerprint);
      const initialDeviceCategory = inferDeviceCategory(initialData.fingerprint);
      setSelectedDeviceCategory(initialDeviceCategory);
      setSelectedOS(initialData.fingerprint.os || getDefaultOsForDeviceCategory(initialDeviceCategory));
      
      setSelectedProxyId(initialData.proxyId || '');
      setSelectedLocation(initialData.locationCountryCode || inferCountryFromFingerprint(initialData.fingerprint));
      setProxyServer(initialData.proxy?.server || '');
      setProxyUser(initialData.proxy?.username || '');
      setProxyPass(initialData.proxy?.password || '');
      setShowCustomProxy(!!initialData.proxy && !initialData.proxyId);
      setExtensionPaths((initialData.extensionPaths || []).join('\n'));
      setLaunchArgs((initialData.launchArgs || []).join('\n'));
      setNotes(initialData.notes || '');
      setStartUrl(initialData.startUrl || 'https://gemini.google.com');

      setChatgptCookies('');
      setGeminiCookies('');
      setChatgptCookieDomain('.openai.com');
      setGeminiCookieDomain('.google.com');
      fetchExistingCookies();
      fetchProxies();
      setActiveTab(initialData.settingsTab || 'basic');
    } else if (isOpen) {
      setName('');
      setSelectedProxyId('');
      setSelectedLocation('US');
      setSelectedDeviceCategory('mobile');
      handleRandomize('android', 'US', '', 'mobile');
      setProxyServer('');
      setProxyUser('');
      setProxyPass('');
      setShowCustomProxy(false);
      setExtensionPaths('');
      setLaunchArgs('');
      setNotes('');
      setStartUrl('https://gemini.google.com');
      setChatgptCookies('');
      setGeminiCookies('');
      setChatgptCookieDomain('.openai.com');
      setGeminiCookieDomain('.google.com');
      fetchProxies();
      setActiveTab('basic');
    }
  }, [initialData, isOpen]);

  useEffect(() => {
    if (!selectedProxyId || proxies.length === 0) return;
    const selectedProxy = proxies.find((proxy) => proxy.id === selectedProxyId);
    if (!selectedProxy?.geo) return;
    setSelectedLocation(selectedProxy.geo.countryCode?.toUpperCase() || selectedLocation);
    setFingerprint((current) => current ? applyProxyGeoToFingerprint(current, selectedProxy) : current);
  }, [selectedProxyId, proxies]);

  const handleRandomize = async (
    os?: BrowserOS,
    countryCode = selectedLocation,
    proxyId = selectedProxyId,
    deviceCategory = selectedDeviceCategory,
  ) => {
    try {
      const params = new URLSearchParams({ os: os || selectedOS });
      params.set('deviceCategory', deviceCategory);
      params.set('countryCode', countryCode);
      if (!showCustomProxy && proxyId) params.set('proxyId', proxyId);
      const response = await axios.get(`${API_BASE}/fingerprint/random?${params.toString()}`);
      const nextFingerprint = response.data as Fingerprint;
      const selectedProxy = proxies.find((proxy) => proxy.id === proxyId);
      setFingerprint(selectedProxy ? applyProxyGeoToFingerprint(nextFingerprint, selectedProxy) : applyCountryToFingerprint(nextFingerprint, countryCode));
      if (os) setSelectedOS(os);
      setSelectedDeviceCategory(deviceCategory);
    } catch (e) {
      console.error('Failed to fetch random fingerprint:', e);
    }
  };

  const handleLocationChange = (countryCode: string) => {
    setSelectedLocation(countryCode);
    if (selectedProxyId) setSelectedProxyId('');
    setFingerprint((current) => current ? applyCountryToFingerprint(current, countryCode) : current);
    handleRandomize(selectedOS, countryCode, '', selectedDeviceCategory);
  };

  const handleProxyChange = (proxyId: string) => {
    setSelectedProxyId(proxyId);
    const selectedProxy = proxies.find((proxy) => proxy.id === proxyId);
    if (!selectedProxy?.geo) return;
    setSelectedLocation(selectedProxy.geo.countryCode?.toUpperCase() || selectedLocation);

    setFingerprint((current) => {
      if (!current) return current;
      return applyProxyGeoToFingerprint(current, selectedProxy);
    });
  };

  if (!isOpen) return null;

  const selectedProxy = proxies.find((proxy) => proxy.id === selectedProxyId);
  const osOptions = getOsOptionsForDeviceCategory(selectedDeviceCategory);
  const proxyLabel = selectedProxy?.geo?.country || selectedProxy?.host || (showCustomProxy && proxyServer ? proxyServer : 'No proxy');
  const geoLabel = fingerprint?.geolocation
    ? `${fingerprint.geolocation.latitude.toFixed(3)}, ${fingerprint.geolocation.longitude.toFixed(3)}`
    : 'Based on IP';

  const Row = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) => (
    <div className="grid grid-cols-[180px_1fr_120px] gap-4 px-5 py-4 border-b border-white/8 last:border-b-0 items-center">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-sm text-gray-200 break-words">{value}</div>
      <div className="text-xs text-gray-500 text-right">{hint}</div>
    </div>
  );

  const ToggleView = ({ active }: { active: boolean }) => (
    <span className={`inline-flex h-5 w-10 items-center rounded-full border ${active ? 'border-teal-400/40 bg-teal-500/15' : 'border-slate-500/50 bg-slate-900'}`}>
      <span className={`h-4 w-4 rounded-full transition-transform ${active ? 'translate-x-5 bg-teal-400' : 'translate-x-0.5 bg-slate-400'}`} />
    </span>
  );

  const ToggleControl = ({ active, onChange }: { active: boolean; onChange: (value: boolean) => void }) => (
    <button type="button" onClick={() => onChange(!active)} className="inline-flex">
      <ToggleView active={active} />
    </button>
  );

  const updateStorage = (key: keyof Fingerprint['storage'], value: boolean) => {
    setFingerprint((current) => current ? {
      ...current,
      storage: {
        ...current.storage,
        [key]: value,
      },
    } : current);
  };

  const AddCookiesButton = () => (
    <button
      type="button"
      onClick={() => setActiveTab('cookies')}
      className="text-gray-400 hover:text-white transition-colors"
    >
      +Add cookies
    </button>
  );

  const handleSave = () => {
    if (!fingerprint) return;
    const selectedProxyForSave = proxies.find((proxy) => proxy.id === selectedProxyId);
    const finalFingerprint = showCustomProxy
      ? applyCountryToFingerprint(fingerprint, selectedLocation)
      : selectedProxyForSave
        ? applyProxyGeoToFingerprint(fingerprint, selectedProxyForSave)
        : applyCountryToFingerprint(fingerprint, selectedLocation);

    const profileData: any = {
      name,
      userAgent: finalFingerprint.userAgent,
      viewport: { width: finalFingerprint.screen.width, height: finalFingerprint.screen.height },
      locationCountryCode: selectedLocation,
      extensionPaths: extensionPaths.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      launchArgs: launchArgs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      notes: notes.trim() || undefined,
      folderName: initialData?.folderName,
      pinned: initialData?.pinned,
      startUrl: fingerprint.startUrlMode === 'custom' ? startUrl : undefined,
      fingerprint: finalFingerprint,
    };

    if (!showCustomProxy) {
      if (selectedProxyId) {
        profileData.proxyId = selectedProxyId;
        profileData.proxy = null;
      } else {
        profileData.proxyId = null;
        profileData.proxy = null;
      }
    } else {
      if (proxyServer) {
        profileData.proxyId = null;
        profileData.proxy = {
          server: proxyServer,
          username: proxyUser || undefined,
          password: proxyPass || undefined,
        };
      } else {
        profileData.proxyId = null;
        profileData.proxy = null;
      }
    }

    const cookies: { chatgpt?: any[]; gemini?: any[]; chatgptText?: string; geminiText?: string; chatgptDomain?: string; geminiDomain?: string } = {};
    if (chatgptCookies.trim()) {
      cookies.chatgptText = chatgptCookies;
      cookies.chatgptDomain = chatgptCookieDomain;
    }
    if (geminiCookies.trim()) {
      cookies.geminiText = geminiCookies;
      cookies.geminiDomain = geminiCookieDomain;
    }

    onSave(profileData, cookies);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-5xl bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden glass-effect flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">
              {isClone ? 'Clone Profile' : (initialData ? 'Chỉnh Sửa Profile' : 'Tạo Profile Mới')}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex px-6 border-b border-white/5 bg-gray-900/30">
          <button
            onClick={() => setActiveTab('basic')}
            className={`px-4 py-3 text-sm font-medium transition-all border-b-2 ${activeTab === 'basic' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Cơ Bản & Proxy
          </button>
          <button
            onClick={() => setActiveTab('fingerprint')}
            className={`px-4 py-3 text-sm font-medium transition-all border-b-2 ${activeTab === 'fingerprint' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Vân Tay Trình Duyệt
          </button>
          <button
            onClick={() => setActiveTab('cookies')}
            className={`px-4 py-3 text-sm font-medium transition-all border-b-2 ${activeTab === 'cookies' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Thiết Lập Cookie
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          {activeTab === 'basic' && (
            <>
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400">Tên Profile</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ví dụ: Client A - Facebook"
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ghi chú account, format login, việc cần làm..."
                    className="w-full min-h-20 px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-y"
                  />
                </div>

                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Location tạo vân tay</label>
                    <select
                      value={selectedLocation}
                      onChange={(e) => handleLocationChange(e.target.value)}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      {LOCATION_OPTIONS.map((location) => (
                        <option key={location.code} value={location.code} className="bg-gray-900">
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                      <Server className="w-4 h-4" /> Cấu hình Proxy
                    </label>
                    <button 
                      onClick={() => setShowCustomProxy(!showCustomProxy)}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <PlusCircle className="w-3 h-3" />
                      {showCustomProxy ? 'Chọn từ danh sách' : 'Nhập proxy thủ công'}
                    </button>
                  </div>

                  {!showCustomProxy ? (
                    <select
                      value={selectedProxyId}
                      onChange={(e) => handleProxyChange(e.target.value)}
                      className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="" className="bg-gray-900">Không sử dụng Proxy</option>
                      {proxies.map(p => (
                        <option key={p.id} value={p.id} className="bg-gray-900">
                          [{p.protocol.toUpperCase()}] {p.host}:{p.port} {p.geo ? `(${p.geo.country})` : ''} {p.status === 'dead' ? '🔴' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      <input
                        type="text"
                        placeholder="Server (ip:port hoặc domain:port)"
                        value={proxyServer}
                        onChange={(e) => setProxyServer(e.target.value)}
                        className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="User (Nếu có)"
                          value={proxyUser}
                          onChange={(e) => setProxyUser(e.target.value)}
                          className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200"
                        />
                        <input
                          type="password"
                          placeholder="Pass (Nếu có)"
                          value={proxyPass}
                          onChange={(e) => setProxyPass(e.target.value)}
                          className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Resolution Info (Ready-only from fingerprint) */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-400">Loại thiết bị</label>
                  <select
                    value={selectedDeviceCategory}
                    onChange={(e) => {
                      const nextDeviceCategory = e.target.value as DeviceCategory;
                      const nextOs = getDefaultOsForDeviceCategory(nextDeviceCategory);
                      handleRandomize(nextOs, selectedLocation, selectedProxyId, nextDeviceCategory);
                    }}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    {DEVICE_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} className="bg-gray-900">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  <Monitor className="w-4 h-4" /> Độ phân giải màn hình (Từ vân tay)
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                    <span className="text-gray-500 mr-2">Width:</span> {fingerprint?.screen?.width || 0}px
                  </div>
                  <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                    <span className="text-gray-500 mr-2">Height:</span> {fingerprint?.screen?.height || 0}px
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'fingerprint' && fingerprint && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-200">
                  <span className="text-lg font-semibold">Profile Overview</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </div>
                <button
                  onClick={() => handleRandomize(fingerprint.os, selectedLocation, selectedProxyId, selectedDeviceCategory)}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-gray-200 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh fingerprint
                </button>
              </div>

              <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
                <Row label="Name" value={name || 'New profile'} />
                <Row label="Proxy" value={<span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-400" />{proxyLabel}</span>} />
                <Row label="Languages" value={fingerprint.languages.join('    ')} hint="Based on IP" />
                <Row label="Timezone" value={fingerprint.timezone} hint="Based on IP" />
                <Row label="Geolocation" value={geoLabel} hint="Based on IP" />
                <Row label="Device type" value={selectedDeviceCategory} />
                <Row label="Resolution" value={`${fingerprint.screen.width}x${fingerprint.screen.height}`} />
                <Row label="New fingerprint" value={<button onClick={() => handleRandomize(fingerprint.os, selectedLocation, selectedProxyId, selectedDeviceCategory)} className="inline-flex items-center gap-2 text-gray-200 hover:text-white"><RefreshCw className="w-4 h-4" />Refresh fingerprint</button>} />
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2 text-gray-200">
                  <span className="text-lg font-semibold">Proxy & Location</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </div>
                <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
                  <Row label="Proxy" value={<span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-teal-400" />{proxyLabel}</span>} />
                  <Row label="Timezone" value={fingerprint.timezone} hint="Based on IP" />
                  <Row label="Geolocation" value={geoLabel} hint="Based on IP" />
                  <Row label="WebRTC" value={formatMode(fingerprint.webRtcMode)} />
                  <Row label="Custom DNS" value={fingerprint.customDns || '+Add custom DNS'} />
                </div>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2 text-gray-200">
                  <span className="text-lg font-semibold">Browser</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </div>
                <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
                  <Row
                    label="Device type"
                    value={(
                      <select
                        value={selectedDeviceCategory}
                        onChange={(e) => {
                          const nextDeviceCategory = e.target.value as DeviceCategory;
                          const nextOs = getDefaultOsForDeviceCategory(nextDeviceCategory);
                          handleRandomize(nextOs, selectedLocation, selectedProxyId, nextDeviceCategory);
                        }}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      >
                        {DEVICE_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  <Row
                    label="Browser OS"
                    value={(
                      <select
                        value={fingerprint.os}
                        onChange={(e) => handleRandomize(e.target.value as BrowserOS, selectedLocation, selectedProxyId, selectedDeviceCategory)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      >
                        {osOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  />
                  <Row label="User Agent" value={<span className="font-mono text-xs leading-6">{fingerprint.userAgent}</span>} />
                <Row label="Cookies" value={<AddCookiesButton />} />
                  <Row label="Bookmarks" value={`${fingerprint.bookmarksCount} bookmarks`} />
                  <Row
                    label="Start URL"
                    value={(
                      <div className="space-y-2">
                        <select
                          value={fingerprint.startUrlMode}
                          onChange={(e) => {
                            const mode = e.target.value as Fingerprint['startUrlMode'];
                            setFingerprint((current) => current ? { ...current, startUrlMode: mode } : current);
                          }}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        >
                          <option value="custom">Custom URL</option>
                          <option value="blank">Blank page</option>
                          <option value="previousTabs">Gemini default</option>
                        </select>
                        {fingerprint.startUrlMode === 'custom' && (
                          <input
                            value={startUrl}
                            onChange={(e) => setStartUrl(e.target.value)}
                            placeholder="https://gemini.google.com"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          />
                        )}
                      </div>
                    )}
                  />
                  <Row
                    label="Launch arguments"
                    value={(
                      <textarea
                        value={launchArgs}
                        onChange={(e) => setLaunchArgs(e.target.value)}
                        placeholder="--disable-features=...\n--some-flag=value"
                        className="w-full min-h-20 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
                      />
                    )}
                    hint="One per line"
                  />
                  <Row label="Languages" value={fingerprint.languages.join('    ')} hint="Based on IP" />
                  <Row
                    label="Extensions"
                    value={(
                      <textarea
                        value={extensionPaths}
                        onChange={(e) => setExtensionPaths(e.target.value)}
                        placeholder="/absolute/path/to/unpacked-extension"
                        className="w-full min-h-20 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
                      />
                    )}
                    hint="Unpacked"
                  />
                  <Row label="Fonts" value={formatMode(fingerprint.fontsMode)} hint={`${fingerprint.fonts.length} fonts`} />
                </div>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2 text-gray-200">
                  <span className="text-lg font-semibold">Storage</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </div>
                <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
                  <Row label="Lock session" value={<ToggleControl active={fingerprint.storage.lockSession} onChange={(value) => updateStorage('lockSession', value)} />} />
                  <Row label="Save tabs" value={<ToggleControl active={fingerprint.storage.saveTabs} onChange={(value) => updateStorage('saveTabs', value)} />} />
                  <Row label="Save history" value={<ToggleControl active={fingerprint.storage.saveHistory} onChange={(value) => updateStorage('saveHistory', value)} />} />
                  <Row label="Save bookmarks" value={<ToggleControl active={fingerprint.storage.saveBookmarks} onChange={(value) => updateStorage('saveBookmarks', value)} />} />
                  <Row label="Enable Google services" value={<ToggleControl active={fingerprint.storage.enableGoogleServices} onChange={(value) => updateStorage('enableGoogleServices', value)} />} />
                  <Row label="Save passwords" value={<ToggleControl active={fingerprint.storage.savePasswords} onChange={(value) => updateStorage('savePasswords', value)} />} />
                  <Row label="Enable local storage" value={<ToggleControl active={fingerprint.storage.enableLocalStorage} onChange={(value) => updateStorage('enableLocalStorage', value)} />} />
                  <Row label="Enable indexedDB" value={<ToggleControl active={fingerprint.storage.enableIndexedDB} onChange={(value) => updateStorage('enableIndexedDB', value)} />} />
                  <Row label="Browser plugins" value={<ToggleControl active={fingerprint.storage.browserPlugins} onChange={(value) => updateStorage('browserPlugins', value)} />} />
                  <Row label="Allow to install extensions" value={<ToggleControl active={fingerprint.storage.allowInstallExtensions} onChange={(value) => updateStorage('allowInstallExtensions', value)} />} />
                  <Row label="System Extensions" value={<ToggleControl active={fingerprint.storage.systemExtensions} onChange={(value) => updateStorage('systemExtensions', value)} />} />
                </div>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2 text-gray-200">
                  <span className="text-lg font-semibold">Hardware</span>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </div>
                <div className="border border-white/10 rounded-xl overflow-hidden bg-white/[0.02]">
                  <Row label="Device type" value={selectedDeviceCategory} />
                  <Row label="Resolution" value={`${fingerprint.screen.width}x${fingerprint.screen.height}`} />
                  <Row label="Device memory" value={`${fingerprint.hardware.memory} GB`} />
                  <Row label="Number of threads" value={`${fingerprint.hardware.concurrency} threads`} />
                  <Row label="Touch points" value={`${fingerprint.maxTouchPoints || 0}`} />
                  <Row label="Media Devices" value="Masked" hint={`Cam. ${fingerprint.mediaDevices.videoInput} / Mic. ${fingerprint.mediaDevices.audioInput} / Sp. ${fingerprint.mediaDevices.audioOutput}`} />
                  <Row label="Canvas" value={formatMode(fingerprint.canvasMode)} />
                  <Row label="WebGL Image" value={fingerprint.webgl.mode === 'off' ? 'Real' : 'Masked'} />
                  <Row label="WebGL info" value={fingerprint.webgl.mode === 'off' ? 'Real' : 'Masked'} hint={`${fingerprint.webgl.vendor} / ${fingerprint.webgl.renderer}`} />
                  <Row label="Audio Context" value={formatMode(fingerprint.audioMode)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cookies' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200 leading-relaxed">
                <strong>Lưu ý:</strong> Hỗ trợ JSON array, object có key cookies, Netscape cookie file, hoặc header dạng name=value; name2=value2.
                Nếu dán header raw, domain bên dưới sẽ được dùng để gán cookie.
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  <Key className="w-4 h-4 text-green-400" /> ChatGPT Cookies
                </label>
                <input
                  value={chatgptCookieDomain}
                  onChange={(e) => setChatgptCookieDomain(e.target.value)}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                  placeholder=".openai.com"
                />
                <textarea
                  value={chatgptCookies}
                  onChange={(e) => setChatgptCookies(e.target.value)}
                  placeholder='JSON / Netscape / name=value; name2=value2'
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-[11px] font-mono text-gray-300 h-32 focus:outline-none focus:ring-2 focus:ring-green-500/30 resize-none"
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  <Key className="w-4 h-4 text-purple-400" /> Gemini/Google Cookies
                </label>
                <input
                  value={geminiCookieDomain}
                  onChange={(e) => setGeminiCookieDomain(e.target.value)}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                  placeholder=".google.com"
                />
                <textarea
                  value={geminiCookies}
                  onChange={(e) => setGeminiCookies(e.target.value)}
                  placeholder='JSON / Netscape / name=value; name2=value2'
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-[11px] font-mono text-gray-300 h-32 focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-white/5 bg-gray-900/80">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={!name}
            className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-900/40 active:scale-95"
          >
            {isClone ? 'Clone Profile' : (initialData ? 'Cập nhật Profile' : 'Tạo Profile Mới')}
          </button>
        </div>
      </div>
    </div>
  );
};
