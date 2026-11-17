import { config } from './config';
import { Game } from './game/Game';

// ?cfg=camera.freeDistance=22,render.height=240 のようにURLから設定を上書き可能
for (const kv of (new URLSearchParams(location.search).get('cfg') ?? '').split(',').filter(Boolean)) {
  const [path, val] = kv.split('=');
  const keys = path.split('.');
  let o: any = config;
  for (const k of keys.slice(0, -1)) o = o?.[k];
  if (o && keys[keys.length - 1] in o) o[keys[keys.length - 1]] = Number(val);
}

const game = new Game(document.getElementById('app')!);
game.start();

// デバッグ・調整用（コンソールから config や解像度を変更可能）
(window as unknown as Record<string, unknown>).__game = game;
(window as unknown as Record<string, unknown>).__cfg = config;
