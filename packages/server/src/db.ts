import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, ColorId, GameState } from '@xzs/engine';

/** SQLite 持久化（node:sqlite）：对局、action log、座位凭据。 */
export class GameStore {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'xuezhishi.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        seed INTEGER NOT NULL,
        colors TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        winner TEXT,
        final_state TEXT
      );
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        player TEXT NOT NULL,
        action TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        color TEXT NOT NULL,
        nickname TEXT NOT NULL,
        token TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_actions_game ON actions(game_id, seq);
    `);
  }

  createGame(code: string, seed: number, colors: ColorId[]): number {
    const stmt = this.db.prepare(
      'INSERT INTO games (code, seed, colors, created_at) VALUES (?, ?, ?, ?)',
    );
    const res = stmt.run(code, seed, JSON.stringify(colors), new Date().toISOString());
    return Number(res.lastInsertRowid);
  }

  saveSeat(gameId: number, color: ColorId, nickname: string, token: string): void {
    this.db
      .prepare('INSERT INTO seats (game_id, color, nickname, token) VALUES (?, ?, ?, ?)')
      .run(gameId, color, nickname, token);
  }

  appendAction(gameId: number, seq: number, player: ColorId, action: Action): void {
    this.db
      .prepare('INSERT INTO actions (game_id, seq, player, action) VALUES (?, ?, ?, ?)')
      .run(gameId, seq, player, JSON.stringify(action));
  }

  finishGame(gameId: number, winner: ColorId, finalState: GameState): void {
    this.db
      .prepare('UPDATE games SET finished_at = ?, winner = ?, final_state = ? WHERE id = ?')
      .run(new Date().toISOString(), winner, JSON.stringify(finalState), gameId);
  }

  listGames(): { id: number; code: string; winner: string | null; created_at: string; finished_at: string | null }[] {
    return this.db
      .prepare('SELECT id, code, winner, created_at, finished_at FROM games ORDER BY id DESC LIMIT 100')
      .all() as never[];
  }

  close(): void {
    this.db.close();
  }
}
