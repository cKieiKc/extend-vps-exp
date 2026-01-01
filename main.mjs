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

    // 1. ログイン処理
    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'networkidle2' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    await page.waitForNavigation({ waitUntil: 'networkidle2' })

    // 2. サーバー詳細リンク（34行目付近の修正）
    // 複数ヒット問題を回避するため、ブラウザ側で1番目の要素を確実にクリック
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]')
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', (els) => {
        if (els.length > 0) els[0].click();
    });

    // 3. 更新ボタンの操作
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    await page.locator('text=更新する').click()
    await page.locator('text=引き続き無料VPSの利用を継続する').click()
    
    // 4. キャプチャ画像解析
    await page.waitForNavigation({ waitUntil: 'networkidle2' })
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    
    // fetchの結果をcaptchaCodeとして定義（変数名の重複を回避）
    const captchaCode = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    
    const cleanCode = captchaCode.trim();
    console.log(`取得したコード: ${cleanCode}`);

    // 5. コード入力
    const inputSelector = '[placeholder="上の画像の数字を入力"]';
    await page.waitForSelector(inputSelector);
    await page.locator(inputSelector).fill(cleanCode);
    
    // 入力がWebサイト側に反映されるのを少し待つ
    await setTimeout(2000);

    // 6. 最終実行ボタン（タイムアウト対策：JSで直接クリック）
    await page.$$eval('button, a, span', (elements) => {
        const target = elements.find(el => el.textContent.includes('無料VPSの利用を継続する'));
        if (target) target.click();
    });

    // 完了後の遷移を待つ
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

} catch (e) {
    console.error('実行エラーが発生しました:', e)
} finally {
    // 最後に録画を止めてブラウザを閉じる
    await setTimeout(5000)
    await recorder.stop()
    await browser.close()
}
