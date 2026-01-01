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

    await page.goto('https://secure.xserver.ne.jp/xapanel/login/xvps/', { waitUntil: 'networkidle2' })
    await page.locator('#memberid').fill(process.env.EMAIL)
    await page.locator('#user_password').fill(process.env.PASSWORD)
    await page.locator('text=ログインする').click()
    await page.waitForNavigation({ waitUntil: 'networkidle2' })

    // --- 修正ポイント1: 複数あるリンクのうち1つ目を確実にクリック ---
    await page.waitForSelector('a[href^="/xapanel/xvps/server/detail?id="]')
    await page.$$eval('a[href^="/xapanel/xvps/server/detail?id="]', (els) => {
        if (els.length > 0) els[0].click();
    });

    // --- 修正ポイント2: 遷移を待ってから「更新する」をクリック ---
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    await page.locator('text=更新する').click()
    await page.locator('text=引き続き無料VPSの利用を継続する').click()
    
    // --- 修正ポイント3: キャプチャ画面の待機と入力後の安定化 ---
    await page.waitForNavigation({ waitUntil: 'networkidle2' })
    const body = await page.$eval('img[src^="data:"]', img => img.src)
    const code = await fetch('https://captcha-120546510085.asia-northeast1.run.app', { method: 'POST', body })
        .then(r => r.text())
    
    console.log(`Captcha code: ${code.trim()}`); // デバッグ用

    const inputSelector = '[placeholder="上の画像の数字を入力"]';
    await page.waitForSelector(inputSelector);
    await page.locator(inputSelector).fill(code.trim());
    
    // 入力が反映されるまで少し待機（重要）
    await setTimeout(2000);

    // ボタンが複数ヒットしてエラーになるのを防ぐため .last() を使用
    await page.locator('text=無料VPSの利用を継続する').last().click()

} catch (e) {
    console.error('エラー発生:', e)
}
