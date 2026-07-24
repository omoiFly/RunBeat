export function beatSample(beatIndex: number, sampleRate: number, targetSpm: number): number {
  return Math.round((beatIndex * sampleRate * 60) / targetSpm);
}

export function transitionDurationSeconds(bars: number, targetSpm: number): number {
  return bars * 4 * 60 / targetSpm;
}

export function equalPowerGains(progress: number): [number, number] {
  const p = Math.min(1, Math.max(0, progress));
  return [Math.cos(p * Math.PI * 0.5), Math.sin(p * Math.PI * 0.5)];
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
