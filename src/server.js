import express from 'express'
import rateLimit from 'express-rate-limit'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()

app.use(express.json())
app.set('trust proxy', true)
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>IP Link Tracker</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body>
      <h1>IP Link Tracker</h1>
      <p>HTML 首页已加载</p>
    </body>
    </html>
  `)
})
app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>后台 - IP Link Tracker</title>
    </head>
    <body>
      <h1>后台管理</h1>

      <button onclick="generate()">生成一次性追踪链接</button>

      <p id="result"></p>

      <script>
        async function generate() {
          const res = await fetch('/api/generate', { method: 'POST' })
          const data = await res.json()
          document.getElementById('result').innerText = data.url
        }
      </script>
    </body>
    </html>
  `)
})
app.post("/api/generate", (req, res) => {
  const token = generateToken()
  res.json({
    url: req.protocol + '://' + req.get('host') + '/t/' + token
  })
})
const PORT = process.env.PORT || 3000
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

/* ---------- 工具 ---------- */

function generateToken() {
  return crypto.randomBytes(8).toString('base64url')
}

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown'
  )
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).send('Unauthorized')

  const [, password] = Buffer.from(auth.split(' ')[1], 'base64')
    .toString()
    .split(':')

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).send('Forbidden')
  }
  next()
}

/* ---------- 防刷 ---------- */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20
})

/* ---------- 一次性访问链接 ---------- */

app.get('/t/:token', limiter, async (req, res) => {
  const { token } = req.params
  const ip = getClientIp(req)
  const ua = req.headers['user-agent'] || 'unknown'

  try {
    await prisma.$transaction(async (tx) => {
      const link = await tx.link.findUnique({ where: { token } })
      if (!link) throw new Error('USED')

      await tx.visit.create({
        data: {
          linkId: link.id,
          ip,
          userAgent: ua
        }
      })

      // 访问后立即删除
      await tx.link.delete({ where: { id: link.id } })
    })

    res.send(`
      <h2>访问成功</h2>
      <p>该链接已自动失效</p>
    `)
  } catch {
    res.status(410).send('Link expired or already used')
  }
})

/* ---------- 网页后台 ---------- */

app.get('/admin', adminAuth, async (req, res) => {
  const links = await prisma.link.findMany({
    orderBy: { createdAt: 'desc' }
  })

  const rows = links.map(l => `
    <tr>
      <td>${l.id}</td>
      <td>
        <a href="/t/${l.token}" target="_blank">打开</a>
      </td>
      <td>
        <a href="/admin/visits/${l.id}">访问记录</a>
      </td>
    </tr>
  `).join('')

  res.send(`
    <html>
    <head>
      <meta charset="utf-8" />
      <title>后台</title>
      <style>
        body { font-family: sans-serif; padding: 40px }
        table { border-collapse: collapse; margin-top: 20px }
        td, th { border: 1px solid #ccc; padding: 8px 12px }
      </style>
    </head>
    <body>
      <h2>一次性链接后台</h2>

      <form method="post" action="/admin/create">
        <button>➕ 生成一次性链接</button>
      </form>

      <table>
        <tr>
          <th>ID</th>
          <th>链接</th>
          <th>记录</th>
        </tr>
        ${rows}
      </table>
    </body>
    </html>
  `)
})

app.post('/admin/create', adminAuth, async (req, res) => {
  const token = generateToken()
  await prisma.link.create({ data: { token } })
  res.redirect('/admin')
})

app.get('/admin/visits/:id', adminAuth, async (req, res) => {
  const visits = await prisma.visit.findMany({
    where: { linkId: Number(req.params.id) },
    orderBy: { createdAt: 'desc' }
  })

  const rows = visits.map(v => `
    <tr>
      <td>${v.ip}</td>
      <td>${v.userAgent}</td>
      <td>${v.createdAt}</td>
    </tr>
  `).join('')

  res.send(`
    <html>
    <body>
      <h3>访问记录</h3>
      <a href="/admin">返回</a>
      <table border="1" cellpadding="8">
        <tr><th>IP</th><th>UA</th><th>时间</th></tr>
        ${rows || '<tr><td colspan="3">暂无</td></tr>'}
      </table>
    </body>
    </html>
  `)
})

app.listen(PORT, () => {
  console.log('Server running')
}) 
