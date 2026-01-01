import puppeteer from 'puppeteer'
import { setTimeout } from 'node:timers/promises'

const args = ['--no-sandbox', '--disable-setuid-sandbox']
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
    console.log("2/8: 詳細リンクをクリック...");
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]', { timeout: 20000 })
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', (els) => els[0].click());

    // 3. 詳細画面
    console.log("3/8: 詳細画面のロード待ち...");
    await setTimeout(5000); 

    // 4. 更新するボタン
    console.log("4/8: 「更新する」をクリック...");
    await page.$$eval('button, a, span', (elements) => {
        const menu = elements.find(el => el.className?.includes('menuTrigger') || el.ariaLabel === 'メニュー');
        if (menu) menu.click();
    }).catch(() => {});
    await setTimeout(2000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    // 5. 継続ボタン（ここを強化）
    console.log("5/8: 継続ボタンを強力にクリック...");
    await setTimeout(3000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) {
            target.scrollIntoView();
            target.click(); // 通常クリック
            setTimeout(() => target.dispatchEvent(new Event('click')), 500); // 追い打ちクリック
        }
    });

    // 6. 画像認証画面（真っ白対策：リロードを導入）
    console.log("6/8: 画像認証の出現を待機中...");
    let captchaImg = null;
    for (let i = 0; i < 2; i++) { // 最大2回試行
        try {
            captchaImg = await page.waitForSelector('img[src^="data:"]', { visible: true, timeout: 30000 });
            if (captchaImg) break;
        } catch (e) {
            console.log(`画面が白いままです。リロードして再試行します (${i+1}/2)`);
            await page.reload({ waitUntil: 'load' });
            await setTimeout(3000);
        }
    }

    if (!captchaImg) throw new Error("画像認証要素がどうしても見つかりませんでした。");

    const body = await page.$eval('img[src^="data:"]', img => img.src)
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    
    const cleanCode = captchaResponse.trim();
    console.log(`取得コード: ${cleanCode}`);

    // 7. コード入力
    await page.locator('[placeholder="上の画像の数字を入力"]').fill(cleanCode);
    await setTimeout(2000);

    // 8. 最終実行
    console.log("8/8: 最終完了ボタンをクリック...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    console.log("完了しました！");
    await setTimeout(5000);

} catch (e) {
    console.error('実行中にエラーが発生しました:', e)
} finally {
    await recorder.stop()
    await browser.close()
}
