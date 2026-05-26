import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Copy,
  AlertTriangle,
  Search,
  Settings,
  Eye,
  EyeOff
} from 'lucide-react';

const API_BASE = '/api';

export interface Proxy {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  status: 'alive' | 'dead' | 'checking' | 'unknown';
  geo?: {
    ip: string;
    country: string;
    countryCode: string;
    city: string;
    timezone: string;
    isp: string;
    latitude?: number;
    longitude?: number;
  };
  latency?: number;
  lastChecked?: number;
  group?: string;
}

export function ProxyManager() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [importText, setImportText] = useState('');
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isFetchingFree, setIsFetchingFree] = useState(false);
  const [selectedProxies, setSelectedProxies] = useState<Set<string>>(new Set());
  const [showDead, setShowDead] = useState(true);
  const [columnVisibility, setColumnVisibility] = useState({
    select: true,
    status: true,
    address: true,
    geo: true,
    latency: true,
    actions: true
  });
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const fetchProxies = async () => {
    try {
      const res = await axios.get(`${API_BASE}/proxies`);
      setProxies(res.data);
    } catch (e) {
      console.error('Lỗi khi tải proxies:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProxies();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showColumnMenu && !(event.target as Element).closest('.column-menu')) {
        setShowColumnMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColumnMenu]);

  const handleFetchFree = async () => {
    setIsFetchingFree(true);
    try {
      await axios.post(`${API_BASE}/proxies/fetch-free`);
      fetchProxies();
    } catch (e) {
      alert('Không thể lấy proxy free');
    } finally {
      setIsFetchingFree(false);
    }
  };

  const handleAddProxies = async () => {
    if (!importText.trim()) return;
    try {
      setLoading(true);
      await axios.post(`${API_BASE}/proxies`, { input: importText });
      setImportText('');
      setIsAdding(false);
      fetchProxies();
    } catch (e) {
      alert('Lỗi khi thêm proxies');
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async (id: string) => {
    setCheckingIds(prev => new Set(prev).add(id));
    try {
      const response = await axios.post(`${API_BASE}/proxies/check`, { ids: [id] });
      console.log('Check result:', response.data);

      // Update local state immediately with the result
      if (response.data) {
        setProxies(prev => prev.map(p =>
          p.id === id ? { ...p, ...response.data } : p
        ));
      } else {
        // If no data returned, fetch all
        fetchProxies();
      }
    } catch (e) {
      console.error('Lỗi khi check proxy:', id, e);
      fetchProxies();
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCheckAll = async () => {
    const ids = proxies.map(p => p.id);
    if (ids.length === 0) return;

    // Set all to checking state visually
    setCheckingIds(new Set(ids));
    try {
      const response = await axios.post(`${API_BASE}/proxies/check`, { ids, concurrency: 3 });
      console.log('Batch check result:', response.data);

      // Update local state with batch results
      if (response.data && Array.isArray(response.data)) {
        setProxies(prev => prev.map(proxy => {
          const updated = response.data.find((r: any) => r.id === proxy.id);
          return updated ? { ...proxy, ...updated } : proxy;
        }));
      } else {
        fetchProxies();
      }
    } catch (e) {
      console.error('Lỗi khi check tất cả proxy:', e);
      fetchProxies();
    } finally {
      setCheckingIds(new Set());
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xóa proxy này?')) return;
    try {
      await axios.delete(`${API_BASE}/proxies/${id}`);
      fetchProxies();
    } catch (e) {
      alert('Không thể xóa');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedProxies(new Set(filteredProxies.map(p => p.id)));
    } else {
      setSelectedProxies(new Set());
    }
  };

  const handleSelectProxy = (id: string, checked: boolean) => {
    setSelectedProxies(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedProxies);
    if (ids.length === 0) return;
    if (!confirm(`Xóa ${ids.length} proxy đã chọn?`)) return;
    try {
      await Promise.all(ids.map(id => axios.delete(`${API_BASE}/proxies/${id}`)));
      setSelectedProxies(new Set());
      fetchProxies();
    } catch (e) {
      alert('Không thể xóa một số proxy');
    }
  };

  const handleDeleteDead = async () => {
    const deadIds = proxies.filter(p => p.status === 'dead').map(p => p.id);
    if (deadIds.length === 0) return;
    if (!confirm(`Xóa tất cả ${deadIds.length} proxy chết?`)) return;
    try {
      await Promise.all(deadIds.map(id => axios.delete(`${API_BASE}/proxies/${id}`)));
      fetchProxies();
    } catch (e) {
      alert('Không thể xóa proxy chết');
    }
  };

  const toggleColumnVisibility = (column: keyof typeof columnVisibility) => {
    setColumnVisibility(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast here
  };

  const filteredProxies = proxies.filter(p =>
    (showDead || p.status !== 'dead') &&
    (p.host.includes(searchTerm) ||
    p.geo?.ip?.includes(searchTerm) ||
    p.geo?.country?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-blue-500" />
            Proxy Manager
          </h2>
          <p className="text-sm text-gray-400">Quản lý và kiểm tra danh sách proxy của bạn</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleFetchFree}
            disabled={isFetchingFree}
            className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-xl flex items-center gap-2 transition-all border border-purple-500/30 text-sm font-medium disabled:opacity-50"
          >
            {isFetchingFree ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Quét Proxy Free
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-blue-900/20 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Thêm Proxy
          </button>
          <button
            onClick={handleCheckAll}
            disabled={checkingIds.size > 0 || proxies.length === 0}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl flex items-center gap-2 transition-all border border-white/10 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checkingIds.size > 0 ? 'animate-spin' : ''}`} />
            Check All
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-effect p-4 rounded-2xl">
          <p className="text-xs text-gray-400 uppercase font-semibold">Tổng số</p>
          <p className="text-2xl font-bold text-white mt-1">{proxies.length}</p>
        </div>
        <div className="glass-effect p-4 rounded-2xl border-l-2 border-green-500/50">
          <p className="text-xs text-gray-400 uppercase font-semibold text-green-400">Sống (Alive)</p>
          <p className="text-2xl font-bold text-white mt-1">
            {proxies.filter(p => p.status === 'alive').length}
          </p>
        </div>
        <div className="glass-effect p-4 rounded-2xl border-l-2 border-red-500/50">
          <p className="text-xs text-gray-400 uppercase font-semibold text-red-400">Chết (Dead)</p>
          <p className="text-2xl font-bold text-white mt-1">
            {proxies.filter(p => p.status === 'dead').length}
          </p>
        </div>
        <div className="glass-effect p-4 rounded-2xl border-l-2 border-blue-500/50">
          <p className="text-xs text-gray-400 uppercase font-semibold text-blue-400">Đã chọn</p>
          <p className="text-2xl font-bold text-white mt-1">
             {selectedProxies.size}
          </p>
        </div>
      </div>

      {/* Main Table Area */}
      <div className="glass-effect rounded-2xl overflow-hidden border border-white/5 pb-4">
        <div className="p-4 border-b border-white/5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Tìm kiếm host, IP, quốc gia..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={showDead}
                  onChange={(e) => setShowDead(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                />
                Hiển thị proxy chết
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowColumnMenu(!showColumnMenu)}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white rounded-lg flex items-center gap-2 transition-all border border-white/10 text-xs font-medium"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Cột
                </button>
                {showColumnMenu && (
                  <div className="column-menu absolute right-0 mt-2 w-48 bg-gray-800 border border-white/10 rounded-lg shadow-lg z-10">
                    <div className="p-2">
                      <div className="text-xs font-semibold text-gray-400 mb-2 px-2">Hiển thị cột</div>
                      {Object.entries(columnVisibility).map(([column, visible]) => (
                        <label key={column} className="flex items-center gap-2 px-2 py-1 hover:bg-white/5 rounded text-sm text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visible}
                            onChange={() => toggleColumnVisibility(column as keyof typeof columnVisibility)}
                            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                          />
                          {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          {column === 'select' ? 'Chọn' :
                           column === 'status' ? 'Trạng thái' :
                           column === 'address' ? 'Địa chỉ Proxy' :
                           column === 'geo' ? 'Thông tin GEO' :
                           column === 'latency' ? 'Độ trễ' : 'Thao tác'}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleDeleteDead}
                disabled={proxies.filter(p => p.status === 'dead').length === 0}
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg flex items-center gap-2 transition-all border border-red-500/30 text-xs font-medium disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa tất cả chết
              </button>
            </div>
          </div>
          {selectedProxies.size > 0 && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400">Đã chọn {selectedProxies.size} proxy</span>
              <button
                onClick={handleDeleteSelected}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg flex items-center gap-2 transition-all text-xs font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa đã chọn
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                {columnVisibility.select && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">
                    <input
                      type="checkbox"
                      checked={filteredProxies.length > 0 && selectedProxies.size === filteredProxies.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
                {columnVisibility.status && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Trạng thái</th>
                )}
                {columnVisibility.address && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Proxy Address</th>
                )}
                {columnVisibility.geo && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Thông tin IP (GEO)</th>
                )}
                {columnVisibility.latency && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400">Độ trễ</th>
                )}
                {columnVisibility.actions && (
                  <th className="px-6 py-4 text-xs font-semibold uppercase text-gray-400 text-right">Thao tác</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredProxies.length === 0 ? (
                <tr>
                  <td colSpan={Object.values(columnVisibility).filter(Boolean).length} className="px-6 py-12 text-center text-gray-500 text-sm">
                    {proxies.length === 0 ? 'Chưa có proxy nào. Hãy tạo thêm bằng cách nhập list.' : 'Không tìm thấy kết quả phù hợp.'}
                  </td>
                </tr>
              ) : (
                filteredProxies.map((proxy) => (
                  <tr key={proxy.id} className="group hover:bg-white/[0.02] transition-colors">
                    {columnVisibility.select && (
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProxies.has(proxy.id)}
                          onChange={(e) => handleSelectProxy(proxy.id, e.target.checked)}
                          className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                    )}
                    {columnVisibility.status && (
                      <td className="px-6 py-4">
                        {checkingIds.has(proxy.id) ? (
                          <div className="flex items-center gap-2 text-blue-400 text-xs font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Checking...
                          </div>
                        ) : proxy.status === 'alive' ? (
                          <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Alive
                          </div>
                        ) : proxy.status === 'dead' ? (
                          <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Dead
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Unknown
                          </div>
                        )}
                      </td>
                    )}
                    {columnVisibility.address && (
                      <td className="px-6 py-4">
                         <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                               <span className="text-sm font-medium text-gray-200">{proxy.host}:{proxy.port}</span>
                               <button onClick={() => copyToClipboard(`${proxy.host}:${proxy.port}`)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all">
                                  <Copy className="w-3 h-3 text-gray-400" />
                               </button>
                            </div>
                            <div className="flex items-center gap-2">
                               <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded ring-1 ring-blue-500/20">{proxy.protocol}</span>
                               {proxy.username && (
                                 <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                    <Shield className="w-3 h-3" />
                                    Auth Enable
                                 </span>
                               )}
                            </div>
                         </div>
                      </td>
                    )}
                    {columnVisibility.geo && (
                      <td className="px-6 py-4">
                         {proxy.geo ? (
                           <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                 <span className="text-sm text-gray-200">{proxy.geo.country}</span>
                                 <span className="text-[10px] text-gray-500 font-mono">({proxy.geo.ip})</span>
                              </div>
                              <span className="text-[10px] text-gray-400 truncate max-w-[150px]">{proxy.geo.isp}</span>
                           </div>
                         ) : (
                           <span className="text-xs text-gray-600">Chưa có thông tin</span>
                         )}
                      </td>
                    )}
                    {columnVisibility.latency && (
                      <td className="px-6 py-4">
                         {proxy.latency !== undefined ? (
                           proxy.latency === -1 ? (
                             <span className="text-xs font-mono text-red-400">Failed</span>
                           ) : (
                             <span className={`text-xs font-mono ${proxy.latency < 500 ? 'text-green-400' : proxy.latency < 1500 ? 'text-yellow-400' : 'text-red-400'}`}>
                               {proxy.latency}ms
                             </span>
                           )
                         ) : '-'}
                      </td>
                    )}
                    {columnVisibility.actions && (
                      <td className="px-6 py-4 text-right">
                         <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleCheck(proxy.id)}
                              disabled={checkingIds.has(proxy.id)}
                              className="p-2 hover:bg-white/5 text-gray-400 hover:text-blue-400 rounded-lg transition-colors disabled:opacity-30"
                              title="Kiểm tra lại"
                            >
                              <RefreshCw className={`w-4 h-4 ${checkingIds.has(proxy.id) ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                              onClick={() => handleDelete(proxy.id)}
                              className="p-2 hover:bg-red-500/10 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                         </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Import */}
      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-gray-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
               <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-500" />
                  Nhập danh sách Proxy (Bulk Import)
               </h3>
               <button onClick={() => setIsAdding(false)} className="p-2 hover:bg-white/10 text-gray-500 hover:text-white rounded-full transition-all">
                  <XCircle className="w-6 h-6" />
               </button>
            </div>
            
            <div className="p-8 space-y-6">
               <div className="space-y-4">
                  <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl flex items-start gap-4">
                     <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                     <div className="text-sm text-gray-400 leading-relaxed">
                        Chấp nhận các định dạng: <br/>
                        <code className="text-blue-300">host:port</code> | 
                        <code className="text-blue-300"> host:port:user:pass</code> | 
                        <code className="text-blue-300"> protocol://user:pass@host:port</code>
                     </div>
                  </div>

                  <textarea
                    rows={10}
                    placeholder="Dán danh sách proxy vào đây (mỗi dòng 1 proxy)..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-secondary font-mono"
                  />
               </div>

               <div className="flex items-center justify-end gap-4 pt-4">
                  <button
                    onClick={() => setIsAdding(false)}
                    className="px-6 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleAddProxies}
                    disabled={!importText.trim() || loading}
                    className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/40 transition-all flex items-center gap-2"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Thêm ngay
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
