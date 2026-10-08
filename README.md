# XueZhiShi · 雪之时

《雪之时 / Snow Time》桌游的本地自托管数字实现：浏览器多人对战（局域网/公网）、
可选 LLM 驱动的 AI 座位、赛后复盘（M5 预留）。

> 项目模式沿用 [BrassBirmingham](https://github.com/Quasrain-Coder/BrassBirmingham) 的经验：
> 权威 WS 服务器 + 浏览器客户端 + SQLite 对局历史。
> 规则以 [`docs/rules-reference.md`](docs/rules-reference.md) 为唯一事实来源；
> 架构决策见 [`docs/superpowers/specs/2026-10-08-xuezhishi-design.md`](docs/superpowers/specs/2026-10-08-xuezhishi-design.md)。

## 状态

M1–M4 基础版已落地：

- **M1 规则引擎** `packages/engine`：纯函数、零依赖，19 个 vitest 用例（含规则书 p.5 官方示例复现）
- **M2 服务器** `packages/server`：权威 WS + 房间短码 + 断线重连 + node:sqlite 落库；单端口托管静态资源
- **M3 客户端** `packages/web`：React + Vite，原版美术（规则书扫描件裁切）
- **M4 AI 座位**：启发式 AI + 可选 Claude LLM（`ANTHROPIC_API_KEY`）
- **M5 复盘**：预留（对局与 action log 已落库）

## Quick start

```bash
npm install
npm run build -w @xzs/web      # 构建前端（首次）
npm run start -w @xzs/server   # http://localhost:8787
```

开发模式（前后端热更新）：

```bash
npm run dev:server   # ws + 静态 :8787
npm run dev:web      # vite :5173（/ws 代理到 8787）
```

多人：同一局域网访问 `http://<主机IP>:8787`，创建房间后分享 6 位房间码。
2 人官方变体：建 4 色房间，每人认领 2 个颜色。

## 配置（`.env` 或环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `XZS_PORT` | 8787 | 服务端口 |
| `XZS_DATA_DIR` | `./server-data` | SQLite 数据目录 |
| `ANTHROPIC_API_KEY` | — | 配置后大厅可设 LLM 座位 |
| `XZS_LLM_MODEL` | claude-sonnet-4-5 | LLM 模型 |

## 美术素材

原版美术从规则书 PDF（`Snow_Time_Rules.pdf`）扫描页裁切：

```bash
npm run extract-assets -w @xzs/web   # docs/assets-src/*.jpg → packages/web/public/assets/
```

## 测试

```bash
npm run typecheck && npm test
```

## Legal note

本项目为个人非商业学习/游玩用途。《Snow Time》版权归 éditions « lui-même » 与作者 Frank Meyer、
画师 Naïade 所有；规则文字与美术素材仅用于个人游玩，不用于任何商业用途。
