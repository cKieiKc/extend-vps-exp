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
    console.log("1/8: ログインページへ移動中...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {})

    // 2. 詳細リンクのクリック
    console.log("2/8: 詳細リンクを探しています...");
    const detailLinkSelector = 'a[href^="/xapanel/xvps/server/detail?id="]';
    await page.waitForSelector(detailLinkSelector, { timeout: 20000 })
    await page.$$eval(detailLinkSelector, (els) => els[0].click());

    // 3. 詳細画面の表示待ち（真っ白対策）
    console.log("3/8: 詳細画面の描画を待機中...");
    await setTimeout(5000); 

    // 4. 「更新する」ボタンのクリック
    // 三点リーダーメニュー対策
    await page.$$eval('button, a, span, i', (elements) => {
        const menu = elements.find(el => 
            el.className?.includes('menuTrigger') || 
            el.ariaLabel === 'メニュー' ||
            el.className?.includes('fa-ellipsis-v')
        );
        if (menu) menu.click();
    }).catch(() => {});
    
    await setTimeout(1500);

    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) target.click();
    });

    // 5. 「引き続き無料...」をクリック
    console.log("5/8: 継続ボタンをクリックします...");
    await setTimeout(3000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // 6. 画像認証画面（重要：ナビゲーションを待たずに画像が出るまで粘る）
    console.log("6/8: 画像認証の出現を待機中（最大60秒）...");
    
    // 画像そのものがDOMに出現し、かつ見える状態になるのを待つ
    await page.waitForSelector('img[src^="data:"]', { 
        visible: true, 
        timeout: 60000 
    }).catch(async () => {
        console.log("画面が白い可能性があるため、リロードを試みます...");
        await page.evaluate(() => window.scrollBy(0, 100)); // 描画刺激
    });

    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    
    const cleanCode = captchaResponse.trim();
    console.log(`取得したコード: ${cleanCode}`);

    // 7. コード入力
    const inputSelector = '[placeholder="上の画像の数字を入力"]';
    await page.waitForSelector(inputSelector);
    await page.locator(inputSelector).fill(cleanCode);
    
    await setTimeout(2000);

    // 8. 最終実行
    console.log("8/8: 最終完了ボタンをクリック...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && 
            !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    console.log("すべての処理が完了しました。");
    await setTimeout(5000);

} catch (e) {
    console.error('実行中にエラーが発生しました:', e)
} finally {
    await recorder.stop()
    await browser.close()
}
