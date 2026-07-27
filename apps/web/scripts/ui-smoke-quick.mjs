import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = 'http://localhost:3000'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(scriptDir, '../tmp/ui-smoke')
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ headless: true })

for (const [name, width] of [
  ['minimum-pc', 1366],
  ['desktop', 1440],
]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.screenshot({
    path: path.join(outDir, `home-${name}.png`),
    fullPage: false,
  })

  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  await page.goto(`${baseUrl}/agent`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({
    path: path.join(outDir, `agent-guard-${name}.png`),
    fullPage: false,
  })

  console.log(JSON.stringify({ viewport: name, pageErrors: errors }))
  await context.close()
}

await browser.close()
