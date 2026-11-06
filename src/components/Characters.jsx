import { useEffect, useRef, useState } from 'react';
import { getApi } from '../api.js';
import { addMyCharacter, keyFor, useStore, getState, rememberUniverse } from '../store.js';
import { Avatar, Icon, Sheet, toast, errMsg, UniverseInput } from '../ui.jsx';
import { PALETTE } from '../look.js';
import { uuid, baseUrl, shareOrCopy, copyText } from '../util.js';

// Square-crop and shrink a photo in the browser so uploads stay tiny (~40 KB).
export async function processPhoto(file, size = 400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image. Try a JPEG or PNG.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    let blob = await toBlob('image/webp', 0.8);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CharacterForm({ open, character, scene, onClose, onSaved }) {
  const universes = useStore((s) => s.recentUniverses);
  const editing = !!character;
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[7]);
  const [universe, setUniverse] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, preview } | 'remove' | null
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(character?.name || '');
    setColor(character?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    setUniverse(character ? character.universe || '' : scene?.universe || '');
    setPhoto(null);
    setBusy(false);
  }, [open, character, scene]);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const blob = await processPhoto(f);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const shownPhoto = photo === 'remove' ? null : photo?.preview || character?.photo_url || null;
  const previewChar = { name: name || '?', color, photo_url: shownPhoto };

  const save = async () => {
    const n = name.trim();
    if (!n) return toast('Give your character a name', 'error');
    setBusy(true);
    try {
      const api = await getApi();
      const id = character?.id || uuid();
      let photoUrl = photo === 'remove' ? null : character?.photo_url || null;
      if (photo && photo !== 'remove') photoUrl = await api.uploadPhoto(id, photo.blob);
      const fields = { name: n.slice(0, 60), color, photo_url: photoUrl, universe: universe.trim().slice(0, 60) || null };
      if (editing) {
        const key = keyFor(id);
        if (!key) throw new Error('This character belongs to another device.');
        await api.updateCharacter(id, key, fields);
      } else {
        const key = uuid();
        await api.createCharacter({ id, owner_key: key, ...fields, created_by_device: getState().deviceId });
        addMyCharacter(id, key);
        if (scene) await api.addToScene(scene.id, id, getState().deviceId);
      }
      rememberUniverse(fields.universe);
      onSaved?.({ id, ...fields });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title={editing ? `Edit ${character.name}` : 'New character'}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : editing ? 'Save' : 'Create character'}</button>
        </>
      }>
      <div className="char-form-top">
        <button type="button" className="photo-pick" onClick={() => fileRef.current?.click()} aria-label="Choose photo">
          <Avatar c={previewChar} size={84} />
          <span className="photo-badge"><Icon name="upload" size={14} /></span>
        </button>
        <div className="grow">
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Character name" autoFocus={!editing} />
          </label>
          <div className="photo-links">
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>{shownPhoto ? 'Change photo' : 'Upload photo'}</button>
            {shownPhoto && <button type="button" className="link-btn" onClick={() => setPhoto('remove')}>Remove photo</button>}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      </div>

      <div className="field">
        <span>Colour</span>
        <div className="swatches" role="radiogroup" aria-label="Character colour">
          {PALETTE.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' on' : ''}`}
              style={{ background: c }} onClick={() => setColor(c)}>
              {color === c && <Icon name="check" size={16} />}
            </button>
          ))}
          <label className={`swatch custom${!PALETTE.includes(color) ? ' on' : ''}`} style={!PALETTE.includes(color) ? { background: color } : undefined} title="Custom colour">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" />
            {PALETTE.includes(color) && <Icon name="plus" size={16} />}
          </label>
        </div>
      </div>

      <label className="field">
        <span>Universe <em className="muted">(optional)</em></span>
        <UniverseInput value={universe} onChange={setUniverse} suggestions={universes} />
      </label>
    </Sheet>
  );
}

export function ShareCharacterSheet({ character, onClose }) {
  if (!character) return null;
  const key = keyFor(character.id);
  const url = `${baseUrl()}#/claim/${character.id}.${key}`;
  return (
    <Sheet open onClose={onClose} title={`Use ${character.name} on another device`}>
      <p>Open this link on your other phone or laptop. That device will be able to post and edit as {character.name}.</p>
      <p className="warning">Anyone with this link can play this character. Only send it to yourself.</p>
      <div className="stack">
        <button className="btn primary" onClick={async () => {
          const r = await shareOrCopy({ title: character.name, text: `My character ${character.name}`, url });
          if (r === 'copied') toast('Link copied');
        }}><Icon name="share" size={18} /> Share link</button>
        <button className="btn" onClick={async () => { await copyText(url); toast('Link copied'); }}><Icon name="copy" size={18} /> Copy link</button>
      </div>
    </Sheet>
  );
}
