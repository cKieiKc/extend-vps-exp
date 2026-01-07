import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

const randomWait = (min, max) => setTimeout(Math.floor(Math.random() * (max - min + 1) + min));

const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
]

const browser = await puppeteer.launch({
    defaultViewport: { width: 1280, height: 1024 },
    args,
})
const [page] = await browser.pages()

// ボット判定の隠蔽を強化
await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'en-US', 'en'] });
});

await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // 1-5. ログイン・詳細・ボタン（ここは既に安定しているので維持）
    console.log("1-5/8: 手続き進行中...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' });
    await page.locator('#memberid').fill(process.env.EMAIL);
    await page.locator('#user_password').fill(process.env.PASSWORD);
    await page.click('text=ログインする');
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {});

    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]');
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', els => els[0].click());
    await randomWait(5000, 7000);

    await page.$$eval('button, a, span', (elements) => {
        const menu = elements.find(el => el.className?.includes('menuTrigger') || el.ariaLabel === 'メニュー');
        if (menu) menu.click();
    }).catch(() => {});
    await randomWait(2000, 3000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    await randomWait(3000, 5000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // --- 6. Cloudflare 突破ロジック (最終強化) ---
    console.log("6/8: Cloudflare 突破を試みます...");
    let captchaFound = false;

    for (let retry = 0; retry < 5; retry++) {
        // Cloudflareのiframeを待つ
        const frameHandle = await page.waitForSelector('iframe[src*="cloudflare"]', { timeout: 15000 }).catch(() => null);
        
        if (frameHandle) {
            const frame = await frameHandle.contentFrame();
            if (frame) {
                console.log("iframe内を確認中...");
                // チェックボックスの反応する範囲を広めに指定
                const selectors = ['input[type="checkbox"]', '#challenge-stage', '.ctp-checksum-container', '#ctp-checksum-container'];
                for (const sel of selectors) {
                    const el = await frame.$(sel).catch(() => null);
                    if (el) {
                        await el.click();
                        console.log(`セレクタ ${sel} をクリックしました。`);
                        await randomWait(8000, 12000); // 判定待機
                        break;
                    }
                }
            }
        }

        // 画像認証が出現したか確認
        const img = await page.$('img[src^="data:"]');
        if (img) {
            captchaFound = true;
            console.log("画像認証の表示を確認！");
            break;
        }

        console.log(`リトライ ${retry + 1}/5: 画面をリフレッシュします...`);
        await page.evaluate(() => window.scrollBy(0, 100)); // 少し動かして刺激を与える
        await randomWait(3000, 5000);
        if (retry % 2 === 1) await page.reload({ waitUntil: 'load' });
    }

    if (!captchaFound) throw new Error("Cloudflareを突破できませんでした。IP制限の可能性があります。");

    // 7. 解析・入力 (JS強制ねじ込み)
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body }).then(r => r.text())
    const cleanCode = captchaResponse.trim();
    console.log(`解析結果: ${cleanCode}`);

    const inputSelector = '[placeholder*="数字を入力"]';
    await page.waitForSelector(inputSelector);
    await page.$$eval(inputSelector, (elements, code) => {
        const el = elements[0];
        el.value = code;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, cleanCode);

    await randomWait(2000, 3000);

    // 8. 最終完了
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('無料VPSの利用を継続する') && !el.textContent.includes('引き続き'));
        if (target) target.click();
    });

    console.log("ミッション完了！");
    await randomWait(5000, 8000);

} catch (e) {
    console.error('最終エラー報告:', e)
} finally {
    await recorder.stop()
    await browser.close()
}
