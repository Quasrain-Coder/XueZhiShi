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
- `RandomAgent`（测试）、`HeuristicAgent`（轻量打分，备用）、`SimulationAgent`（默认 AI）：
  利用「亮牌后结算完全确定、对手手牌公开可推算」的特性，submit 阶段对每张候选牌
  采样 K 组对手暗拍（按静态价值加权），用引擎精确模拟整回合结算取期望收益最大者；
  watcher/healer 阶段信息全知，逐候选精确模拟取最优。收益函数：自身计分轨进展为主，
  弃牌损失/对手进展/手牌弹性为辅。采样用注入种子保证确定性（重放一致）
- **多样性与拟人化**（2026-10-09 迭代）：Boltzmann 择牌（只对「最优 EV − margin」内的
  近平局候选按温度采样，明显最优不受影响）+ 座位性格（小幅永久偏好，只够打破平局）。
  自对局「全 AI 同回合出同牌」率 19% → 7%；战术性撞层（互殴得分）保持不变。
  温度/边界可用 XZS_AI_TEMPERATURE / XZS_AI_MARGIN 调，→ 0 退化为纯 argmax
- **强度与公平性**（2026-10-09 二次迭代）：
  1. **修复信息泄露**：driveAi 此前把完整服务器状态传给 AI——后决策的 AI 能看到
     先决策玩家的暗扣牌（等于透视）。新增 engine/agentViewFor 按座位过滤，
     server/bench/测试统一走它；自对局胜者从一家独大（4/4）变为均匀分布
  2. **暗扣牌合法推理**：牌堆无重复且弃牌/已用特殊牌全公开，已暗扣但手牌打光的
     对手暗扣牌可精确推算（10 − 公开信息 = 唯一未销账牌），模拟中直接重建真实状态
  3. **终局权重**：自身得分乘紧迫度（1 + 0.8×进度），对手每分伤害按领先度二次放大
     （1.2 + 5×(进度/27)²）——终局压制意识
  4. **二回合前瞻**：当前回合结算后按静态代理推演下回合（下回合骰子已在 rng 路径滚定，
     无额外随机），折扣 γ=0.6——感知牌经济性
  5. **性能**：autoResolve 中 Healer 子决策改廉价启发式（回收静态价值最高的 2 张），
     消除「组合数 × 递归 × 采样 × 候选」大乘数；1400ms → 80ms/决策
  6. A/B 基准（同场对抗、交替座次）：新配置对旧配置 11/16 (69%)；组件分解
     both 75% > lookahead-only 63% > leader-only 50%（8 局）→ 默认 both
- `ClaudeAgent`（可选，`ANTHROPIC_API_KEY`）：结构化局势摘要 + 候选行动列表，tool use 强制返回候选编号；非法 → 重试一次 → 降级 SimulationAgent
- 服务器在 AI 座位需要决策时驱动 agent，连续异常降级，对局永不卡死
- 基准：`packages/llm/bench/sim-bench.ts`（`npx tsx bench/sim-bench.ts [局数] [采样数]`），
  2026-10-09 测定 SimulationAgent 对 HeuristicAgent 胜率 6/6，平均 ~0.26s/决策（60 采样）

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
