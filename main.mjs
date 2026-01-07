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

await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
const recorder = await page.screencast({ path: 'recording.webm' })

try {
    // 1-5. ログイン〜継続ボタンクリックまで（安定化のため少し待機を調整）
    console.log("1/8: ログイン開始...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' });
    await randomWait(2000, 4000);
    await page.locator('#memberid').fill(process.env.EMAIL);
    await page.locator('#user_password').fill(process.env.PASSWORD);
    await page.click('text=ログインする');
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {});

    console.log("2/8: 詳細画面へ...");
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]');
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', els => els[0].click());
    
    await randomWait(4000, 6000);
    console.log("4/8: 更新メニュー操作...");
    await page.$$eval('button, a, span', (elements) => {
        const menu = elements.find(el => el.className?.includes('menuTrigger') || el.ariaLabel === 'メニュー');
        if (menu) menu.click();
    }).catch(() => {});
    await randomWait(1500, 2500);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    console.log("5/8: 継続ボタンクリック...");
    await randomWait(3000, 5000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // --- 6. ここからが本番：Cloudflare & 画像認証 粘り強い待機 ---
    console.log("6/8: 画像認証のロードを監視中...");
    
    let captchaFound = false;
    for (let i = 0; i < 3; i++) { // 最大3回チャレンジ
        try {
            // Cloudflareのチェックボックスがあるか確認
            const turnstile = await page.$('iframe[src*="cloudflare"]');
            if (turnstile) {
                console.log("Cloudflare Turnstile検知。クリックを試みます...");
                const rect = await turnstile.boundingBox();
                if (rect) {
                    // チェックボックスの左端（50pxあたり）を狙う
                    await page.mouse.click(rect.x + 50, rect.y + rect.height / 2);
                    await randomWait(6000, 10000);
                }
            }

            // 画像が出るか待つ（タイムアウトを短くしてループを回す）
            await page.waitForSelector('img[src^="data:"]', { visible: true, timeout: 20000 });
            captchaFound = true;
            break;
        } catch (e) {
            console.log(`画像が見つかりません。リロードして再試行します (${i+1}/3)`);
            await page.reload({ waitUntil: 'load' });
            await randomWait(5000, 8000);
        }
    }

    if (!captchaFound) throw new Error("画像認証にたどり着けませんでした。Cloudflareにブロックされている可能性があります。");

    const body = await page.$eval('img[src^="data:"]', img => img.src)
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    const cleanCode = captchaResponse.trim();
    console.log(`解析結果: ${cleanCode}`);

    // 7. コード入力 (JS強制注入)
    console.log("7/8: 入力実行...");
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
    console.log("8/8: 最終ボタン...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    await randomWait(5000, 8000);
    console.log("処理完了");

} catch (e) {
    console.error('詳細エラー:', e)
} finally {
    await recorder.stop()
    await browser.close()
}
