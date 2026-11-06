import { useEffect, useState } from 'react';
import { getApi } from '../api.js';
import { Icon, Segmented, Sheet, toast, errMsg } from '../ui.jsx';
import { RichText, plainText, toHtml } from '../text.jsx';
import { themeStyle, themeOf, readableColor } from '../look.js';
import { dayLabel, downloadFile, fileSafe, copyText, clockTime } from '../util.js';
import { go } from '../router.js';
import { useStore } from '../store.js';

function speaker(p, charsById, playersByDevice) {
  if (p.channel === 'ooc') return `(OOC) ${playersByDevice[p.author_device_id]?.player_name || 'Player'}`;
  if (p.kind === 'narrator') return 'Narrator';
  return charsById[p.character_id]?.name || 'Former character';
}

export function buildExport(scene, posts, charsById, playersByDevice, format) {
  const md = format === 'md';
  const out = [];
  out.push(md ? `# ${scene.title}` : scene.title.toUpperCase());
  if (scene.universe) out.push(md ? `*${scene.universe}*` : scene.universe);
  if (scene.description) out.push('', md ? scene.description.split('\n').map((l) => `> ${l}`).join('\n') : scene.description);
  out.push('', md ? '---' : '----------');
  let lastDay = null;
  posts.forEach((p) => {
    if (p.kind === 'chapter') {
      out.push('', md ? `# ${p.body}` : `=== ${p.body.toUpperCase()} ===`);
      lastDay = null;
      return;
    }
    const day = new Date(p.created_at).toDateString();
    if (day !== lastDay) {
      out.push('', md ? `## ${dayLabel(p.created_at)}` : `[ ${dayLabel(p.created_at)} ]`);
      lastDay = day;
    }
    const who = speaker(p, charsById, playersByDevice);
    const text = plainText(p.body, charsById, { markdown: md });
    out.push('', md ? `**${who}:** ${text}` : `${who}: ${text}`);
  });
  return out.join('\n') + '\n';
}

export function buildHtml(scene, posts, charsById, playersByDevice) {
  const ctx = { charsById };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = `<h1>${esc(scene.title)}</h1>`;
  if (scene.universe) html += `<p><i>${esc(scene.universe)}</i></p>`;
  if (scene.description) html += `<blockquote>${esc(scene.description).replace(/\n/g, '<br>')}</blockquote>`;
  posts.forEach((p) => {
    if (p.kind === 'chapter') {
      html += `<h2>${esc(p.body)}</h2>`;
      return;
    }
    const c = charsById[p.character_id];
    const who = esc(speaker(p, charsById, playersByDevice));
    html += `<p><b style="color:${c ? c.color : 'inherit'}">${who}:</b></p>${toHtml(p.body, ctx)}`;
  });
  return html;
}

export function ExportSheet({ open, onClose, scene, charsById, playersByDevice, canPrint = true }) {
  const [include, setInclude] = useState('story');
  const [busy, setBusy] = useState(false);
  const fetchPosts = async () => {
    const api = await getApi();
    return api.getAllPosts(scene.id, include === 'story' ? ['story'] : ['story', 'ooc']);
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn(await fetchPosts());
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Export scene">
      {canPrint && <Segmented value={include} onChange={setInclude} label="What to include"
        options={[{ value: 'story', label: 'Story only' }, { value: 'all', label: 'Story + OOC' }]} />}
      <div className="menu-list">
        <button disabled={busy} onClick={() => run(async (posts) => {
          downloadFile(`${fileSafe(scene.title)}-${stamp}.md`, buildExport(scene, posts, charsById, playersByDevice, 'md'), 'text/markdown');
        })}><Icon name="download" /> Download Markdown (.md)</button>
        <button disabled={busy} onClick={() => run(async (posts) => {
          downloadFile(`${fileSafe(scene.title)}-${stamp}.txt`, buildExport(scene, posts, charsById, playersByDevice, 'txt'));
        })}><Icon name="download" /> Download text (.txt)</button>
        <button disabled={busy} onClick={() => run(async (posts) => {
          const md = buildExport(scene, posts, charsById, playersByDevice, 'md');
          const html = buildHtml(scene, posts, charsById, playersByDevice);
          try {
            await navigator.clipboard.write([new ClipboardItem({
              'text/html': new Blob([html], { type: 'text/html' }),
              'text/plain': new Blob([md], { type: 'text/plain' }),
            })]);
          } catch {
            await copyText(md);
          }
          toast('Copied. Paste it into a Google Doc.');
        })}><Icon name="copy" /> Copy all</button>
        {canPrint && <button onClick={() => { onClose(); go(`/s/${scene.slug}/print${include === 'all' ? '?ooc=1' : ''}`); }}>
          <Icon name="print" /> Printable story (save as PDF)
        </button>}
      </div>
    </Sheet>
  );
}

export function PrintView({ slug, withOoc }) {
  const textSize = useStore((s) => s.textSize);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const api = await getApi();
        const scene = await api.getSceneBySlug(slug);
        if (!scene) throw new Error('Scene not found');
        const [roster, posts, participants] = await Promise.all([
          api.getRoster([scene.id]),
          api.getAllPosts(scene.id, withOoc ? ['story', 'ooc'] : ['story']),
          api.getParticipants(scene.id),
        ]);
        const ids = [...new Set(posts.map((p) => p.character_id).filter(Boolean))].filter((id) => !roster.some((c) => c.id === id));
        const extra = ids.length ? await api.getCharacters(ids) : [];
        const charsById = Object.fromEntries([...roster, ...extra].map((c) => [c.id, c]));
        setData({ scene, posts, charsById, players: Object.fromEntries(participants.map((p) => [p.device_id, p])) });
      } catch (e) {
        setErr(errMsg(e));
      }
    })();
  }, [slug, withOoc]);
  if (err) return <div className="page"><p className="error-box">{err}</p></div>;
  if (!data) return <div className="page"><p className="muted center">Preparing the story…</p></div>;
  const { scene, posts, charsById, players } = data;
  const bg = themeOf(scene.theme).bg;
  const ctx = { charsById, colorFor: (c) => readableColor(c, bg) };
  let lastDay = null;
  return (
    <div className="print-view" style={themeStyle(scene.theme, scene.font, textSize)}>
      <div className="print-bar no-print">
        <button className="btn ghost" onClick={() => go(`/s/${slug}`)}><Icon name="back" size={18} /> Back</button>
        <button className="btn primary" onClick={() => window.print()}><Icon name="print" size={18} /> Print / Save as PDF</button>
      </div>
      <article className="print-doc">
        <h1>{scene.title}</h1>
        {scene.universe && <p className="print-universe">{scene.universe}</p>}
        {scene.description && <div className="print-desc">{scene.description}</div>}
        {posts.map((p) => {
          if (p.kind === 'chapter') {
            lastDay = null;
            return <h2 key={p.id} className="print-chapter">{p.body}</h2>;
          }
          const day = new Date(p.created_at).toDateString();
          const sep = day !== lastDay ? <h2 className="print-day">{dayLabel(p.created_at)}</h2> : null;
          lastDay = day;
          const c = charsById[p.character_id];
          return (
            <div key={p.id}>
              {sep}
              <section className={`print-post ${p.channel === 'ooc' ? 'ooc' : p.kind}`}>
                <div className="print-who" style={c ? { color: ctx.colorFor(c.color) } : undefined}>
                  {speaker(p, charsById, players)} <span className="muted small">{clockTime(p.created_at)}</span>
                </div>
                <div className="print-body"><RichText body={p.body} ctx={ctx} /></div>
              </section>
            </div>
          );
        })}
      </article>
    </div>
  );
}
