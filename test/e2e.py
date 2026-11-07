import json, uuid
"""Two simulated phones run through the main flows against the mock server.
Run: node test/mock-server.mjs &  then  python3 test/e2e.py <screenshot-dir>
"""
import sys, os, re
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:5174')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'shots'
os.makedirs(OUT, exist_ok=True)
errors = []

def shot(page, name):
    page.screenshot(path=f'{OUT}/{name}.png', full_page=False)

def phone(browser, dark=False, show_intro=False):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              color_scheme='dark' if dark else 'light', accept_downloads=True,
                              permissions=['clipboard-read', 'clipboard-write', 'notifications'])
    if not show_intro:
        ctx.add_init_script("try{const k='passingnotes:v1';const s=JSON.parse(localStorage.getItem(k)||'{}');if(!s.seenIntro){s.seenIntro=true;localStorage.setItem(k,JSON.stringify(s))}}catch(e){}")
    p = ctx.new_page()
    p.on('console', lambda m: m.type == 'error' and errors.append(f'[console] {m.text}'))
    p.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    return ctx, p

def make_png(path, color):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (600, 1000), color)   # tall portrait, face near the top
    d = ImageDraw.Draw(im)
    d.ellipse([210, 90, 390, 300], fill=(250, 225, 200))
    d.rectangle([120, 330, 480, 1000], fill=(40, 40, 60))
    im.save(path)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    actx, a = phone(browser)
    bctx, b = phone(browser, dark=True)

    # ---- A: home, create a full scene
    a.goto(BASE + '/')
    expect(a.get_by_role('heading', name='Write a story together')).to_be_visible()
    shot(a, '01-home-empty')
    a.get_by_role('button', name='Start a scene').click()
    a.get_by_role('tab', name='Full setup').click()
    a.get_by_label('Scene title').fill('The Lantern Room')
    a.get_by_label('Universe').select_option('__add__')
    a.get_by_placeholder('New universe name').fill('Witchard Universe')
    a.get_by_role('button', name='Add', exact=True).click()
    expect(a.get_by_label('Universe')).to_have_value('Witchard Universe')
    a.get_by_placeholder('Set the scene').fill('A rain-soaked evening at the academy. The lanterns in the old reading room have started flickering in a pattern.')
    shot(a, '02-new-scene-full')
    a.get_by_role('button', name='Create and invite').click()
    expect(a.get_by_role('dialog', name='Invite players')).to_be_visible()
    shot(a, '03-invite')
    link = a.locator('.link-box').inner_text()
    slug = re.search(r'#/s/(\w+)', link).group(1)
    a.get_by_role('button', name='Go to scene').click()
    expect(a.get_by_role('heading', name='The Lantern Room')).to_be_visible()

    # A adds a character with a photo
    a.get_by_role('button', name='Character', exact=True).click()
    a.get_by_role('button', name='Create a new character').click()
    a.get_by_label('Name').fill('Sterling Ashbourne')
    a.get_by_role('radio', name='#1971c2').click()
    png = f'{OUT}/_photo.png'
    make_png(png, (60, 90, 140))
    a.locator('input[type=file]').set_input_files(png)
    expect(a.get_by_role('dialog', name='Frame the portrait')).to_be_visible()
    a.wait_for_timeout(300)
    shot(a, '04a-cropper')
    a.get_by_role('button', name='Use photo').click()
    a.wait_for_timeout(300)
    shot(a, '04-character-form')
    a.get_by_role('button', name='Create character').click()
    expect(a.locator('.roster-chip', has_text='Sterling Ashbourne')).to_be_visible()

    # A posts as Narrator, then as Sterling
    a.get_by_role('button', name='Change who you are posting as').click()
    a.get_by_role('button', name='Narrator / GM').click()
    a.locator('.composer textarea').fill('The lanterns gutter. Somewhere above, a door *slams*.')
    a.get_by_role('button', name='Send').click()
    a.get_by_role('button', name='Change who you are posting as').click()
    a.locator('.sheet .menu-list button', has_text='Sterling Ashbourne').click()
    a.locator('.composer textarea').fill('Sterling looks up from the ledger. "That was **not** the wind."')
    a.get_by_role('button', name='Send').click()
    expect(a.locator('.char-post', has_text='not the wind')).to_be_visible()

    # ---- B joins from the invite link
    b.goto(f'{BASE}/#/s/{slug}')
    expect(b.get_by_role('button', name='Join this scene')).to_be_visible()
    shot(b, '05-b-before-join')
    b.get_by_role('button', name='Join this scene').click()
    shot(b, '06-b-join-sheet')
    b.get_by_role('button', name='Create a new character').click()
    b.get_by_label('Name').fill('Rowan')
    b.get_by_role('radio', name='#2b8a3e').click()
    b.get_by_role('button', name='Create character').click()
    expect(b.locator('.roster-chip', has_text='Rowan')).to_be_visible()
    # A sees Rowan arrive live
    expect(a.locator('.roster-chip', has_text='Rowan')).to_be_visible(timeout=5000)

    # B tags Sterling using the @ picker
    ta = b.locator('.composer textarea')
    ta.click()
    ta.type('Rowan grabs ')
    ta.type('@Ster')
    expect(b.locator('.mentions button', has_text='Sterling Ashbourne')).to_be_visible()
    shot(b, '07-b-mention')
    b.locator('.mentions button', has_text='Sterling Ashbourne').click()
    ta.type("by the sleeve. *Run.*")
    b.get_by_role('button', name='Send').click()
    expect(b.locator('.char-post .tag', has_text='Sterling Ashbourne')).to_be_visible()

    # A gets pinged: @ badge on the OOC tab
    expect(a.locator('.dot.mention')).to_be_visible(timeout=5000)
    shot(a, '20-ping-badge')

    # A sees it live and, because Sterling is tagged, can edit it
    post = a.locator('.char-post', has_text='by the sleeve')
    expect(post).to_be_visible(timeout=5000)
    post.locator('.post-body').click()
    expect(post.get_by_role('button', name='Edit')).to_be_visible()
    post.get_by_role('button', name='Edit').click()
    box = post.locator('textarea')
    val = box.input_value()
    assert '@Sterling Ashbourne' in val, val
    box.fill(val + ' Sterling stumbles after.')
    post.get_by_role('button', name='Save').click()
    expect(b.locator('.char-post', has_text='stumbles after')).to_be_visible(timeout=5000)
    assert b.locator('.char-post', has_text='stumbles after').locator('.tag').count() == 1

    # B cannot edit A's narrator post
    nar = b.locator('.post.narrator')
    nar.locator('.post-body').click()
    expect(nar.get_by_role('button', name='Copy')).to_be_visible()
    assert nar.get_by_role('button', name='Edit').count() == 0
    nar.locator('.post-body').click()
    shot(b, '08-b-feed-dark')

    # ---- OOC
    a.get_by_role('tab', name='OOC chat').click()
    a.get_by_role('textbox', name='Your name for OOC chat').fill('Ashley')
    a.get_by_role('button', name='Start chatting').click()
    ping = a.locator('.post.ping.for-me')
    expect(ping).to_contain_text('Rowan tagged Sterling Ashbourne in the story.')
    a.locator('.composer textarea').fill('brb, kettle')
    a.locator('.composer textarea').press('Enter')
    expect(a.locator('.ooc-post', has_text='brb, kettle')).to_be_visible()
    assert a.locator('.composer textarea').input_value() == ''
    shot(a, '21-ping-in-ooc')
    ping.get_by_role('button', name='Go to post').click()
    expect(a.get_by_role('tab', name='Story')).to_have_attribute('aria-selected', 'true')
    a.get_by_role('tab', name='OOC chat').click()
    expect(b.locator('[role=tab][aria-selected=false] .dot')).to_be_visible(timeout=5000)
    shot(a, '09-a-ooc')
    a.get_by_role('tab', name='Story').click()
    shot(a, '10-a-story')

    # ---- export
    a.get_by_role('button', name='Scene menu').click()
    a.get_by_role('button', name='Export scene').click()
    with a.expect_download() as dl:
        a.get_by_role('button', name='Download Markdown (.md)').click()
    md_path = f'{OUT}/export.md'
    dl.value.save_as(md_path)
    md = open(md_path).read()
    assert '**Sterling Ashbourne:**' in md and 'brb' not in md, md
    a.get_by_role('button', name='Printable story (save as PDF)').click()
    expect(a.locator('.print-doc h1', has_text='The Lantern Room')).to_be_visible()
    shot(a, '11-print')
    a.get_by_role('button', name='Back').click()

    # ---- theme change, seen live by B
    a.get_by_role('button', name='Scene menu').click()
    a.get_by_role('button', name='Scene settings and look').click()
    a.locator('.theme-card', has_text='Midnight').click()
    a.locator('.font-opt', has_text='Classic').click()
    a.get_by_role('button', name='Save', exact=True).click()
    expect(b.locator('.scene-page')).to_have_attribute('style', re.compile('#111a2e'), timeout=5000)
    shot(a, '12-a-midnight')

    # ---- delete own post, others see it vanish
    p = a.locator('.post.narrator')
    p.locator('.post-body').click()
    p.get_by_role('button', name='Delete').click()
    a.get_by_role('dialog').get_by_role('button', name='Delete').click()
    expect(b.locator('.post.narrator')).to_have_count(0, timeout=5000)

    # ---- share Sterling to a third device
    a.get_by_role('button', name="Who's in the scene").first.click()
    a.get_by_role('button', name='Use Sterling Ashbourne on another device').click()
    share_url = a.evaluate("() => { const k = JSON.parse(localStorage.getItem('passingnotes:v1')); const c = k.myCharacters[0]; return location.origin + location.pathname + '#/claim/' + c.id + '.' + c.key; }")
    cctx, c = phone(browser)
    c.goto(share_url)
    expect(c.get_by_text('You can now play Sterling Ashbourne on this device')).to_be_visible()
    assert '#/claim/' not in c.url.split('#')[1][7:], c.url
    shot(c, '13-claim')
    bad = share_url[:-4] + 'ffff'
    c.goto(bad)
    c.reload()
    expect(c.get_by_text("This link doesn’t work")).to_be_visible()

    # ---- home with cards, universe chips
    a.goto(BASE + '/')
    expect(a.locator('.continue-card', has_text='The Lantern Room')).to_be_visible()
    shot(a, '14-home')
    a.get_by_role('tab', name='My characters').click()
    expect(a.get_by_text('Sterling Ashbourne')).to_be_visible()
    shot(a, '15-my-characters')

    # ---- backup / restore into a fresh device
    a.goto(BASE + '/#/settings')
    backup = a.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('passingnotes:v1'));
      const d = {v:1, c:s.myCharacters, s:s.myScenes.map(x=>({slug:x.slug, hidden:x.hidden})), p:s.playerName, u:s.recentUniverses};
      const b = btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      return location.origin + location.pathname + '#/restore/' + b;
    }""")
    shot(a, '16-settings')
    dctx, d = phone(browser)
    d.goto(backup)
    expect(d.get_by_text('Restored 1 character and 1 scene')).to_be_visible()

    # ---- honour-system reclaim: Rowan's player on a fresh phone
    rctx, r = phone(browser)
    r.goto(f'{BASE}/#/s/{slug}')
    r.get_by_role('button', name='Join this scene').click()
    r.get_by_role('button', name='Already playing here on another device? Reclaim your character').click()
    row = r.locator('.char-row', has_text='Rowan')
    row.get_by_role('button', name='This is mine').click()
    shot(r, '17-reclaim-confirm')
    r.get_by_role('button', name='Yes, it’s mine').click()
    expect(r.get_by_role('textbox', name='Write as Rowan…')).to_be_visible()
    # Rowan's old posts are editable again on the new phone
    old_post = r.locator('.char-post', has_text='stumbles after')
    old_post.locator('.post-body').click()
    expect(old_post.get_by_role('button', name='Edit')).to_be_visible()
    # everyone sees the note in OOC
    b.get_by_role('tab', name='OOC chat').click()
    expect(b.locator('.ooc-post', has_text='was reclaimed')).to_be_visible(timeout=5000)
    shot(b, '18-reclaim-note')

    # ---- chapters: retroactive break, then a new chapter at the end
    b.get_by_role('tab', name='Story').click()
    target = b.locator('.char-post', has_text='stumbles after')
    target.locator('.post-body').click()
    target.get_by_role('button', name='Chapter starts here').click()
    expect(b.get_by_role('dialog', name='Start a chapter here')).to_be_visible()
    b.get_by_label('Chapter title').fill('Chapter 2: The Chase')
    b.get_by_role('button', name='Start chapter').click()
    expect(b.locator('.chapter-title', has_text='Chapter 2: The Chase')).to_be_visible()
    # the break sits before the chosen post, which now lives in chapter 2
    expect(b.locator('.chapter', has_text='Chapter 2: The Chase').locator('.char-post', has_text='stumbles after')).to_be_visible()
    b.get_by_role('button', name='Scene menu').click()
    b.get_by_role('button', name='Start a new chapter').click()
    expect(b.get_by_label('Chapter title')).to_have_value('Chapter 3: ')
    b.get_by_label('Chapter title').fill('Chapter 3: Upstairs')
    b.get_by_role('button', name='Start chapter').click()
    expect(b.locator('.chapter-title', has_text='Chapter 3: Upstairs')).to_be_visible()
    expect(b.locator('.chapter:not(.open)')).to_have_count(2)
    shot(b, '24-chapters-folded')
    b.locator('.chapter-toggle', has_text='Beginning').click()
    expect(b.locator('.char-post', has_text='not the wind')).to_be_visible()
    # A sees the chapters live
    a.goto(f'{BASE}/#/s/{slug}')
    expect(a.locator('.chapter-title', has_text='Chapter 3: Upstairs')).to_be_visible(timeout=5000)

    # ---- read-only link: a reader can read but not join, post or see OOC
    b.get_by_role('button', name='Invite players').click()
    b.get_by_role('button', name='Copy read-only link').click()
    expect(b.get_by_text('Read-only link copied')).to_be_visible()
    read_url = b.evaluate('navigator.clipboard.readText()')
    assert '#/r/' in read_url and slug not in read_url, read_url
    b.keyboard.press('Escape')
    rdctx, rd = phone(browser)
    rd.goto(read_url)
    expect(rd.get_by_role('heading', name='The Lantern Room')).to_be_visible()
    expect(rd.get_by_text('You’re reading along')).to_be_visible()
    assert rd.locator('.composer').count() == 0
    assert rd.get_by_role('tab', name='OOC chat').count() == 0
    assert rd.get_by_role('button', name='Join this scene').count() == 0
    rd.locator('.chapter-toggle', has_text='Beginning').click()
    expect(rd.locator('.char-post', has_text='not the wind')).to_be_visible()
    shot(rd, '25-reader')
    rd.goto(BASE + '/')
    expect(rd.get_by_role('heading', name='Reading')).to_be_visible()
    expect(rd.locator('.scene-card.reading', has_text='The Lantern Room')).to_be_visible()

    # ---- shared universe list on another device
    b.goto(BASE + '/#/new')
    b.get_by_role('tab', name='Full setup').click()
    opts = b.get_by_label('Universe').locator('option').all_inner_texts()
    assert 'Witchard Universe' in opts, opts
    b.get_by_label('Universe').select_option('__add__')
    b.get_by_placeholder('New universe name').fill('witchard universe')
    b.get_by_role('button', name='Add', exact=True).click()
    expect(b.get_by_label('Universe')).to_have_value('Witchard Universe')
    expect(b.get_by_text('already exists')).to_be_visible()
    shot(b, '19-universe-dropdown')

    # ---- the 10-character limit (devices are unlimited)
    import urllib.request
    def mock(fn, *args):
        req = urllib.request.Request(f'{BASE}/api/{fn}', data=json.dumps(args).encode(), headers={'content-type': 'application/json'})
        return json.loads(urllib.request.urlopen(req).read())['data']
    scene_row = mock('getSceneBySlug', slug)
    have = len(mock('getRoster', [scene_row['id']]))
    for i in range(10 - have):
        cid = str(uuid.uuid4())
        mock('createCharacter', {'id': cid, 'owner_key': str(uuid.uuid4()), 'name': f'Extra {i}', 'color': '#495057', 'created_by_device': 'x'})
        mock('addToScene', scene_row['id'], cid, str(uuid.uuid4()))
    ectx, e = phone(browser)
    e.goto(f'{BASE}/#/s/{slug}')
    e.get_by_role('button', name='Join this scene').click()
    expect(e.get_by_text('the most it can hold')).to_be_visible()
    assert e.get_by_role('button', name='Create a new character').count() == 0
    e.get_by_role('button', name='Just join for now').click()
    expect(e.locator('.composer')).to_be_visible()

    # ---- desktop layout
    a.set_viewport_size({'width': 1440, 'height': 900})
    a.goto(f'{BASE}/#/s/{slug}')
    expect(a.locator('.desk-grid')).to_be_visible()
    expect(a.locator('.ooc-panel')).to_contain_text('brb, kettle')
    big = a.locator('.desk-center .composer textarea')
    big.fill('A desktop line, written with room to breathe.')
    big.press('Control+Enter')
    expect(a.locator('.desk-center .char-post', has_text='room to breathe')).to_be_visible()
    side = a.locator('.ooc-panel textarea')
    side.fill('side chat works')
    side.press('Enter')
    expect(a.locator('.ooc-panel .ooc-post', has_text='side chat works')).to_be_visible()
    a.wait_for_timeout(300)
    a.screenshot(path=f'{OUT}/22-desktop.png')

    # ---- delete scene: only the creator sees the option
    b.goto(f'{BASE}/#/s/{slug}')
    expect(b.get_by_role('heading', name='The Lantern Room')).to_be_visible()
    b.get_by_role('button', name='Scene menu').click()
    assert b.get_by_role('button', name='Delete scene').count() == 0
    b.keyboard.press('Escape')
    a.get_by_role('button', name='Scene menu').click()
    a.get_by_role('button', name='Delete scene').click()
    del_btn = a.get_by_role('button', name='Delete scene for everyone')
    expect(del_btn).to_be_disabled()
    a.get_by_placeholder('DELETE').fill('delete')
    a.screenshot(path=f'{OUT}/23-delete.png')
    del_btn.click()
    expect(a.get_by_role('heading', name='Write a story together')).to_be_visible()
    expect(b.get_by_text('This scene was deleted by its creator.')).to_be_visible(timeout=5000)

    # ---- notifications are switched off in config, so no opt-in anywhere
    a.goto(BASE + '/#/settings')
    expect(a.get_by_role('heading', name='Text size')).to_be_visible()
    assert a.locator('#notifications').count() == 0

    # ---- delete a character
    a.goto(BASE + '/')
    a.get_by_role('button', name='My characters').click()   # desktop sidebar
    a.locator('.char-card', has_text='Sterling Ashbourne').get_by_role('button', name='Edit').click()
    a.get_by_role('button', name='Delete this character').click()
    a.get_by_role('button', name='Delete character').click()
    expect(a.get_by_text('No characters on this device')).to_be_visible()

    # ---- owner stats behind a passcode
    a.goto(BASE + '/#/stats')
    a.get_by_label('Passcode').fill('wrong')
    a.get_by_role('button', name='Show stats').click()
    expect(a.get_by_text('That passcode didn’t work.')).to_be_visible()
    a.get_by_label('Passcode').fill('test-code')
    a.get_by_role('button', name='Show stats').click()
    expect(a.locator('.stat-tile', has_text='Scenes').first).to_be_visible()
    a.reload()
    expect(a.get_by_text('Story posts per day, last 30 days')).to_be_visible()
    expect(a.get_by_text('People (devices that opened the app)')).to_be_visible()
    assert int(a.locator('.stat-tile.hero .stat-value').first.inner_text().replace(',', '')) >= 5
    a.wait_for_timeout(300)
    a.screenshot(path=f'{OUT}/27-stats.png', full_page=True)

    # ---- first-visit welcome shows once
    ictx, iv = phone(browser, show_intro=True)
    iv.goto(BASE + '/')
    expect(iv.get_by_role('dialog', name='Welcome to Passing Notes')).to_be_visible()
    shot(iv, '26-welcome')
    iv.get_by_role('button', name='Got it').click()
    iv.reload()
    iv.wait_for_timeout(400)
    assert iv.get_by_role('dialog', name='Welcome to Passing Notes').count() == 0

    browser.close()

print('\n'.join(errors) if errors else 'no console errors')
print('E2E PASSED')
