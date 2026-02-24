function readInt(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const GAME_GRID_WIDTH = readInt(process.env.GAME_GRID_WIDTH, 100);
export const GAME_GRID_HEIGHT = readInt(process.env.GAME_GRID_HEIGHT, 56);
export const GAME_TICK_RATE = readInt(process.env.GAME_TICK_RATE, 10);
