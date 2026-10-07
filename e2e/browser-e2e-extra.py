import asyncio, pathlib
from playwright.async_api import async_playwright
BASE='http://localhost:3111'; PW='sample-password-1234'
errors=[]
async def login(browser, email):
    ctx = await browser.new_context(viewport={'width':1100,'height':900})
    page = await ctx.new_page()
    page.on('console', lambda m: errors.append(f'{email} console {m.type}: {m.text}') if m.type=='error' else None)
    page.on('pageerror', lambda e: errors.append(f'{email} pageerror: {e}'))
    await page.goto(BASE)
    await page.fill('input[name=email]', email); await page.fill('input[name=password]', PW)
    await page.click('button[type=submit]')
    await page.wait_for_selector('header.top')
    return page

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        s = await login(b, 'student@example.test')
        await s.goto(BASE + '/#/timetable'); await s.wait_for_selector('h1:has-text("Timetable")')
        await s.select_option('select[name=day]', '1')
        await s.fill('input[name=start]', '09:00'); await s.fill('input[name=end]', '10:00')
        await s.fill('input[name=title]', 'Math class')
        await s.click('button:has-text("Add")')
        await s.wait_for_selector('text=Math class')
        await s.screenshot(path='/tmp/shots/12-timetable.png', full_page=True)
        await s.goto(BASE + '/#/news'); await s.wait_for_selector('h1:has-text("News")')
        await s.wait_for_selector('text=Welcome to Julie')
        await s.screenshot(path='/tmp/shots/13-news.png')
        await s.goto(BASE + '/#/profile'); await s.wait_for_selector('text=Notification preferences')
        await s.uncheck('label:has-text("Quiz") input')
        await s.screenshot(path='/tmp/shots/14-profile-prefs.png', full_page=True)
        await s.goto(BASE + '/#/courses')
        await s.click('.panel:has-text("Fractions Basics") button:has-text("Enroll")')
        await s.wait_for_selector('.panel:has-text("Fractions Basics") >> text=Enrolled')
        await s.click('a:has-text("Fractions Basics")')
        await s.wait_for_selector('h2:has-text("Resources")')
        await s.screenshot(path='/tmp/shots/15-course-resources.png', full_page=True)

        t = await login(b, 'teacher@example.test')
        await t.goto(BASE + '/#/teach'); await t.click('a:has-text("Fractions Basics")')
        await t.wait_for_selector('h2:has-text("Resources")')
        await t.fill('form:has(input[name=url]) input[name=title]', 'Extra reading')
        await t.fill('input[name=url]', 'https://example.test/fractions')
        await t.click('button:has-text("Add link")')
        await t.wait_for_selector('text=Extra reading')
        pdf_path = '/tmp/sample.pdf'
        pathlib.Path(pdf_path).write_bytes(b'%PDF-1.7\n%test file for e2e upload\n')
        async with t.expect_file_chooser() as fc_info:
            await t.click('input[type=file]')
        fc = await fc_info.value
        await fc.set_files(pdf_path)
        await t.click('button:has-text("Upload file")')
        await t.wait_for_selector('text=sample.pdf')
        await t.screenshot(path='/tmp/shots/16-teacher-resources.png', full_page=True)
        await t.click('a:has-text("Review short answers")')
        await t.wait_for_selector('h1:has-text("Review short answers")')
        await t.screenshot(path='/tmp/shots/17-quiz-review.png', full_page=True)

        a = await login(b, 'admin@example.test')
        await a.goto(BASE + '/#/admin')
        await a.click('button[data-tab=plans]'); await a.wait_for_selector('text=MONTHLY')
        await a.screenshot(path='/tmp/shots/18-admin-plans.png', full_page=True)
        await a.click('button[data-tab=news]'); await a.wait_for_selector('text=Welcome to Julie')
        await a.fill('form:has-text("New article") input[name=title]', 'E2E News Item')
        await a.fill('form:has-text("New article") textarea[name=body]', 'Body text for e2e news item.')
        await a.check('form:has-text("New article") input[name=publish]')
        await a.click('form:has-text("New article") button:has-text("Save")')
        await a.wait_for_selector('text=E2E News Item')
        await a.screenshot(path='/tmp/shots/19-admin-news.png', full_page=True)
        await a.click('button[data-tab=flags]'); await a.wait_for_selector('text=new-dashboard-widgets')
        await a.fill('input[name=key]', 'e2e_test_flag')
        await a.click('button:has-text("Create flag")')
        await a.wait_for_selector('text=e2e_test_flag')
        await a.check('div.panel:has-text("e2e_test_flag") input[type=checkbox]')
        await a.screenshot(path='/tmp/shots/20-admin-flags.png', full_page=True)

        await s.goto(BASE + '/#/news'); await s.wait_for_selector('text=E2E News Item')

        await b.close()
    print('E2E2 OK'); print('console/page errors:', errors or 'none')
asyncio.run(main())
