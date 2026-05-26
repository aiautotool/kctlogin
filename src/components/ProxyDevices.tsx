import { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, Copy, Loader2, Plus, RefreshCw, Smartphone, Trash2, XCircle } from 'lucide-react';

const API_BASE = '/api';

interface ProxyDevice {
  id: string;
  name: string;
  model?: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
  notes?: string;
  proxyStatus: 'connected' | 'disconnected' | 'checking' | 'unknown';
  smsStatus: 'ready' | 'offline' | 'unknown';
  ip?: string;
  country?: string;
  countryCode?: string;
  lastChecked?: number;
  proxyId?: string;
}

const emptyForm = {
  name: '',
  model: '',
  host: '',
  port: '8080',
  protocol: 'http' as ProxyDevice['protocol'],
  username: '',
  password: '',
  notes: '',
  smsStatus: 'unknown' as ProxyDevice['smsStatus'],
};

export function ProxyDevices() {
  const [devices, setDevices] = useState<ProxyDevice[]>([]);
  const [network, setNetwork] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [checkingId, setCheckingId] = useState('');
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const [devicesRes, networkRes] = await Promise.all([
        axios.get(`${API_BASE}/proxy-devices`),
        axios.get(`${API_BASE}/proxy-devices/network`),
      ]);
      setDevices(devicesRes.data);
      setNetwork(networkRes.data.addresses || []);
    } catch (error) {
      console.error('Không thể tải proxy devices:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createDevice = async () => {
    try {
      await axios.post(`${API_BASE}/proxy-devices`, {
        ...form,
        port: Number(form.port),
      });
      setForm(emptyForm);
      setIsCreating(false);
      load();
    } catch (error: any) {
      alert(`Không thể tạo device: ${error.response?.data?.error || error.message}`);
    }
  };

  const checkDevice = async (id: string) => {
    setCheckingId(id);
    try {
      await axios.post(`${API_BASE}/proxy-devices/${id}/check`);
      load();
    } catch (error: any) {
      alert(`Không thể check device: ${error.response?.data?.error || error.message}`);
      load();
    } finally {
      setCheckingId('');
    }
  };

  const addToProxyManager = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/proxy-devices/${id}/add-proxy`);
      alert('Đã thêm thiết bị vào Proxy Manager. Bạn có thể chọn proxy này trong profile.');
      load();
    } catch (error: any) {
      alert(`Không thể thêm proxy: ${error.response?.data?.error || error.message}`);
    }
  };

  const deleteDevice = async (id: string) => {
    if (!confirm('Xóa proxy device này?')) return;
    await axios.delete(`${API_BASE}/proxy-devices/${id}`).catch(() => alert('Không thể xóa device'));
    load();
  };

  const proxyInput = `${form.protocol}://${form.username ? `${form.username}:${form.password}@` : ''}${form.host || '<device-ip>'}:${form.port || '<port>'}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-400" />
            Proxy Devices
            <span className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300">BETA</span>
          </h2>
          <p className="text-sm text-gray-400">Kết nối điện thoại/thiết bị thật làm proxy cho profile.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button onClick={() => setIsCreating(true)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400">
            <Plus className="w-4 h-4" />
            Create Device
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="glass-effect rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1.2fr_1fr_150px_140px_120px_140px] border-b border-white/10 bg-white/[0.03] px-5 py-4 text-xs font-semibold uppercase text-gray-500">
            <span>Name</span>
            <span>Model</span>
            <span>Proxy Status</span>
            <span>SMS Status</span>
            <span>IP</span>
            <span className="text-right">Actions</span>
          </div>

          {devices.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <p className="text-xl font-medium text-gray-200">No devices found</p>
              <p className="mt-2 text-sm text-gray-400">Create your first proxy device to get started</p>
              <button onClick={() => setIsCreating(true)} className="mt-8 text-sm font-medium text-gray-300 hover:text-white">
                Create Device
              </button>
            </div>
          ) : devices.map((device) => (
            <div key={device.id} className="grid grid-cols-[1.2fr_1fr_150px_140px_120px_140px] items-center border-b border-white/10 px-5 py-4 text-sm text-gray-300 last:border-b-0">
              <div>
                <p className="font-semibold text-gray-100">{device.name}</p>
                <p className="mt-1 font-mono text-[11px] text-gray-500">{device.protocol}://{device.host}:{device.port}</p>
              </div>
              <span>{device.model || '-'}</span>
              <StatusBadge status={device.proxyStatus} />
              <StatusBadge status={device.smsStatus} />
              <div>
                <p className="font-mono text-xs">{device.ip || '-'}</p>
                <p className="text-[11px] text-gray-500">{device.country || ''}</p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => checkDevice(device.id)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white" title="Check">
                  {checkingId === device.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </button>
                <button onClick={() => addToProxyManager(device.id)} className="rounded-lg p-2 text-gray-400 hover:bg-emerald-500/10 hover:text-emerald-300" title="Add to Proxy Manager">
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={() => navigator.clipboard.writeText(`${device.protocol}://${device.host}:${device.port}`)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white" title="Copy">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => deleteDevice(device.id)} className="rounded-lg p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-300" title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div className="glass-effect rounded-2xl p-5">
            <h3 className="text-lg font-semibold text-white">Cách kết nối thiết bị thật</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-gray-400">
              <p>1. Cho điện thoại và máy Mac cùng Wi-Fi, hoặc bật USB tethering.</p>
              <p>2. Trên điện thoại cài app proxy server như Every Proxy, Proxy Server, hoặc app tương tự.</p>
              <p>3. Bật HTTP/SOCKS proxy trên điện thoại, lấy IP LAN và port.</p>
              <p>4. Tạo device ở đây, bấm Check, rồi Add to Proxy Manager.</p>
            </div>
          </div>
          <div className="glass-effect rounded-2xl p-5">
            <h3 className="text-lg font-semibold text-white">IP máy hiện tại</h3>
            <div className="mt-4 space-y-2">
              {network.length ? network.map((item) => (
                <div key={`${item.name}-${item.address}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-xs text-gray-500">{item.name}</p>
                  <p className="font-mono text-sm text-gray-200">{item.address}</p>
                </div>
              )) : <p className="text-sm text-gray-500">Không thấy network IP.</p>}
            </div>
          </div>
        </div>
      </div>

      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-gray-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Create proxy device</h3>
                <p className="text-xs text-gray-500">Thiết bị thật đang chạy proxy server.</p>
              </div>
              <button onClick={() => setIsCreating(false)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white">×</button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} placeholder="iPhone 15 - Viettel" />
                <Field label="Model" value={form.model} onChange={(value) => setForm({ ...form, model: value })} placeholder="iPhone / Pixel / Samsung" />
                <Field label="Device IP / Host" value={form.host} onChange={(value) => setForm({ ...form, host: value })} placeholder="192.168.1.25" />
                <Field label="Port" value={form.port} onChange={(value) => setForm({ ...form, port: value })} placeholder="8080" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-gray-400">Protocol</span>
                  <select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as ProxyDevice['protocol'] })} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 outline-none">
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks4">SOCKS4</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </label>
                <Field label="Username" value={form.username} onChange={(value) => setForm({ ...form, username: value })} placeholder="optional" />
                <Field label="Password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} placeholder="optional" type="password" />
              </div>
              <label className="space-y-2 block">
                <span className="text-xs font-medium text-gray-400">Notes</span>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="SIM, carrier, location, SMS note..." className="min-h-20 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 outline-none resize-y" />
              </label>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Proxy string</p>
                <p className="mt-2 break-all font-mono text-sm text-gray-300">{proxyInput}</p>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                <button onClick={createDevice} className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-gray-950 hover:bg-emerald-400">Create Device</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-medium text-gray-400">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:ring-2 focus:ring-emerald-500/30" />
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const connected = status === 'connected' || status === 'ready';
  const bad = status === 'disconnected' || status === 'offline';
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
      connected ? 'bg-emerald-500/15 text-emerald-300' : bad ? 'bg-red-500/15 text-red-300' : 'bg-gray-500/15 text-gray-300'
    }`}>
      {connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : bad ? <XCircle className="w-3.5 h-3.5" /> : <span className="h-2 w-2 rounded-full bg-gray-400" />}
      {status}
    </span>
  );
}
