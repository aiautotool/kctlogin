import type { ReactNode } from 'react';
import { Globe, ImageOff, Network, Server, Users } from 'lucide-react';

export type Tab = 'profiles' | 'proxies' | 'apiMcp' | 'proxyDevices' | 'removeLogo';

interface SidebarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const items: Array<{ key: Tab; label: string; icon: ReactNode }> = [
    { key: 'profiles', label: 'All profiles', icon: <Users className="w-5 h-5" /> },
    { key: 'proxies', label: 'Proxies', icon: <Globe className="w-5 h-5" /> },
    { key: 'apiMcp', label: 'API & MCP', icon: <Network className="w-5 h-5" /> },
    { key: 'proxyDevices', label: 'Proxy Devices', icon: <Server className="w-5 h-5" /> },
    { key: 'removeLogo', label: 'Remove Logo', icon: <ImageOff className="w-5 h-5" /> },
  ];

  return (
    <aside className="w-[240px] h-screen sidebar-glass flex flex-col border-r border-white/5">
      <div className="h-20 px-5 flex items-center gap-3 border-b border-white/5">
        <img src="/logo.png" alt="KCT Login" className="w-10 h-10 object-contain rounded-lg" />
        <div>
          <h1 className="text-lg font-black text-white leading-tight">KCT Login</h1>
          <p className="text-xs text-gray-500">Profile & Proxy</p>
        </div>
      </div>

      <nav className="p-4 space-y-2">
        {items.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-600/15 text-white border border-blue-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className={active ? 'text-blue-400' : 'text-gray-500'}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
