// Passing Notes: send a push notification when a character is tagged.
// Called by the database (see the notifications migration) with { post_id } for each new OOC tag ping.
// Secrets needed (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// Turn OFF "Enforce JWT verification" for this function. It only acts on genuine, recent,
// not-yet-sent pings, so a stray call can't send anything new.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SITE = Deno.env.get('SITE_URL') ?? 'https://ashleycnichols.github.io/passingnotes/';
webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? SITE,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  try {
    const { post_id } = await req.json();
    if (!post_id) return json({ sent: 0 });

    // Claim the ping so it is only ever sent once, and only if it is a fresh tag ping.
    const { data: post } = await db
      .from('posts')
      .update({ push_sent_at: new Date().toISOString() })
      .eq('id', post_id)
      .is('push_sent_at', null)
      .not('ref_post_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
      .select('id, scene_id, author_device_id, tagged_character_ids, ref_post_id')
      .maybeSingle();
    if (!post || !post.tagged_character_ids?.length) return json({ sent: 0 });

    const [{ data: scene }, { data: tagged }, { data: story }] = await Promise.all([
      db.from('scenes').select('title, slug').eq('id', post.scene_id).single(),
      db.from('characters').select('id, name').in('id', post.tagged_character_ids),
      db.from('posts').select('kind, character_id').eq('id', post.ref_post_id).maybeSingle(),
    ]);

    let by = 'Someone';
    if (story?.kind === 'narrator') by = 'The Narrator';
    else if (story?.character_id) {
      const { data: c } = await db.from('characters').select('name').eq('id', story.character_id).maybeSingle();
      if (c) by = c.name;
    }

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, device_id, character_ids')
      .overlaps('character_ids', post.tagged_character_ids)
      .neq('device_id', post.author_device_id);

    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      const names = (tagged ?? []).filter((c) => s.character_ids.includes(c.id)).map((c) => c.name);
      const payload = JSON.stringify({
        title: scene?.title ?? 'Passing Notes',
        body: `${by} tagged ${names.length ? names.join(' and ') : 'your character'}`,
        url: `${SITE}#/s/${scene?.slug}?post=${post.ref_post_id}`,
        tag: `tag-${post.ref_post_id}`,
      });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error('push failed', code, (e as { body?: string }).body);
      }
    }));
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
