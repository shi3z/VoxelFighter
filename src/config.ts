/** 調整用の設定。実行時に書き換え可能（window.__cfg からも触れる）。 */
export const config = {
  seed: 7,
  fixedStep: 1 / 60,
  render: {
    /** 内部描画解像度の縦ピクセル数（横はアスペクト比から算出）。640x360相当 = 360 */
    height: 360,
    dither: true,
    /** 1チャンネルあたりの階調数 */
    levels: 30,
  },
  flight: {
    minSpeed: 62,
    maxSpeed: 118,
    boostExtra: 62,
    accel: 46,
    pitchRate: 1.45,
    yawRate: 0.85,
    rollRate: 3.4,
    /** 入力に対する角速度の追従性（大きいほど機敏） */
    response: 6.5,
    bankTurn: 1.05,
    autoLevel: 1.5,
    gravityPitch: 30,
    invertPitch: false,
    startAltitude: 150,
    /** 開始位置(XZ)。広い海と遠景の群島が見える場所 */
    startX: -300,
    startZ: 2400,
    boostDrain: 0.33,
    boostRegen: 0.14,
  },
  camera: {
    fov: 62,
    fovBoost: 15,
    chase: { distance: 30, height: 9 },
    far: { distance: 90, height: 28 },
    freeDistance: 48,
    /** 位置のバネ定数/減衰 */
    posStiffness: 85,
    posDamping: 16,
    /** 回転のバネ定数/減衰 */
    rotStiffness: 38,
    rotDamping: 11.5,
    rollFollow: 0.42,
    pitchDown: 0.2,
  },
  combat: {
    enemyCount: 6,
    enemyHp: 60,
    playerHp: 100,
    bulletSpeed: 560,
    bulletLife: 1.8,
    fireRate: 12,
    playerDamage: 20,
    enemyDamage: 4,
    aimAssist: 0.55,
    respawnDelay: 5,
  },
  world: {
    cell: 4,
    step: 3,
    chunkCells: 64,
    /** チャンク半径（チャンク数） */
    viewRadius: 9,
    fogNear: 450,
    fogFar: 2500,
    seaFloorY: -30,
  },
};

export type Config = typeof config;
