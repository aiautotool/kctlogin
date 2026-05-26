# KCTLogin

KCTLogin la ung dung Electron de quan ly profile trinh duyet, fingerprint, proxy, cookies va API/MCP local.

## Chuc nang chinh

- Quan ly profile: tao, sua, clone, xoa, random fingerprint, chay/dung profile.
- Proxy Manager: import proxy hang loat, check proxy, xem geo/latency, xoa proxy.
- Proxy Devices: khai bao proxy theo thiet bi.
- Cookies: luu/xuat cookies cho ChatGPT/Gemini.
- API/MCP local: tao access token va dieu khien profile/proxy qua REST API hoac MCP stdio.

## Yeu cau

- Node.js 20 tro len.
- npm.
- macOS de build file `.dmg`.
- Windows de build file `.exe`.

Neu build installer, thu muc `vendor/` can ton tai day du vi app dong goi Orbita Browser va fonts tu thu muc nay.

## Cai dat

```bash
npm install
```

## Chay dev

```bash
npm run dev
```

Dev ports:

- Electron renderer: `http://localhost:5174`
- API server: `http://localhost:3002`

Du lieu profile, proxy, token va cookies duoc luu trong `server/data`.

## Build source

Lenh nay build frontend vao `dist/` va backend server vao `dist-server/`.

```bash
npm run build
```

## Build app cho macOS

Build file cai dat `.dmg`:

```bash
npm run dist:mac
```

Output nam trong `release/`, vi du:

```text
release/KCTLogin-0.1.0-arm64.dmg
```

Build dang thu muc `.app` de test nhanh:

```bash
npm run pack:mac
```

## Build app cho Windows

Nen chay tren may Windows de electron-builder tao installer on dinh nhat.

Build file cai dat `.exe`:

```bash
npm run dist:win
```

Output nam trong `release/`.

Build dang thu muc unpacked de test nhanh:

```bash
npm run pack:win
```

## MCP local

Chay MCP server qua stdio:

```bash
npm run mcp:stdio
```

API metadata cho MCP:

```text
GET http://localhost:3002/api/mcp
```

## Ghi chu khi dua len GitHub

- `dist/`, `dist-server/` va installer trong `release/` duoc dua len repo.
- `node_modules/`, du lieu runtime trong `server/data/`, `tmp/`, `vendor/` va thu muc unpacked trong `release/` khong dua len repo.
- File installer lon hon 100 MB can Git LFS hoac GitHub Releases.
