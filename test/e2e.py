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

def phone(browser, dark=False):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              color_scheme='dark' if dark else 'light', accept_downloads=True,
                              permissions=['clipboard-read', 'clipboard-write'])
    p = ctx.new_page()
    p.on('console', lambda m: m.type == 'error' and errors.append(f'[console] {m.text}'))
    p.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
    return ctx, p

def make_png(path, color):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (900, 600), color)
    d = ImageDraw.Draw(im)
    d.ellipse([300, 150, 600, 450], fill=(250, 240, 220))
    im.save(path)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    actx, a = phone(browser)
    bctx, b = phone(browser, dark=True)

    # ---- A: home, create a full scene
    a.goto(BASE + '/')
    expect(a.get_by_text('No scenes yet')).to_be_visible()
    shot(a, '01-home-empty')
    a.get_by_role('button', name='Start a scene').click()
    a.get_by_role('tab', name='Full setup').click()
    a.get_by_label('Scene title').fill('The Lantern Room')
    a.get_by_placeholder('e.g. Witchard Universe').fill('Witchard Universe')
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
    a.get_by_role('button', name='Character').click()
    a.get_by_role('button', name='Create a new character').click()
    a.get_by_label('Name').fill('Sterling Ashbourne')
    a.get_by_role('radio', name='#1971c2').click()
    png = f'{OUT}/_photo.png'
    make_png(png, (60, 90, 140))
    a.locator('input[type=file]').set_input_files(png)
    a.wait_for_timeout(400)
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
    a.locator('.composer textarea').fill('brb, kettle')
    a.get_by_role('button', name='Send').click()
    expect(a.locator('.ooc-post', has_text='brb, kettle')).to_be_visible()
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
    expect(a.locator('.scene-card', has_text='The Lantern Room')).to_be_visible()
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

    # ---- the 10-player limit
    for i in range(7):  # A, B and the claimed device already make 3
        x, xp = phone(browser)
        xp.goto(f'{BASE}/#/s/{slug}')
        xp.get_by_role('button', name='Join this scene').click()
        xp.get_by_role('button', name='Just join for now').click()
        expect(xp.locator('.composer')).to_be_visible()
        x.close()
    ectx, e = phone(browser)
    e.goto(f'{BASE}/#/s/{slug}')
    expect(e.get_by_text('This scene is full (10 players)')).to_be_visible()

    browser.close()

print('\n'.join(errors) if errors else 'no console errors')
print('E2E PASSED')
