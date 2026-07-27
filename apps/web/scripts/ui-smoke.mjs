import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = process.env.UI_BASE_URL ?? 'http://localhost:3000'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(scriptDir, '../tmp/ui-smoke')

const routes = [
  { path: '/', name: 'home', expect: ['一个入口', '开始对话'] },
  { path: '/login', name: 'login', expect: ['Continue with GitHub', 'Every capability'] },
  { path: '/skills', name: 'skills', expect: ['已安装技能', '展示模式'] },
  { path: '/api', name: 'api', expect: ['接入网关', '能力端点'] },
  { path: '/chat', name: 'chat', expect: ['登录', 'GitHub'] },
  { path: '/agent', name: 'agent', expect: ['登录', 'GitHub'] },
  { path: '/image', name: 'image', expect: ['登录', 'GitHub'] },
  { path: '/prompt', name: 'prompt', expect: ['登录', 'GitHub'] },
]

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const results = []

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  })
  await context.addInitScript(() => {
    document.documentElement.classList.toggle(
      'dark',
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    )
  })
  if (theme === 'dark') {
    await context.addInitScript(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
    })
  }

  const page = await context.newPage()

  for (const route of routes) {
    const routeIssues = []
    const onConsole = (msg) => {
      const text = msg.text()
      if (msg.type() === 'error' && !text.includes('favicon')) {
        routeIssues.push(`console: ${text}`)
      }
    }
    const onPageError = (error) => routeIssues.push(`pageerror: ${error.message}`)
    const onResponse = (response) => {
      if (response.url().includes('/api/') && response.status() >= 500) {
        routeIssues.push(`api ${response.status()}: ${response.url()}`)
      }
    }

    page.on('console', onConsole)
    page.on('pageerror', onPageError)
    page.on('response', onResponse)

    let status = 0
    let bodyText = ''
    let screenshotOk = false

    try {
      const response = await page.goto(`${baseUrl}${route.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      status = response?.status() ?? 0
      await page.waitForTimeout(1200)
      bodyText = await page.locator('body').innerText()
      const screenshot = path.join(outDir, `${route.name}-${theme}.png`)
      await page.screenshot({ path: screenshot, fullPage: false })
      screenshotOk = true
    } catch (error) {
      routeIssues.push(`navigation: ${error instanceof Error ? error.message : String(error)}`)
    }

    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)

    const missingExpect = route.expect.filter((text) => !bodyText.includes(text))

    results.push({
      theme,
      route: route.path,
      status,
      title: await page.title().catch(() => ''),
      screenshotOk,
      missingExpect,
      issues: routeIssues,
      preview: bodyText.slice(0, 180).replace(/\s+/g, ' '),
    })
  }

  await context.close()
}

await browser.close()

const failed = results.filter(
  (r) => r.status >= 400 || r.missingExpect.length > 0 || r.issues.length > 0 || !r.screenshotOk,
)

console.log(
  JSON.stringify(
    {
      baseUrl,
      outDir,
      passed: results.length - failed.length,
      total: results.length,
      failed,
      results,
    },
    null,
    2,
  ),
)
process.exit(failed.length > 0 ? 1 : 0)
