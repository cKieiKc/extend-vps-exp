import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

// 人間らしいランダムな待機関数
const randomWait = (min, max) => setTimeout(Math.floor(Math.random() * (max - min + 1) + min));

// マウスを自然に移動させる関数
async function smartMove(page, selector) {
    const element = await page.waitForSelector(selector, { visible: true });
    const box = await element.boundingBox();
    if (box) {
        // ボタンの中のランダムな地点を計算
        const x = box.x + Math.random() * box.width;
        const y = box.y + Math.random() * box.height;
        await page.mouse.move(x, y, { steps: 10 }); // 10歩かけてゆっくり移動
        return { x, y };
    }
}

const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
]

const browser = await puppeteer.launch({
    defaultViewport: { width: 1280, height: 800 }, // 一般的なPCサイズ
    args,
})
const [page] = await browser.pages()

// 自動操作フラグを隠蔽
await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // 1. ログイン
    console.log("1/8: ログイン開始...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'networkidle2' });
    
    await randomWait(1000, 3000); // ページを眺めるふり
    await page.locator('#memberid').fill(process.env.EMAIL);
    await randomWait(500, 1500);
    await page.locator('#user_password').fill(process.env.PASSWORD);
    
    await randomWait(1000, 2000);
    await page.locator('text=ログインする').click();
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {});

    // 2. 詳細画面への移動
    console.log("2/8: 詳細画面へ移動...");
    const detailLink = 'a[href^="/xapanel/xvps/server/detail?id="]';
    await smartMove(page, detailLink);
    await page.click(detailLink);

    // 3. スクロールによる人間らしさ
    await randomWait(3000, 5000);
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' })); // スルスルとスクロール
    await randomWait(1000, 2000);

    // 4. 更新メニュー
    console.log("4/8: 更新メニュー操作...");
    const menuSelector = '.p-tableList__menuTrigger, button[aria-label="メニュー"]';
    await page.$$eval(menuSelector, (elements) => {
        const menu = elements[0];
        if (menu) menu.click();
    }).catch(() => {});
    
    await randomWait(1000, 2000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    // 5. 継続ボタン
    console.log("5/8: 継続手続き...");
    await randomWait(2000, 4000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // 6. Cloudflare対策 & 画像取得
    console.log("6/8: 画像認証待機...");
    await randomWait(5000, 7000);

    const turnstile = await page.$('iframe[src*="cloudflare"]');
    if (turnstile) {
        const rect = await turnstile.boundingBox();
        if (rect) {
            // チェックボックスをゆっくりクリック
            await page.mouse.move(rect.x + 20, rect.y + 20, { steps: 15 });
            await page.mouse.click(rect.x + 20, rect.y + 20);
            await randomWait(5000, 8000);
        }
    }

    await page.waitForSelector('img[src^="data:"]', { visible: true, timeout: 45000 });
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    const cleanCode = captchaResponse.trim();
    console.log(`解析結果: ${cleanCode}`);

    // 7. コード入力（強制イベント発火）
    console.log("7/8: 強制イベント発火による入力...");
    const inputSelector = '[placeholder*="数字を入力"]';
    await page.waitForSelector(inputSelector, { visible: true });

    await page.$$eval(inputSelector, (elements, code) => {
        const el = elements[0];
        if (el) {
            el.focus();
            el.value = code;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, cleanCode);

    await randomWait(2000, 3000); // 入力後に確認するふり

    // 8. 最終完了
    console.log("8/8: 最終完了ボタン...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    await randomWait(4000, 6000);
    console.log("全工程終了");

} catch (e) {
    console.error('実行エラー:', e)
} finally {
    await recorder.stop()
    await browser.close()
}
