import { isCharacter, type CardId, type ColorId } from '@xzs/engine';
import { COLOR_CSS } from '../theme.js';

export function CardView({
  color,
  card,
  faceDown = false,
  small = false,
  selected = false,
  onClick,
}: {
  color: ColorId;
  card: CardId;
  faceDown?: boolean;
  small?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const cls = `card ${small ? 'card-small' : ''} ${selected ? 'card-selected' : ''} ${onClick ? 'card-click' : ''}`;
  if (faceDown) {
    return (
      <div className={cls} onClick={onClick}>
        <img src={`/assets/cards/back-${color}.jpg`} alt="卡背" draggable={false} />
      </div>
    );
  }
  if (isCharacter(card)) {
    return (
      <div className={cls} onClick={onClick} style={{ borderColor: COLOR_CSS[color] }}>
        <img className="card-portrait" src={`/assets/portraits/${color}.jpg`} alt="" draggable={false} />
        <span className="card-number" style={{ color: COLOR_CSS[color] }}>
          {card}
        </span>
      </div>
    );
  }
  const names = { healer: 'Healer', watcher: 'Watcher', blizzard: 'Blizzard' } as const;
  return (
    <div className={`${cls} card-special`} onClick={onClick} style={{ borderColor: COLOR_CSS[color] }}>
      <img src={`/assets/cards/${card}.jpg`} alt={names[card]} draggable={false} />
      <span className="card-special-name">{names[card]}</span>
    </div>
  );
}
