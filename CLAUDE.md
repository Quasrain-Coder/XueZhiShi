# CLAUDE.md

> XueZhiShi — 《雪之时》桌游的浏览器实现（多人 + LLM AI + 赛后复盘）。
> **开发前先读 `docs/superpowers/specs/` 下的设计文档**；架构/协议/里程碑的既有决策以它为准。
> 规则以 `docs/rules-reference.md` 为唯一事实来源，规则文档未覆盖的边界先补文档再写代码。

## 开发约定（沿用 BrassBirmingham 实践）

- 分支 → typecheck/test 全绿 → PR → squash 合并；本机无 gh CLI，用 GitHub REST API + `$GH_TOKEN`
- 服务器代码放 `packages/server`，客户端放 `packages/web`（monorepo，npm workspaces）
- 规则引擎保持纯函数、可被服务器与测试直接调用，不耦合 IO
- 线上部署进程重启用精确 PID，禁止 pkill 模糊匹配
