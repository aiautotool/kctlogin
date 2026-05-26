# KCT Login

App tách riêng từ `apphotro`, chỉ giữ 2 nhóm chức năng:

- Profiles: tạo/sửa/clone/xóa profile, random fingerprint, gắn proxy, chạy/dừng Chrome profile, mở đăng nhập Google, lưu cookie ChatGPT/Gemini.
- Proxy Manager: import proxy hàng loạt, fetch proxy free, check sống/chết, geo/latency, xóa proxy.

## Chạy dev

```bash
npm install
npm run dev
```

Dev ports:

- UI/Electron renderer: `http://localhost:5174`
- API server: `http://localhost:3002`

Dữ liệu profile/proxy được lưu riêng trong `server/data`, không dùng chung với `apphotro`.

## MCP local

Chạy MCP server qua stdio:

```bash
npm run mcp:stdio
```

API metadata cho MCP:

- `GET http://localhost:3002/api/mcp`

Tool MCP hiện có: health, list/get/launch/stop/repair profile, list/import/check proxy, get/save cookies.
