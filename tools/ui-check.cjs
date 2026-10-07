const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = require('path').resolve(__dirname, '../static') + '/';
const pages = { '/': 'index.html', '/study': 'study.html', '/review': 'review.html', '/listen': 'listen.html', '/write': 'write.html', '/speak': 'speak.html' };
const sentence = {
  schemaVersion: 2,
  sentence: "Je voudrais prendre un café avec toi demain matin.",
  original: "Je voudrais prendre un café avec toi demain matin.",
  translation_en: 'I would like to have a coffee with you tomorrow morning.',
  translation_zh: '我想明天早上和你一起喝杯咖啡。',
  words: [{ fr: 'voudrais', lemma: 'vouloir', type: 'verb', meaning: 'would like', meaning_zh: '想要', why: 'A polite way to express a wish.' }, { fr: 'un café', type: 'noun', meaning: 'a coffee', meaning_zh: '一杯咖啡' }],
  alignment: [{ fr: 'Je', en: 'I' }, { fr: 'voudrais', en: 'would like' }, { fr: 'prendre un café', en: 'have a coffee' }, { fr: 'avec toi', en: 'with you' }, { fr: 'demain matin', en: 'tomorrow morning' }],
  build_up: [{ fr: 'Je voudrais un café.', en: 'I would like a coffee.' }, { fr: 'Je voudrais prendre un café avec toi.', en: 'I would like to have a coffee with you.', new: 'avec toi' }, { fr: "Je voudrais prendre un café avec toi demain matin.", en: 'I would like to have a coffee with you tomorrow morning.', new: 'demain matin' }],
  grammar_points: [{ title: 'Polite requests', explanation: 'The conditional softens a request.', hook: 'voudrais = would like' }],
  pronunciation_tips: ['Link un and café smoothly.'],
};
const card = { id: 'ui-fixture', note_id: 'fixture', mode: 'recognize', state: 'review', importance: 3, target: 'voudrais', target_meta: { meaning_en: 'would like', meaning_zh: '想要', lemma: 'vouloir' }, note: { sentence: sentence.sentence, translation_en: sentence.translation_en, translation_zh: sentence.translation_zh, extra: {} } };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.UI_BROWSER || '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const width of [1440, 390]) for (const lang of ['zh', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 1050 }, reducedMotion: 'reduce' });
      await context.addInitScript(({lang}) => localStorage.setItem('frenchStudio.uiLang', lang), {lang});
      await context.route('http://localhost:8000/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (!process.env.UI_LIVE && pages[path]) return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(root + pages[path], 'utf8').replaceAll('__ASSET_VERSION__', 'ui-preview') });
        if (!process.env.UI_LIVE && path.startsWith('/static/') && (path.endsWith('.css') || path.endsWith('/study.js'))) return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(root + path.split('/').pop(), 'utf8') });
        // Keep generation, audio prefetch and all writes away from the real service.
        if (path === '/tts' || route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { detail: 'UI audit: side effects blocked' } });
        if (path === '/api/auth/me') return route.fulfill({ json: { email: 'preview@example.com', plan: 'pro', days_left: 30 } });
        if (path === '/api/game/state') return route.fulfill({ status: 401, json: {} });
        if (path === '/api/srs/queue') return route.fulfill({ json: { cards: [card], counts: { learning: 0, review: 1, new: 0 } } });
        if (path === '/api/srs/cards') return route.fulfill({ json: { cards: [] } });
        if (path === '/api/history') return route.fulfill({ json: { records: [] } });
                        if (path === '/api/speak/tasks') return route.fulfill({ json: { recommended_task: 'T1', recommended_level: 'A1', hours: 0, tasks: {}, subjects: {}, attempts: [] } });
        if (path === '/api/speak/attempts') return route.fulfill({ json: { attempts: [] } });
        if (path === '/api/write/tasks') return route.fulfill({ json: { recommended_task: 'T1', recommended_level: 'A1', hours: 0, tasks: {}, subjects: {}, attempts: [] } });
        if (path === '/api/write/attempts') return route.fulfill({ json: { attempts: [] } });
        if (path === '/api/episodes') return route.fulfill({ json: { episodes: [] } });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      async function check(label) {
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, h1: document.querySelectorAll('h1').length, visible: document.querySelector('h1').getBoundingClientRect().height }));
        assert.equal(size.h1, 1, label + ': exactly one page title');
        assert(size.visible > 20, label + ': visible page title');
        if (size.scroll > size.width + 1) {
          console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && el.getBoundingClientRect().width > 0).map(el => ({tag: el.tagName, cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right})).slice(0,20)));
          await page.screenshot({path:'/tmp/tts-ui-overflow.png',fullPage:true});
        }
        assert(size.scroll <= size.width + 1, label + ': horizontal overflow ' + JSON.stringify(size));
        assert.deepEqual(errors, [], label + ': browser errors');
        results.push(label + ' OK');
      }
      for (const path of Object.keys(pages)) {
        await page.goto('http://localhost:8000' + path);
        await page.waitForFunction(() => window.FrenchI18n && document.documentElement.lang !== '');
        await page.waitForTimeout(250);
        await check(`${width}/${lang}/${path}/empty`);
        if (path === '/') {
          assert.equal(await page.locator('.advanced-settings').getAttribute('open'), null);
          await page.locator('.advanced-settings > summary').click();
          assert(await page.locator('#voice-select').isVisible());
          await page.selectOption('#level-select', 'A1-A2');
          await check(`${width}/${lang}/settings`);
          await page.locator('.advanced-settings > summary').click();
          await page.screenshot({ path: `/tmp/tts-ui-home-${width}-${lang}.png`, fullPage: true });
        }
        if (path === '/study') {
          const reviewLabel = page.locator('#open-deck-btn [data-i18n="reviewBtn"]');
          assert(await reviewLabel.isVisible(), 'Study review button label must be visible');
          assert.equal(await page.locator('#open-deck-btn').getAttribute('href'), '/review');
          // The due-card banner only appears for users with review cards.
          // Verify its rendered text/background pair, including inherited span color.
          await page.evaluate(() => { document.querySelector('#today-review-banner').hidden = false; });
          const reviewContrast = await page.locator('.today-review-cta').evaluate(el => {
            const rgb = s => s.match(/[\d.]+/g).slice(0,3).map(Number);
            const lum = c => c.map(x => x/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((s,x,i) => s+x*[.2126,.7152,.0722][i],0);
            const fg = lum(rgb(getComputedStyle(el.querySelector('span')).color));
            const bg = lum(rgb(getComputedStyle(el).backgroundColor));
            return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
          });
          assert(reviewContrast >= 4.5, 'Start review text must contrast with its actual button background');
          await check(`${width}/${lang}/study/review-banner`);
          await page.evaluate(() => { document.querySelector('#today-review-banner').hidden = true; });
          await page.evaluate(s => window.FrenchHistory.onRestoreStudy({ text: s.sentence, sentences: [s], sentenceCount: 1 }), sentence);
          await page.waitForTimeout(150);
          assert(await page.locator('.sentence-card').isVisible());
          assert.equal(await page.locator('.feynman-selftest').getAttribute('open'), null);
          await page.locator('.feynman-selftest-summary').click();
          assert(await page.locator('.feynman-input').isVisible());
          await check(`${width}/${lang}/study/selftest`);
          await page.locator('.feynman-selftest-summary').click();
          for (const tab of ['words', 'grammar', 'buildup']) {
            await page.locator(`.card-tab-btn[data-tab="${tab}"]`).click();
            assert(await page.locator(`.card-tab-panel[data-panel="${tab}"]`).isVisible());
            await check(`${width}/${lang}/study/${tab}`);
          }
          await page.screenshot({ path: `/tmp/tts-ui-study-${width}-${lang}.png`, fullPage: true });
        }
      }
      await page.evaluate(() => localStorage.setItem('frenchStudio.userToken', 'ui-fixture-only'));
      await page.goto('http://localhost:8000/review');
      await page.locator('#reveal-btn').waitFor({ state: 'visible' });
      await check(`${width}/${lang}/review/question`);
      await page.locator('#reveal-btn').click();
      assert(await page.locator('#grade-row').isVisible());
      await check(`${width}/${lang}/review/answer`);
      await page.screenshot({ path: `/tmp/tts-ui-review-${width}-${lang}.png`, fullPage: true });
      await page.goto('http://localhost:8000/listen');
      await page.locator('#make-episode-btn').waitFor({ state: 'visible' });
      await check(`${width}/${lang}/listen/signed-in`);
      await context.close();
    }
    console.log(results.join('\n'));
    console.log(`${results.length} UI checks passed; no production writes or generation requests.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
