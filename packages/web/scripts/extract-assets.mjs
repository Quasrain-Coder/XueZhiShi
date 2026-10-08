// 从规则书扫描页（docs/assets-src/page_0X.jpg，1219×1754）裁切原版美术素材。
// 产物输出到 packages/web/public/assets/。用法：npm run extract-assets -w @xzs/web
import { Jimp } from 'jimp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../../../docs/assets-src');
const OUT = join(here, '../public/assets');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'cards'), { recursive: true });
mkdirSync(join(OUT, 'totems'), { recursive: true });
mkdirSync(join(OUT, 'portraits'), { recursive: true });

/** [源页, x, y, w, h, 输出名, 放大倍数(可选)] */
const crops = [
  // 版图（含计分轨与树）
  ['page_03.jpg', 355, 560, 480, 1010, 'board.jpg', 2],
  // 封面（首页背景）
  ['page_01.jpg', 40, 30, 1140, 1690, 'cover.jpg'],
  // 卡背（5 色）
  ['page_02.jpg', 433, 1337, 86, 136, 'cards/back-blue.jpg', 2],
  ['page_02.jpg', 227, 1337, 86, 136, 'cards/back-pink.jpg', 2],
  ['page_02.jpg', 103, 1347, 117, 176, 'cards/back-yellow.jpg', 2],
  ['page_02.jpg', 330, 1337, 86, 136, 'cards/back-gray.jpg', 2],
  ['page_02.jpg', 540, 1337, 86, 136, 'cards/back-red.jpg', 2],
  // 特殊牌（第 6 页大图）
  ['page_06.jpg', 75, 855, 150, 290, 'cards/healer.jpg', 2],
  ['page_06.jpg', 75, 1160, 150, 290, 'cards/watcher.jpg', 2],
  ['page_06.jpg', 75, 1415, 150, 290, 'cards/blizzard.jpg', 2],
  // 果实 token
  ['page_02.jpg', 295, 1055, 55, 60, 'fruit.png', 2],
  // 奖励图标
  ['page_06.jpg', 150, 150, 110, 165, 'bonus-mana.png', 2],
  ['page_06.jpg', 463, 153, 104, 154, 'bonus-fight.png', 2],
  ['page_06.jpg', 777, 153, 103, 154, 'bonus-fruit.png', 2],
  // 图腾标记（计分轨用）
  ['page_03.jpg', 75, 1420, 48, 140, 'totems/blue.png', 2],
  ['page_03.jpg', 128, 1420, 48, 140, 'totems/pink.png', 2],
  ['page_03.jpg', 182, 1420, 48, 140, 'totems/yellow.png', 2],
  ['page_03.jpg', 236, 1420, 48, 140, 'totems/gray.png', 2],
  ['page_03.jpg', 290, 1420, 48, 140, 'totems/red.png', 2],
  // 角色头像（封面底部五勇士）
  ['page_01.jpg', 90, 1440, 180, 260, 'portraits/gray.jpg'],
  ['page_01.jpg', 300, 1440, 180, 260, 'portraits/pink.jpg'],
  ['page_01.jpg', 555, 1440, 190, 260, 'portraits/red.jpg'],
  ['page_01.jpg', 815, 1440, 185, 260, 'portraits/yellow.jpg'],
  ['page_01.jpg', 1000, 1440, 180, 260, 'portraits/blue.jpg'],
];

for (const [page, x, y, w, h, out, scale] of crops) {
  const img = await Jimp.read(join(SRC, page));
  img.crop({ x, y, w, h });
  if (scale) img.scale(scale);
  const dest = join(OUT, out);
  await img.write(dest, out.endsWith('.jpg') ? { quality: 72 } : {});
  console.log('✓', out);
}
console.log('done →', OUT);
