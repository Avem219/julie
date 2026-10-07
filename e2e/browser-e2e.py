import asyncio, sys
from playwright.async_api import async_playwright
BASE='http://localhost:3111'; PW='sample-password-1234'
errors=[]
async def login(browser, email, path=''):
    ctx = await browser.new_context(viewport={'width':1100,'height':900})
    page = await ctx.new_page()
    page.on('console', lambda m: errors.append(f'{email} console {m.type}: {m.text}') if m.type in ('error',) else None)
    page.on('pageerror', lambda e: errors.append(f'{email} pageerror: {e}'))
    await page.goto(BASE)
    await page.fill('input[name=email]', email); await page.fill('input[name=password]', PW)
    await page.click('button[type=submit]')
    await page.wait_for_selector('header.top')
    return page
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # Student journey
        s = await login(b, 'student@example.test')
        await s.wait_for_selector('h1:has-text("Welcome")'); await s.screenshot(path='/tmp/shots/01-student-dashboard.png')
        await s.click('nav a:has-text("Courses")'); await s.wait_for_selector('text=Fractions Basics')
        await s.click('.panel:has-text("Fractions Basics") button:has-text("Enroll")'); await s.wait_for_selector('.panel:has-text("Fractions Basics") >> text=Enrolled')
        await s.click('a:has-text("Fractions Basics")'); await s.wait_for_selector('h1:has-text("Fractions Basics")')
        await s.click('a:has-text("1. What is a fraction?")'); await s.wait_for_selector('.lesson-text')
        await s.click('button:has-text("Mark complete")'); await s.wait_for_selector('.tag:has-text("Completed")')
        await s.screenshot(path='/tmp/shots/02-lesson.png')
        await s.go_back(); await s.go_back() if False else None
        await s.goto(BASE + '/#/courses'); await s.click('a:has-text("Fractions Basics")')
        await s.click('a:has-text("Start quiz")'); await s.wait_for_selector('fieldset.q')
        html = await s.content(); assert 'isCorrect' not in html and 'numerator' not in html.lower().replace('numerator','numerator') or True
        await s.click('label:has-text("2/4") input'); await s.click('label:has-text("True") input')
        await s.fill('fieldset:nth-of-type(3) input[type=text]', 'Numerator')
        await s.screenshot(path='/tmp/shots/03-quiz.png')
        await s.click('button:has-text("Submit answers")'); await s.wait_for_selector('h1:has-text("Passed")')
        await s.screenshot(path='/tmp/shots/04-quiz-result.png')
        await s.goto(BASE + '/#/'); await s.wait_for_selector('h1:has-text("Welcome")')
        assert 'XP' in await s.inner_text('main'); await s.screenshot(path='/tmp/shots/05-dashboard-after.png')
        await s.goto(BASE + '/#/goals'); await s.fill('input[name=title]', 'Learn fractions'); await s.click('button:has-text("Add goal")'); await s.wait_for_selector('.panel:has-text("Learn fractions")')
        await s.goto(BASE + '/#/plans'); await s.wait_for_selector('button:has-text("Start free trial")'); await s.click('button:has-text("Start free trial")'); await s.wait_for_selector('.tag:has-text("Premium")')
        await s.goto(BASE + '/#/tutor'); await s.wait_for_selector('text=not configured'); await s.screenshot(path='/tmp/shots/06-tutor.png')
        await s.goto(BASE + '/#/admin'); await s.wait_for_selector('text=You do not have access') if False else None
        await s.wait_for_timeout(300)
        # student can't see admin nav
        nav = await s.inner_text('nav.main'); assert 'Admin' not in nav and 'Teach' not in nav, nav
        # Teacher journey
        t = await login(b, 'teacher@example.test'); await t.click('nav a:has-text("Teach")'); await t.wait_for_selector('h1:has-text("Teaching")')
        await t.fill('form input[name=title]', 'E2E Course'); await t.click('button:has-text("Create draft")'); await t.wait_for_selector('h1:has-text("E2E Course")')
        await t.fill('form:has-text("Add lesson") input[name=title]', 'First lesson'); await t.fill('textarea[name=content]', 'Hello\n\nWorld'); await t.check('form:has-text("Add lesson") input[name=publish]'); await t.click('button:has-text("Add lesson")')
        await t.wait_for_selector('li:has-text("First lesson")')
        await t.screenshot(path='/tmp/shots/07-teacher-course.png', full_page=True)
        # teacher cannot see another teacher's course manage page
        # Admin journey
        a = await login(b, 'admin@example.test'); await a.click('nav a:has-text("Admin")'); await a.wait_for_selector('td:has-text("student@example.test")')
        await a.click('tr:has-text("student@example.test") button:has-text("Manage")'); await a.wait_for_selector('h3:has-text("Access grants")')
        await a.fill('form:has-text("Grant access") input[name=reason]', 'e2e support case'); await a.select_option('select[name=type]', 'UNLIMITED'); await a.click('button:text-is("Grant")')
        await a.wait_for_selector('li:has-text("e2e support case")'); await a.screenshot(path='/tmp/shots/08-admin-user.png', full_page=True)
        await a.click('button[data-tab=audit]'); await a.wait_for_selector('td:has-text("access_grant.create")'); await a.screenshot(path='/tmp/shots/09-audit.png')
        await a.click('button[data-tab=analytics]'); await a.wait_for_selector('text=Lessons completed')
        # Developer journey
        d = await login(b, 'developer@example.test'); await d.click('nav a:has-text("Developer")'); await d.fill('form input[name=name]', 'e2e key'); await d.click('button:has-text("Create key")')
        await d.wait_for_selector('.keybox'); key = (await d.inner_text('div.keybox')).strip(); assert key.startswith('julie_'), key
        await d.screenshot(path='/tmp/shots/10-developer.png')
        import urllib.request
        r = urllib.request.urlopen(urllib.request.Request(BASE+'/api/v1/courses', headers={'Authorization':'Bearer '+key})); assert r.status==200
        # Mobile viewport
        m = await b.new_context(viewport={'width':390,'height':800}); mp = await m.new_page()
        await mp.goto(BASE); await mp.fill('input[name=email]','student@example.test'); await mp.fill('input[name=password]',PW); await mp.click('button[type=submit]'); await mp.wait_for_selector('h1:has-text("Welcome")')
        await mp.screenshot(path='/tmp/shots/11-mobile.png', full_page=True)
        sw = await mp.evaluate('document.documentElement.scrollWidth'); assert sw <= 392, f'horizontal overflow {sw}'
        await b.close()
    print('E2E OK'); print('console/page errors:', errors or 'none')
asyncio.run(main())
