// Scene themes, story fonts, character colours and contrast handling.

export const THEMES = {
  paper: { label: 'Paper', bg: '#fbfaf7', surface: '#ffffff', text: '#1d1c1a', muted: '#6b675f', border: '#e6e2da', accent: '#3b5bdb', narrator: '#f3f1ec', dark: false },
  parchment: { label: 'Parchment', bg: '#f4ecd8', surface: '#faf4e4', text: '#3a2a1a', muted: '#7a6650', border: '#e0d2b4', accent: '#8a4b14', narrator: '#ece0c4', dark: false },
  slate: { label: 'Slate', bg: '#22252b', surface: '#2b2f36', text: '#e8e9ec', muted: '#a0a6b0', border: '#3a3f48', accent: '#8ab4ff', narrator: '#2f333b', dark: true },
  midnight: { label: 'Midnight', bg: '#111a2e', surface: '#18223a', text: '#f1ece2', muted: '#a3aac0', border: '#27324d', accent: '#f0c674', narrator: '#1b2641', dark: true },
  forest: { label: 'Forest', bg: '#141c17', surface: '#1b2620', text: '#dfe8dc', muted: '#9bb09e', border: '#2a382f', accent: '#9fd49b', narrator: '#1f2b24', dark: true },
  contrast: { label: 'High contrast', bg: '#ffffff', surface: '#ffffff', text: '#000000', muted: '#3d3d3d', border: '#000000', accent: '#0033cc', narrator: '#f0f0f0', dark: false },
};

export const FONTS = {
  lora: { label: 'Lora', note: 'Book serif', stack: "'Lora', Georgia, serif" },
  classic: { label: 'Classic', note: 'Elegant serif', stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, Charter, Georgia, serif" },
  inter: { label: 'Inter', note: 'Clean sans', stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  readable: { label: 'Readable', note: 'Wide and clear', stack: "Verdana, 'Atkinson Hyperlegible', Tahoma, sans-serif" },
  typewriter: { label: 'Typewriter', note: 'Letters and logs', stack: "'Courier Prime', 'American Typewriter', 'Courier New', ui-monospace, monospace" },
};

export const TEXT_SIZES = { s: 15, m: 17, l: 19, xl: 22 };

export const PALETTE = [
  '#c92a2a', '#e8590c', '#f08c00', '#a88400', '#5c940d', '#2b8a3e', '#0b7285', '#1971c2',
  '#3b5bdb', '#6741d9', '#9c36b5', '#c2255c', '#862e2e', '#795548', '#495057', '#0ca678',
];

export function themeOf(key) {
  return THEMES[key] || THEMES.paper;
}

export function fontOf(key) {
  return FONTS[key] || FONTS.lora;
}

export function themeStyle(key, fontKey, size = 'm') {
  const t = themeOf(key);
  return {
    '--bg': t.bg,
    '--surface': t.surface,
    '--text': t.text,
    '--muted': t.muted,
    '--border': t.border,
    '--accent': t.accent,
    '--narrator': t.narrator,
    '--primary': t.text,
    '--on-primary': t.bg,
    '--story-font': fontOf(fontKey).stack,
    '--story-size': `${TEXT_SIZES[size] || 17}px`,
    colorScheme: t.dark ? 'dark' : 'light',
  };
}

// ---- colour maths ----------------------------------------------------------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

function lum(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const cache = new Map();

// The character's colour, nudged lighter or darker until it reads as text on this background.
export function readableColor(hex, bg, min = 4.5) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
  const k = `${hex}|${bg}|${min}`;
  if (cache.has(k)) return cache.get(k);
  let out = hex;
  if (contrast(hex, bg) < min) {
    const [h, s, l0] = rgbToHsl(hexToRgb(hex));
    const goLighter = lum(bg) < 0.2;
    let l = l0;
    for (let i = 0; i < 60; i++) {
      l = goLighter ? Math.min(1, l + 0.02) : Math.max(0, l - 0.02);
      out = rgbToHex(hslToRgb([h, s, l]));
      if (contrast(out, bg) >= min) break;
    }
  }
  cache.set(k, out);
  return out;
}

// Card background of the app chrome (outside scenes), which follows the device's light/dark setting.
export function chromeSurface() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? '#1f2024' : '#ffffff';
}

export function textOn(hex) {
  return contrast(hex, '#ffffff') >= contrast(hex, '#111111') ? '#ffffff' : '#111111';
}
