// The screens the device check shows the page at, and how one is written in the URL:
// ?device=desktop|tablet|mobile, or a width in CSS pixels for a custom screen; &landscape=1 turns a tablet or a
// phone on its side.

export type Preset = 'desktop' | 'tablet' | 'mobile';

export interface Screen {
  /** the preset, or null for a custom width */
  preset: Preset | null;
  width: number;
  height: number;
  landscape: boolean;
}

export const PRESETS: { id: Preset; label: string; icon: string; width: number; height: number }[] = [
  { id: 'desktop', label: 'Desktop', icon: 'monitor', width: 1440, height: 900 },
  { id: 'tablet', label: 'Tablet', icon: 'tablet', width: 820, height: 1180 },
  { id: 'mobile', label: 'Mobile', icon: 'phone', width: 390, height: 844 },
];

export const MIN_WIDTH = 280;
export const MAX_WIDTH = 2560;
/** a custom screen is as tall as a laptop's */
const CUSTOM_HEIGHT = 900;

/** True for a value the URL may hold. */
export function validDevice(v: string | null): v is string {
  if (!v) return false;
  if (PRESETS.some((p) => p.id === v)) return true;
  return /^\d{3,4}$/.test(v) && Number(v) >= MIN_WIDTH && Number(v) <= MAX_WIDTH;
}

/** True when the screen can be turned on its side (a tablet or a phone). */
export const canRotate = (device: string) => device === 'tablet' || device === 'mobile';

/** The screen for a URL value (already valid). */
export function screenOf(device: string, landscape: boolean): Screen {
  const p = PRESETS.find((x) => x.id === device);
  if (!p) return { preset: null, width: Number(device), height: CUSTOM_HEIGHT, landscape: false };
  const turn = landscape && canRotate(device);
  return { preset: p.id, width: turn ? p.height : p.width, height: turn ? p.width : p.height, landscape: turn };
}

/** A width typed by the writer, kept inside the limits. */
export const clampWidth = (n: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)));
