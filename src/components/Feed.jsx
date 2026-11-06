import { useRef, useState } from 'react';
import { Avatar, Icon, toast } from '../ui.jsx';
import { RichText, decodeTags, encodeTags, plainText, firstLine } from '../text.jsx';
import { TextTools } from './Composer.jsx';
import { clockTime, dayLabel, copyText } from '../util.js';

const GROUP_MS = 5 * 60 * 1000;

export default function Feed({ posts, channel, ctx, canEdit, onEdit, onDelete, participantsByDevice, rosterByDevice, emptyText, storyById = {}, myIds = new Set(), onJump }) {
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  if (!posts.length) {
    return <div className="feed-empty"><p>{emptyText}</p></div>;
  }
  const items = [];
  let lastDay = null;
  let prev = null;
  posts.forEach((p) => {
    const day = new Date(p.created_at).toDateString();
    if (day !== lastDay) {
      items.push(<div key={`d-${day}`} className="day-sep"><span>{dayLabel(p.created_at)}</span></div>);
      lastDay = day;
      prev = null;
    }
    const sameAuthor =
      prev && prev.kind === p.kind && p.kind !== 'narrator' &&
      (p.kind === 'player' ? prev.author_device_id === p.author_device_id : prev.character_id === p.character_id) &&
      new Date(p.created_at) - new Date(prev.created_at) < GROUP_MS;
    items.push(
      <Post key={p.id} post={p} grouped={!!sameAuthor && !p.ref_post_id && !prev?.ref_post_id} ctx={ctx} channel={channel}
        refPost={p.ref_post_id ? storyById[p.ref_post_id] : null} pingsMe={(p.tagged_character_ids || []).some((id) => myIds.has(id))} onJump={onJump}
        selected={selected === p.id} onSelect={() => setSelected(selected === p.id ? null : p.id)}
        canEdit={canEdit(p)} editing={editing === p.id}
        onStartEdit={() => { setEditing(p.id); setSelected(null); }}
        onCancelEdit={() => setEditing(null)}
        onSave={async (body, tagged) => { await onEdit(p, body, tagged); setEditing(null); }}
        onDelete={() => { setSelected(null); onDelete(p); }}
        player={participantsByDevice[p.author_device_id]} playerChars={rosterByDevice[p.author_device_id] || []} />,
    );
    prev = p;
  });
  return <div className={`feed ${channel}`}>{items}</div>;
}

function Post({ post, grouped, ctx, channel, selected, onSelect, canEdit, editing, onStartEdit, onCancelEdit, onSave, onDelete, player, playerChars, refPost, pingsMe, onJump }) {
  const c = post.character_id ? ctx.charsById[post.character_id] : null;
  const actions = selected && !editing && (
    <div className="post-actions" onClick={(e) => e.stopPropagation()}>
      {canEdit && <button onClick={onStartEdit}><Icon name="edit" size={16} /> Edit</button>}
      {canEdit && <button className="danger-text" onClick={onDelete}><Icon name="trash" size={16} /> Delete</button>}
      <button onClick={async () => { await copyText(plainText(post.body, ctx.charsById)); toast('Copied'); onSelect(); }}><Icon name="copy" size={16} /> Copy</button>
    </div>
  );
  const body = editing ? (
    <EditBox post={post} ctx={ctx} onCancel={onCancelEdit} onSave={onSave} />
  ) : (
    <div className="post-body"><RichText body={post.body} ctx={ctx} /></div>
  );

  if (channel === 'ooc' && post.ref_post_id) {
    return (
      <article className={`post ping${pingsMe ? ' for-me' : ''}`}>
        <span className="ping-icon" aria-hidden="true">@</span>
        <div className="ping-main">
          <div className="ping-text"><RichText body={post.body} ctx={ctx} /></div>
          {refPost && <p className="ping-quote">“{firstLine(refPost.body, ctx.charsById, 80)}”</p>}
          <div className="ping-foot">
            <button className="btn small" onClick={() => onJump(post.ref_post_id)}>Go to post</button>
            <time className="muted">{clockTime(post.created_at)}</time>
          </div>
        </div>
      </article>
    );
  }

  if (channel === 'ooc') {
    const name = player?.player_name || 'Player';
    return (
      <article className={`post ooc-post${grouped ? ' grouped' : ''}${selected ? ' selected' : ''}`} onClick={editing ? undefined : onSelect}>
        {!grouped && (
          <header className="post-head">
            <span className="ooc-name">{name}</span>
            <span className="ooc-dots" aria-hidden="true">
              {playerChars.slice(0, 4).map((pc) => <span key={pc.id} style={{ background: pc.color }} />)}
            </span>
            <time className="muted">{clockTime(post.created_at)}</time>
          </header>
        )}
        {body}
        {actions}
      </article>
    );
  }

  if (post.kind === 'narrator') {
    return (
      <article id={`post-${post.id}`} className={`post narrator${selected ? ' selected' : ''}`} onClick={editing ? undefined : onSelect}>
        <header className="narrator-head"><span>Narrator</span><time>{clockTime(post.created_at)}</time></header>
        {body}
        {actions}
      </article>
    );
  }

  const color = c ? ctx.colorFor(c.color) : 'var(--muted)';
  return (
    <article id={`post-${post.id}`} className={`post char-post${grouped ? ' grouped' : ''}${selected ? ' selected' : ''}`} style={{ '--char': c?.color || 'var(--border)' }}
      onClick={editing ? undefined : onSelect}>
      <div className="post-av">{!grouped && <Avatar c={c || { name: '?', color: '#888888' }} size={38} />}</div>
      <div className="post-main">
        {!grouped && (
          <header className="post-head">
            <span className="char-name" style={{ color }}>{c?.name || 'Former character'}</span>
            <time className="muted">{clockTime(post.created_at)}</time>
          </header>
        )}
        {body}
        {actions}
      </div>
    </article>
  );
}

function EditBox({ post, ctx, onCancel, onSave }) {
  const [value, setValue] = useState(() => decodeTags(post.body, ctx.charsById));
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);
  const save = async () => {
    const t = value.trim();
    if (!t) return;
    setBusy(true);
    try {
      const { body, tagged } = encodeTags(t, ctx.roster);
      await onSave(body, tagged);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="edit-box" onClick={(e) => e.stopPropagation()}>
      <TextTools taRef={taRef} value={value} setValue={setValue} roster={ctx.roster} colorFor={ctx.colorFor} showFormat />
      <textarea ref={taRef} value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(12, Math.max(3, value.split('\n').length + 1))} autoFocus aria-label="Edit post" />
      <div className="edit-actions">
        <button className="btn ghost small" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn primary small" onClick={save} disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
