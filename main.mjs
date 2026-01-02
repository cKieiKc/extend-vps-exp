import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled', // 自動操作フラグを隠す
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

// ブラウザ側に「自動操作ツールではない」と信じ込ませる設定
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
    console.log("1/8: ログイン中...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {})

    // 2. 詳細リンク
    console.log("2/8: 詳細画面へ移動...");
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]', { timeout: 20000 })
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', (els) => els[0].click());

    // 3. 詳細画面ロード待ち
    await setTimeout(5000); 

    // 4. 更新するボタン
    console.log("4/8: 更新メニューを操作...");
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
    console.log("5/8: 継続手続きボタンをクリック...");
    await setTimeout(3000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) {
            target.scrollIntoView();
            target.click();
            setTimeout(() => target.dispatchEvent(new Event('click')), 500);
        }
    });

    // --- 6. Cloudflare & 画像認証 待機 ---
    console.log("6/8: セキュリティチェックと画像の読み込みを待機...");
    await setTimeout(5000);

    // Cloudflare Turnstile (チェックボックス) があるか探し、あればクリック
    const turnstile = await page.$('iframe[src*="cloudflare"]');
    if (turnstile) {
        console.log("Cloudflareを検知。チェックを試みます...");
        const rect = await turnstile.boundingBox();
        if (rect) {
            await page.mouse.click(rect.x + 50, rect.y + rect.height / 2);
            await setTimeout(8000); // 判定時間を長めに
        }
    }

    // 画像認証が出るまでリロードを含めて粘る
    let captchaImg = null;
    for (let i = 0; i < 2; i++) {
        try {
            captchaImg = await page.waitForSelector('img[src^="data:"]', { visible: true, timeout: 30000 });
            if (captchaImg) break;
        } catch (e) {
            console.log(`画像が見つかりません。リロードを試みます (${i+1}/2)`);
            await page.reload({ waitUntil: 'load' });
            await setTimeout(5000);
        }
    }

    if (!captchaImg) throw new Error("画像認証が表示されませんでした（Cloudflareにブロックされた可能性があります）");

    const body = await page.$eval('img[src^="data:"]', img => img.src)
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    const cleanCode = captchaResponse.trim();
    console.log(`解析結果: ${cleanCode}`);

    // 7. コード入力 (タイピング方式)
    console.log("7/8: コードを入力中...");
    const inputSelector = '[placeholder*="数字を入力"]';
    await page.waitForSelector(inputSelector, { visible: true });
    const inputField = await page.$(inputSelector);
    
    await inputField.focus();
    await inputField.click();
    
    // 既存の値をクリア
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    // 1文字ずつ打ち込む
    await page.keyboard.type(cleanCode, { delay: 150 });
    console.log("入力完了");
    await setTimeout(2000);

    // 8. 最終完了
    console.log("8/8: 最終完了ボタンをクリック...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    console.log("すべての処理を正常に終了しました。");
    await setTimeout(5000);

} catch (e) {
    console.error('実行エラー詳細:', e)
} finally {
    await recorder.stop()
    await browser.close()
    console.log("ブラウザを閉じました。");
}
