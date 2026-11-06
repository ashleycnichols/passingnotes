// Story text: *italic*, **bold**, line breaks, and character tags.
// Tags are stored as @[Name](characterId) and typed as @Name.

const TAG_RE = /@\[([^\]\n]{1,60})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Typed text -> stored text. Matches the longest names first so "Ann Lee" wins over "Ann".
export function encodeTags(text, characters) {
  const sorted = [...characters].filter((c) => c.name).sort((a, b) => b.name.length - a.name.length);
  const tagged = new Set();
  // Protect tags that are already encoded.
  const existing = [];
  let out = text.replace(TAG_RE, (m, _n, id) => {
    tagged.add(id.toLowerCase());
    existing.push(m);
    return `\u0000${existing.length - 1}\u0000`;
  });
  for (const c of sorted) {
    const re = new RegExp(`@${escapeRe(c.name)}(?![\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(re, () => {
      tagged.add(c.id);
      existing.push(`@[${c.name}](${c.id})`);
      return `\u0000${existing.length - 1}\u0000`;
    });
  }
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => existing[Number(i)]);
  return { body: out, tagged: [...tagged] };
}

// Stored text -> typed text, using current names.
export function decodeTags(body, charsById) {
  return body.replace(TAG_RE, (_m, name, id) => `@${charsById[id.toLowerCase()]?.name || name}`);
}

export function plainText(body, charsById, { markdown = false } = {}) {
  let t = body.replace(TAG_RE, (_m, name, id) => charsById[id.toLowerCase()]?.name || name);
  if (!markdown) t = t.replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/\*([^*\n]+?)\*/g, '$1');
  return t;
}

export function firstLine(body, charsById, max = 90) {
  const t = plainText(body, charsById).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---- rendering -------------------------------------------------------------

const INLINE_RE = new RegExp(
  `(${TAG_RE.source})|(\\*\\*(?=\\S)([^\\n]*?\\S)\\*\\*)|(\\*(?=[^\\s*])([^*\\n]*?[^\\s*])\\*)`,
  'gi',
);

function renderInline(text, ctx, keyBase) {
  const out = [];
  let last = 0;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  const re = new RegExp(INLINE_RE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) {
      const id = m[3].toLowerCase();
      const c = ctx.charsById[id];
      const color = c ? ctx.colorFor(c.color) : null;
      out.push(
        <strong key={k} className="tag" style={color ? { color } : undefined}>
          {c?.name || m[2]}
        </strong>,
      );
    } else if (m[4]) {
      out.push(<strong key={k}>{renderInline(m[5], ctx, k)}</strong>);
    } else if (m[6]) {
      out.push(<em key={k}>{renderInline(m[7], ctx, k)}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ body, ctx }) {
  const paras = body.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return paras.map((p, pi) => {
    const lines = p.split('\n');
    return (
      <p key={pi}>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderInline(line, ctx, `${pi}-${li}`)}
          </span>
        ))}
      </p>
    );
  });
}

// Simple HTML for rich-text clipboard export.
export function toHtml(body, ctx) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let t = esc(body).replace(TAG_RE, (_m, name, id) => {
    const c = ctx.charsById[id.toLowerCase()];
    return `<b style="color:${c ? c.color : 'inherit'}">${esc(c?.name || name)}</b>`;
  });
  t = t.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<b>$1</b>').replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, '<i>$1</i>');
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// What has the user typed right before the caret? Used for the @ suggestion list.
export function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]*(?: [^\s@]*){0,2})$/u);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1 };
}
