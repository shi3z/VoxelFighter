/** パレット色インデックス。0 = 空。 */
export const P = {
  EMPTY: 0,
  BLACK: 1,
  DG1: 2,
  DG2: 3,
  GREY: 4,
  LGREY: 5,
  PALE: 6,
  ORANGE: 7,
  ORANGE_D: 8,
  TEAL: 9,
  TEAL_D: 10,
  TEAL_L: 11,
  WHITE: 12,
  CLOUD_SIDE: 13,
  CLOUD_SIDE2: 14,
  CLOUD_BOT: 15,
  SKIN: 16,
  RED: 17,
  YELLOW: 18,
  E_DARK: 19,
  E_MID: 20,
  E_LIGHT: 21,
  E_ACCENT: 22,
  E_GLASS: 23,
  CHUTE_RED: 24,
  CHUTE_WHITE: 25,
  ROPE: 26,
  SUIT: 27,
  HELMET: 28,
} as const;

const HEX: number[] = [
  0x000000,
  0x14161c, // BLACK
  0x242830, // DG1
  0x363b46, // DG2
  0x5a606d, // GREY
  0x9aa2b0, // LGREY
  0xcdd3dd, // PALE
  0xea5a1c, // ORANGE
  0xb23a10, // ORANGE_D
  0x1f9096, // TEAL
  0x146b73, // TEAL_D
  0x5acbc6, // TEAL_L
  0xffffff, // WHITE
  0xe2eefa, // CLOUD_SIDE
  0xbcd2ea, // CLOUD_SIDE2
  0x93acd0, // CLOUD_BOT
  0xe9b58d, // SKIN
  0xd8321e, // RED
  0xffd23a, // YELLOW
  0x3a1426, // E_DARK
  0x6c2438, // E_MID
  0xa8404f, // E_LIGHT
  0xf2c232, // E_ACCENT
  0xff6a5a, // E_GLASS
  0xe0301f, // CHUTE_RED
  0xf6f2ea, // CHUTE_WHITE
  0xdddddd, // ROPE
  0xe66a1e, // SUIT
  0xf2f2f2, // HELMET
];

const RGB: [number, number, number][] = HEX.map((h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);

export function paletteRGB(i: number): [number, number, number] {
  return RGB[i] ?? RGB[1];
}
export function paletteHex(i: number): number {
  return HEX[i] ?? 0;
}
export const PALETTE_SIZE = HEX.length;
