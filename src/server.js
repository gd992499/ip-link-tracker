import express from 'express'
import crypto from 'crypto'
import cookieParser from 'cookie-parser'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()

app.use(express.json())
app.use(cookieParser())
app.set('trust proxy', true)

const PORT = process.env.PORT || 3000
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

/* ===== 工具 ===== */

function genToken() {
  return crypto.randomBytes(8).toString('base64url')
}

function getIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown'
  )
}

function requireAdmin(req, res, next) {
  if (req.cookies.admin === '1') next()
  else res.redirect('/login')
}

/* ===== 首页 ===== */

app.get('/', (req, res) => {
  res.send(`
<h1>IP Link Tracker</h1>
<p>系统运行中</p>
<a href="/admin">进入后台</a>
`)
})

/* ===== 登录 ===== */

app.get('/login', (req, res) => {
  res.send(`
<h2>管理员登录</h2>
<input id="pwd" type="password"/>
<button onclick="go()">登录</button>
<p id="m"></p>
<script>
async function go(){
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd.value})})
  const d=await r.json()
  if(d.ok) location.href='/admin'
  else m.innerText='密码错误'
}
</script>
`)
})

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('admin', '1', { httpOnly: true })
    res.json({ ok: true })
  } else res.json({ ok: false })
})

/* ===== 后台 ===== */
app.get('/admin', requireAdmin, async (req, res) => {
  const links = await prisma.link.findMany({
    orderBy: { id: 'desc' }
  })

  let html = `
  <h1>后台管理</h1>
  <button onclick="gen()">生成一次性链接</button>
  <p id="out"></p>
  <hr/>
  `

  for (const l of links) {
    const visits = await prisma.visit.findMany({
      where: { linkId: l.id },
      orderBy: { id: 'desc' }
    })

    html += `
    <div style="border:1px solid #ccc;padding:8px;margin:8px 0">
      <b>Token:</b> ${l.token}<br/>
      <b>访问次数:</b> ${visits.length}<br/>
      ${visits.map(v =>
        `<div>${v.ip} | ${v.userAgent} | ${v.createdAt}</div>`
      ).join('')}
    </div>
    `
  }

  html += `
  <script>
  async function gen(){
    const r = await fetch('/api/generate',{method:'POST'})
    const d = await r.json()
    out.innerText = d.url
  }
  </script>
  `

  res.send(html)
})
<tr>
<td>${l.token}</td>
<td>${l.used ? '已使用' : '未使用'}</td>
<td>${l.visits.length}</td>
<td>
${l.visits.map(v => `
<div>${v.ip} | ${v.userAgent} | ${v.createdAt}</div>
`).join('')}
</td>
</tr>
`).join('')

  res.send(`
<h1>后台管理</h1>
<button onclick="gen()">生成一次性链接</button>
<p id="out"></p>

<table border="1" cellpadding="5">
<tr><th>Token</th><th>状态</th><th>次数</th><th>记录</th></tr>
${rows}
</table>

<script>
async function gen(){
  const r=await fetch('/api/generate',{method:'POST'})
  const d=await r.json()
  out.innerText=d.url
}
</script>
`)
})

/* ===== 生成链接 ===== */

app.post('/api/generate', requireAdmin, async (req, res) => {
  const token = genToken()
  await prisma.link.create({ data: { token } })
  res.json({
    url: req.protocol + '://' + req.get('host') + '/t/' + token
  })
})

/* ===== 追踪入口 ===== */

app.get('/t/:token', async (req, res) => {
  const link = await prisma.link.findUnique({
    where: { token: req.params.token }
  })

  if (!link || link.used) {
    return res.send('链接无效或已使用')
  }

  await prisma.visit.create({
    data: {
      ip: getIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      linkId: link.id
    }
  })

  await prisma.link.update({
    where: { id: link.id },
    data: { used: true }
  })

  res.send('访问已记录')
})

app.listen(PORT, () => {
  console.log('Server running')
})
