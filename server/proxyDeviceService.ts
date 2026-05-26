import { readJson, writeJson } from './jsonStore';
import { proxyService, type ProxyProtocol } from './proxyService';

export interface ProxyDevice {
  id: string;
  name: string;
  model?: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
  notes?: string;
  proxyStatus: 'connected' | 'disconnected' | 'checking' | 'unknown';
  smsStatus: 'ready' | 'offline' | 'unknown';
  ip?: string;
  country?: string;
  countryCode?: string;
  lastChecked?: number;
  createdAt: number;
  proxyId?: string;
}

class ProxyDeviceService {
  private devices: ProxyDevice[] = [];

  constructor() {
    this.devices = readJson<ProxyDevice[]>('proxy_devices.json', []);
  }

  private save() {
    writeJson('proxy_devices.json', this.devices);
  }

  getAll() {
    return [...this.devices].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getById(id: string) {
    return this.devices.find((device) => device.id === id);
  }

  create(input: Partial<ProxyDevice>) {
    if (!input.name?.trim()) throw new Error('Device name is required');
    if (!input.host?.trim()) throw new Error('Device host/IP is required');
    if (!input.port || Number.isNaN(Number(input.port))) throw new Error('Device port is required');

    const device: ProxyDevice = {
      id: Math.random().toString(36).slice(2, 11),
      name: input.name.trim(),
      model: input.model?.trim() || undefined,
      host: input.host.trim(),
      port: Number(input.port),
      protocol: input.protocol || 'http',
      username: input.username?.trim() || undefined,
      password: input.password || undefined,
      notes: input.notes?.trim() || undefined,
      proxyStatus: 'unknown',
      smsStatus: input.smsStatus || 'unknown',
      createdAt: Date.now(),
    };
    this.devices.unshift(device);
    this.save();
    return device;
  }

  update(id: string, updates: Partial<ProxyDevice>) {
    const index = this.devices.findIndex((device) => device.id === id);
    if (index === -1) return null;
    this.devices[index] = {
      ...this.devices[index],
      ...updates,
      id,
      port: updates.port === undefined ? this.devices[index].port : Number(updates.port),
    };
    this.save();
    return this.devices[index];
  }

  delete(id: string) {
    const before = this.devices.length;
    this.devices = this.devices.filter((device) => device.id !== id);
    this.save();
    return this.devices.length !== before;
  }

  async check(id: string) {
    const device = this.getById(id);
    if (!device) throw new Error('Proxy device not found');
    this.update(id, { proxyStatus: 'checking' });
    const checked = await proxyService.checkCustomProxy(
      `${device.protocol}://${device.host}:${device.port}`,
      device.username,
      device.password,
    );
    const updated = this.update(id, {
      proxyStatus: checked.status === 'alive' ? 'connected' : 'disconnected',
      ip: checked.geo?.ip,
      country: checked.geo?.country,
      countryCode: checked.geo?.countryCode,
      lastChecked: Date.now(),
    });
    return { device: updated, proxy: checked };
  }

  addToProxyManager(id: string) {
    const device = this.getById(id);
    if (!device) throw new Error('Proxy device not found');
    const auth = device.username
      ? `${encodeURIComponent(device.username)}:${encodeURIComponent(device.password || '')}@`
      : '';
    const input = `${device.protocol}://${auth}${device.host}:${device.port}`;
    const added = proxyService.addProxies(input, `Device: ${device.name}`);
    const proxy = added[0] || null;
    if (proxy) this.update(id, { proxyId: proxy.id });
    return proxy;
  }
}

export const proxyDeviceService = new ProxyDeviceService();
