import crypto from 'crypto';
import { readJson, writeJson } from './jsonStore';

export interface ApiTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt?: number;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

class ApiTokenService {
  private tokens: ApiTokenRecord[] = [];

  constructor() {
    this.tokens = readJson<ApiTokenRecord[]>('api_tokens.json', []);
  }

  private save() {
    writeJson('api_tokens.json', this.tokens);
  }

  list() {
    return this.tokens.map(({ tokenHash: _tokenHash, ...token }) => token);
  }

  create(name = 'API token') {
    const rawToken = `kct_${crypto.randomBytes(24).toString('hex')}`;
    const record: ApiTokenRecord = {
      id: Math.random().toString(36).slice(2, 11),
      name,
      tokenHash: hashToken(rawToken),
      createdAt: Date.now(),
    };
    this.tokens.unshift(record);
    this.save();
    return {
      ...record,
      tokenHash: undefined,
      token: rawToken,
    };
  }

  delete(id: string) {
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((token) => token.id !== id);
    this.save();
    return this.tokens.length !== before;
  }

  verify(rawToken?: string) {
    if (!rawToken) return false;
    const token = rawToken.replace(/^Bearer\s+/i, '').trim();
    const tokenHash = hashToken(token);
    const found = this.tokens.find((item) => item.tokenHash === tokenHash);
    if (!found) return false;
    found.lastUsedAt = Date.now();
    this.save();
    return true;
  }
}

export const apiTokenService = new ApiTokenService();
