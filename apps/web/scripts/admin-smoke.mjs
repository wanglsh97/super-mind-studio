import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'
const errors = []

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  console.log('1. Login page')
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '管理员登录' }).waitFor()
  assert(
    !(await page
      .getByText('V1 固定账号')
      .isVisible()
      .catch(() => false)),
    '联调警告应已移除',
  )

  console.log('2. Login')
  await page.getByLabel('密码').fill('123456')
  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL('**/admin', { timeout: 15_000 })
  assert(!page.url().includes('/login'), `登录后应进入控制台，当前 ${page.url()}`)

  console.log('3. Dashboard')
  await page.getByRole('heading', { name: '运行概览' }).waitFor({ timeout: 15_000 })
  await page.screenshot({ path: 'apps/web/tmp/ui-smoke/admin-dashboard.png' })

  console.log('4. Request logs')
  await page.getByRole('link', { name: '请求日志' }).click()
  await page.waitForURL('**/admin/logs')
  await page.getByRole('heading', { name: '请求日志' }).waitFor()
  await page.getByRole('button', { name: '筛选' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'apps/web/tmp/ui-smoke/admin-logs.png' })

  console.log('5. Database')
  await page.getByRole('menuitem', { name: '数据库' }).click()
  await page.waitForURL('**/admin/database**')
  await page.getByRole('menuitem', { name: 'User' }).click()
  await page.waitForURL('**/admin/database?table=users**')
  await page.waitForTimeout(1000)
  await page.getByText('只读').waitFor()
  const tableMenuCount = await page
    .locator('.aigateway-admin-menu .ant-menu-sub .ant-menu-item')
    .count()
  assert(tableMenuCount >= 11, `数据库子菜单应展示 11 张表，实际 ${tableMenuCount}`)
  await page.screenshot({ path: 'apps/web/tmp/ui-smoke/admin-database.png' })

  console.log('6. Audit logs table')
  await page.getByRole('menuitem', { name: 'AdminAuditLog' }).click()
  await page.waitForURL('**/admin/database?table=admin-audit-logs**')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'apps/web/tmp/ui-smoke/admin-audit.png' })

  console.log('7. API schema check')
  const schema = await page.evaluate(async () => {
    const response = await fetch('/api/v1/admin/tables/schema', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`schema ${response.status}`)
    return response.json()
  })
  assert(Array.isArray(schema.tables) && schema.tables.length >= 11, 'schema 表数量不足')
  assert(Array.isArray(schema.relations) && schema.relations.length > 0, 'schema 关联为空')

  console.log(
    JSON.stringify({
      ok: true,
      url: page.url(),
      tables: schema.tables.length,
      relations: schema.relations.length,
      pageErrors: errors,
    }),
  )
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      pageErrors: errors,
      url: page.url(),
    }),
  )
  await page
    .screenshot({ path: 'apps/web/tmp/ui-smoke/admin-failure.png', fullPage: true })
    .catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
