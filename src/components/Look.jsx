import { THEMES, FONTS, themeStyle, readableColor } from '../look.js';
import { Icon } from '../ui.jsx';

const SAMPLE = { name: 'Rowan', color: '#2b8a3e' };

export function LookPicker({ theme, font, onTheme, onFont }) {
  return (
    <div className="look-picker">
      <div className="field">
        <span>Theme</span>
        <div className="theme-grid">
          {Object.entries(THEMES).map(([k, t]) => (
            <button type="button" key={k} className={`theme-card${theme === k ? ' on' : ''}`} style={themeStyle(k, font)}
              onClick={() => onTheme(k)} aria-pressed={theme === k}>
              <span className="theme-sample">
                <span className="sample-name" style={{ color: readableColor(SAMPLE.color, t.bg) }}>{SAMPLE.name}</span>
                <span className="sample-text">The lamps flickered as she <em>finally</em> spoke.</span>
              </span>
              <span className="theme-label">{t.label}{theme === k && <Icon name="check" size={14} />}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Story font</span>
        <div className="font-list">
          {Object.entries(FONTS).map(([k, f]) => (
            <button type="button" key={k} className={`font-opt${font === k ? ' on' : ''}`} onClick={() => onFont(k)} aria-pressed={font === k}>
              <span style={{ fontFamily: f.stack }} className="font-name">{f.label}</span>
              <span className="muted small">{f.note}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
