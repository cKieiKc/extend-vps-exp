import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled', // 自動操作フラグを隠蔽
]

if (process.env.PROXY_SERVER) {
    const proxy_url = new URL(process.env.PROXY_SERVER)
    proxy_url.username = ''
    proxy_url.password = ''
    args.push(`--proxy-server=${proxy_url}`.replace(/\/$/, ''))
}

const browser = await puppeteer.launch({
    defaultViewport: { width: 1080, height: 1024 },
    args,
})
const [page] = await browser.pages()

// 自動操作検知を回避する設定
await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const userAgent = await browser.userAgent()
await page.setUserAgent(userAgent.replace('Headless', ''))
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    if (process.env.PROXY_SERVER) {
        const { username, password } = new URL(process.env.PROXY_SERVER)
        if (username && password) {
            await page.authenticate({ username, password })
        }
    }

    // 1. ログイン
    console.log("1/8: ログイン開始...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {})

    // 2. 詳細リンク
    console.log("2/8: サーバー詳細へ移動...");
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]', { timeout: 20000 })
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', (els) => els[0].click());

    // 3. ロード待ち
    await setTimeout(5000); 

    // 4. 更新ボタン
    console.log("4/8: 更新メニュー表示...");
    await page.$$eval('button, a, span', (elements) => {
        const menu = elements.find(el => el.className?.includes('menuTrigger') || el.ariaLabel === 'メニュー');
        if (menu) menu.click();
    }).catch(() => {});
    await setTimeout(2000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    // 5. 継続ボタン
    console.log("5/8: 継続ボタンをクリック...");
    await setTimeout(3000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) {
            target.scrollIntoView();
            target.click();
            setTimeout(() => target.dispatchEvent(new Event('click')), 500);
        }
    });

    // 6. セキュリティチェック & 画像待機
    console.log("6/8: 画像認証画面を待機...");
    await setTimeout(5000);

    // Cloudflare対策：チェックボックスがあればマウス位置でクリック
    const turnstile = await page.$('iframe[src*="cloudflare"]');
    if (turnstile) {
        console.log("Cloudflare Turnstileを検知。回避を試みます...");
        const rect = await turnstile.boundingBox();
        if (rect) {
            await page.mouse.click(rect.x + 50, rect.y + rect.height / 2);
            await setTimeout(8000);
        }
    }

    await page.waitForSelector('img[src^="data:"]', { visible: true, timeout: 45000 });
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    const cleanCode = captchaResponse.trim();
    console.log(`解析結果: ${cleanCode}`);

    // 7. コード入力 (JavaScriptによる強制代入)
    console.log("7/8: コードの強制注入を開始...");
    const inputSelector = '[placeholder*="数字を入力"]';
    await page.waitForSelector(inputSelector, { visible: true });

    await page.$$eval(inputSelector, (elements, code) => {
        const el = elements[0];
