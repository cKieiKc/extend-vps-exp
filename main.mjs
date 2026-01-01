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

    // 1. ログイン（通信の終了を待たず、DOMの構築で次へ）
    console.log("ログインページへ移動中...");
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'domcontentloaded' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    
    // ログイン後の読み込み待ち
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => {})

    // 2. 詳細リンクのクリック（2つある問題を回避）
    console.log("サーバー一覧から詳細リンクを探しています...");
    const detailLinkSelector = 'a[href^="/xapanel/xvps/server/detail?id="]';
    await page.waitForSelector(detailLinkSelector, { timeout: 20000 })
    
    await Promise.all([
        page.$$eval(detailLinkSelector, (els) => els[0].click()),
        page.waitForNavigation({ waitUntil: 'load' }).catch(() => {})
    ]);

    // 3. 画面が白い状態を突破するための明示的待機
    console.log("詳細画面の読み込みを待機中...");
    await setTimeout(5000); // 描画時間を稼ぐ

    // 4. 「更新する」ボタンのクリック
    // メニュー内に隠れている可能性を考慮し、三点リーダーがあればクリック
    await page.$$eval('button, a, span, i', (elements) => {
        const menu = elements.find(el => 
            el.className?.includes('menuTrigger') || 
            el.ariaLabel === 'メニュー' ||
            el.className?.includes('fa-ellipsis-v')
        );
        if (menu) menu.click();
    }).catch(() => {});
    
    await setTimeout(1000);

    // 「更新する」をクリック（JSで強制実行）
    const clickedUpdate = await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.trim() === '更新する');
        if (target) {
            target.click();
            return true;
        }
        return false;
    });
    console.log(`「更新する」ボタンクリック: ${clickedUpdate}`);

    // 5. 「引き続き無料...」をクリック
    await setTimeout(2000);
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('引き続き無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // 6. 画像認証画面（画像が出るまで待つ）
    console.log("画像認証を待機中...");
    await page.waitForSelector('img[src^="data:"]', { timeout: 20000 });
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    const captchaResponse = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    
    const cleanCode = captchaResponse.trim();
    console.log(`解析されたコード: ${cleanCode}`);

    // 7. コード入力
    const inputSelector = '[placeholder="上の画像の数字を入力"]';
    await page.waitForSelector(inputSelector);
    await page.locator(inputSelector).fill(cleanCode);
    
    await setTimeout(2000);

    // 8. 最終実行
    console.log("最終ボタンをクリックします...");
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => 
            el.textContent.includes('無料VPSの利用を継続する') && 
            !el.textContent.includes('引き続き')
        );
        if (target) target.click();
    });

    // 完了確認のために少し待つ
    await setTimeout(5000);

} catch (e) {
    console.error('実行中にエラーが発生しました:', e)
} finally {
    await recorder.stop()
    await browser.close()
    console.log("ブラウザを閉じました。");
}
