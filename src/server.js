import express from 'express'
import crypto from 'crypto'
import cookieParser from 'cookie-parser'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()

/* ================= 基础配置 ================= */

app.use(express.json())
app.use(cookieParser())

// Railway / Cloudflare 真实 IP
app.set('trust proxy', true)

const PORT = process.env.PORT || 3000
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

// 伪装访问路径（不像 /t/xxx）
const TRACK_PREFIX = '/go'

/* ================= 工具函数 ================= */

function genToken(len = 6) {
  return crypto.randomBytes(len).toString('base64url')
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
  if (req.cookies.admin === '1') return next()
  res.redirect('/login')
}

/* ================= 首页（可有可无） ================= */

app.get('/', (req, res) => {
  res.send('OK')
})

/* ================= 登录 ================= */

app.get('/login', (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Admin Login</title>
<style>
body{font-family:sans-serif;background:#111;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh}
.box{background:#1e1e1e;padding:30px;border-radius:8px;width:280px}
input,button{width:100%;padding:10px;margin-top:10px;border-radius:4px;border:none}
button{background:#4f46e5;color:#fff;cursor:pointer}
p{color:#f87171}
</style>
</head>
<body>
<div class="box">
<h3>Admin Login</h3>
<input id="pwd" type="password" placeholder="Password"/>
<button onclick="go()">Login</button>
<p id="msg"></p>
</div>
<script>
async function go(){
  const r = await fetch('/api/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:pwd.value})
  })
  const d = await r.json()
  if(d.ok) location.href='/admin'
  else msg.innerText='Wrong password'
}
</script>
</body>
</html>
`)
})

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('admin', '1', { httpOnly: true })
    res.json({ ok: true })
  } else {
    res.json({ ok: false })
  }
})

/* ================= 后台 ================= */

app.get('/admin', requireAdmin, async (req, res) => {
  const links = await prisma.link.findMany({
    include: { visits: true },
    orderBy: { id: 'desc' }
  })

  const rows = links.map(l => `
<tr>
<td>${l.token}</td>
<td>${l.used ? '✔' : '—'}</td>
<td>${l.visits.length}</td>
<td>
  ${l.visits.map(v =>
    `<div style="font-size:12px;color:#aaa">
      ${v.ip} | ${v.userAgent}
    </div>`
  ).join('')}
</td>
</tr>
`).join('')

  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Admin</title>
<style>
body{font-family:sans-serif;background:#0f0f0f;color:#fff;padding:20px}
h1{margin-bottom:10px}
button{padding:8px 12px;border:none;border-radius:4px;background:#22c55e;color:#000;cursor:pointer}
input{padding:8px;width:360px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{border:1px solid #333;padding:8px;vertical-align:top}
th{background:#1f1f1f}
.copy{background:#3b82f6;color:#fff}
.msg{color:#22c55e}
</style>
</head>
<body>

<h1>IP Link Tracker</h1>

<button onclick="gen()">生成新链接</button>
<br/><br/>
<input id="link" readonly />
<button class="copy" onclick="copy()">复制</button>
<span id="msg" class="msg"></span>

<table>
<tr>
<th>Token</th>
<th>已使用</th>
<th>访问数</th>
<th>记录</th>
</tr>
${rows}
</table>

<script>
async function gen(){
  const r = await fetch('/api/generate',{method:'POST'})
  const d = await r.json()
  link.value = d.url
  msg.innerText = ''
}
async function copy(){
  try{
    await navigator.clipboard.writeText(link.value)
    msg.innerText = '✔ 已复制'
  }catch(e){
    msg.innerText = '复制失败'
  }
}
</script>

</body>
</html>
`)
})

/* ================= 生成短链 ================= */

app.post('/api/generate', requireAdmin, async (req, res) => {
  const token = genToken()
  await prisma.link.create({
    data: {
      token,
      targetUrl: 'https://example.com', // 可改成你想跳的默认地址
      used: false
    }
  })

  res.json({
    url: `${req.protocol}://${req.get('host')}${TRACK_PREFIX}/${token}`
  })
})

/* ================= 追踪入口（无停留，秒跳） ================= */

app.get(`${TRACK_PREFIX}/:token`, async (req, res) => {
  const { token } = req.params

  const link = await prisma.link.findUnique({ where: { token } })
  if (!link) return res.redirect('https://google.com')

  // 记录 IP + UA（用户无感）
  await prisma.visit.create({
    data: {
      ip: getIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      linkId: link.id
    }
  })

  // 一次性可用
  if (!link.used) {
    await prisma.link.update({
      where: { id: link.id },
      data: { used: true }
    })
  }

  // 立即跳转（0 页面停留）
  return res.redirect(302, link.targetUrl)
})

/* ================= 启动 ================= */

app.listen(PORT, () => {
  console.log('Server running on port', PORT)
})
