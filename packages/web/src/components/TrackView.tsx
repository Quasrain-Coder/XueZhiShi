import { TRACK, type ColorId } from '@xzs/engine';
import type { ViewState } from '@xzs/protocol';
import { COLOR_CSS } from '../theme.js';

/** 计分轨侧栏：28 格线性展示 + 奖励图标 + 图腾位置。 */
export function TrackView({ state }: { state: ViewState }) {
  const posOf = new Map<number, ColorId[]>();
  for (const p of state.players) {
    if (!posOf.has(p.trackPos)) posOf.set(p.trackPos, []);
    posOf.get(p.trackPos)!.push(p.color);
  }
  return (
    <div className="track">
      {TRACK.map((space, i) => {
        const here = posOf.get(i) ?? [];
        return (
          <div key={i} className={`track-space ${space.finish ? 'track-finish' : ''} ${space.start ? 'track-start' : ''}`}>
            <span className="track-idx">{space.start ? '起' : space.finish ? '终' : i}</span>
            {space.bonus && (
              <img
                className="track-bonus"
                src={`/assets/bonus-${space.bonus}.png`}
                alt={`${space.bonus}+${space.value}`}
                title={`${space.bonus} +${space.value}`}
                draggable={false}
              />
            )}
            <span className="track-totems">
              {here.map((c) => (
                <img key={c} src={`/assets/totems/${c}.png`} alt={c} style={{ borderColor: COLOR_CSS[c] }} draggable={false} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
