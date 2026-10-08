# XueZhiShi · 雪之时

《雪之时》桌游的本地自托管数字实现：浏览器多人对战（局域网/公网）、
可选 LLM 驱动的 AI 座位、赛后复盘辅导。

> 项目模式沿用 [BrassBirmingham](https://github.com/Quasrain-Coder/BrassBirmingham) 的经验：
> 权威 WS 服务器 + 浏览器客户端 + SQLite 对局历史，按里程碑推进。

**状态：M0 立项。** 规则电子化（`docs/rules-reference.md`）与设计文档
（`docs/superpowers/specs/`）先行，随后按里程碑实现。

## 里程碑（草案，随设计文档细化）

- **M1 规则引擎**：纯函数核心，胜负判定/回合推进，vitest 全覆盖
- **M2 服务器**：权威 WS 服务器、房间/重连、SQLite 历史
- **M3 客户端**：浏览器 UI，vite + React
- **M4 AI 座位**：LLM 驱动 + 启发式兜底
- **M5 复盘**：赛后走子点评

## Quick start（随实现补全）

```bash
# 待 M2/M3 落地
```
