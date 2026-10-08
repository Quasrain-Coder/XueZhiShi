# XueZhiShi（雪之时）— 设计文档

v1.0，2026-10-08

> 《Snow Time / 雪之时》桌游的非官方、非商业数字实现（个人游玩）：浏览器多人对局 + LLM/启发式 AI 座位 + 赛后复盘（预留）。
> 允许使用原版美术（规则书扫描件提取）作为个人非商用素材（见 README Legal note）。规则唯一事实来源：`docs/rules-reference.md`。

## 1. 目标与范围

- 完整规则：2–5 人，含 2 人变体（每人 2 色）
- 浏览器联机（局域网/公网自托管），权威 WS 服务器 + 房间短码
- AI 座位：启发式兜底 + 可选 LLM（Claude API，环境变量配置），行动空间受引擎硬约束
- SQLite（node:sqlite）持久化对局与 action log；断线重连凭 token
- 原版美术：从规则书 PDF 扫描页裁切（`packages/web/scripts/extract-assets.mjs`，源扫描存 `docs/assets-src/`，产物在 `packages/web/public/assets/`）
- 非目标（YAGNI）：账号体系、聊天、移动端原生应用、MCTS、逐像素还原

## 2. 总体架构

TypeScript monorepo（npm workspaces）：

```
packages/
  engine/    # 纯 TS、零依赖：完整规则 + 合法行动枚举 + 状态机，确定性、可单测
  protocol/  # WS 消息与视图类型（server/web 共享）
  server/    # Node + ws 权威服务器，房间管理，node:sqlite 落库，AI 座位驱动
  web/       # React + Vite 客户端，原版美术
  llm/       # PlayerAgent 接口 + Random/Heuristic/Claude LLM 实现
```

核心边界：**规则只在 engine 结算**；server/web/llm 不各自实现规则逻辑。LLM 只做选择，合法性永远由引擎裁决。

## 3. 规则引擎（engine）

### 状态（GameState，纯数据，可 JSON 序列化）

- `players[]`：颜色、手牌、角色弃牌堆（可回收）、永久弃牌区（Watcher/Blizzard）、计分轨位置、本轮已得三类分（奖励格判定用）
- `tree`：7 层各自的角色牌占用（出牌阶段后填充）与果实数
- `fruitReserve`：0–15
- `phase`：`submit | watcher | healer | finished`（果实放置与回合结算均为自动，无决策）
- `submissions` / `watcherCards`：暗扣牌，未齐前引擎内记录、视图层过滤
- `pending`：当前待决策座位列表（watcher/healer 阶段）
- `rngState`：mulberry32 种子状态；`round`；`winner`；`log`（回合事件流，供前端战报与复盘）

### 行动（Action，discriminated union）

`submit-card` / `watcher-play` / `healer-recover`。核心函数：

```ts
enumerateActions(state): Action[]        // 当前全部合法行动（含座位）
applyAction(state, action): GameState    // 纯函数；非法行动抛结构化错误
newGame(colors, seed): GameState
```

同一阶段多个座位的决策互不依赖，可同时提交；最后一个决策到达时引擎自动推进回合结算（战斗→果实→法力→奖励→收尾→下一回合放果实），中途触发胜利立即中断。

### 规则数值配置化

计分轨布局（28 格，见 rules-reference §6）、牌组构成、果实数等放 `engine/data/`，与规则逻辑分离。

## 4. 服务器、房间与同步（server）

- 房间生命周期：`创建 → 大厅 → 对局中 → 结束 → 存档`；6 位短码；昵称 + op token（localStorage）断线重连
- AI 座位：大厅中把空位标记为 AI（heuristic / llm），开始后由服务器驱动
- 同步协议（WS/JSON，见 protocol 包）：
  - 下行：`room_state`（大厅）、`state_snapshot`（按座位视角过滤：仅隐藏本轮未齐的暗扣牌）、`action_applied`、`error`、`credentials`（私密 token 单发）
  - 上行：`create_room` / `join_room` / `start_game` / `submit_action` / `ping`
- 全量快照 + 递增 seq（状态极小）；断线重连拉最新快照
- 持久化（node:sqlite）：`games`（配置、种子、终态、时间）、`actions`（game_id, seq, player, action JSON）、`seats`（token 重连凭据）
- 声明：服务器重启即丢进行中的对局
- 真人回合无强制超时

## 5. AI 玩家（llm 包）

原则：LLM 只做「选择」，规则结算永远在引擎。

- `PlayerAgent` 接口：`chooseAction(state, legalActions, seat) → Action`
- `RandomAgent`（测试）、`HeuristicAgent`（默认）：按果实期望/战斗风险/法力站位/手牌管理打分，watcher/healer 用简单规则
- `ClaudeAgent`（可选，`ANTHROPIC_API_KEY`）：结构化局势摘要 + 候选行动列表，tool use 强制返回候选编号；非法 → 重试一次 → 降级 Heuristic
- 服务器在 AI 座位需要决策时驱动 agent，连续异常降级 Heuristic，对局永不卡死

## 6. 客户端（web）

- React + Vite；页面：首页（创建/加入）→ 大厅 → 对局 → 结算
- 对局视图以原版版图扫描为背景：计分轨 28 格坐标映射叠放图腾；树 7 层叠放果实与角色牌；手牌/弃牌/永久弃牌区；回合事件战报流
- 暗拍出牌 UI：选手牌 → 提交；watcher/healer 决策点弹层
- 美术全部来自 `packages/web/public/assets/`（提取脚本见 §1）

## 7. 复盘（M5，预留）

- 对局落库后可重放；报告生成接口预留，本期不实现

## 8. 里程碑

- **M1** engine + vitest 全覆盖
- **M2** server（WS/房间/重连/SQLite）
- **M3** web（UI + 美术）
- **M4** AI 座位（heuristic + 可选 LLM）
- **M5** 复盘（预留）

本次提交覆盖 M1–M4 基础版。
