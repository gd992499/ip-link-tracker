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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'

/* ================= 工具 ================= */

function genToken() {
  return crypto.randomBytes(6).toString('base64url')
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

/* ================= 首页（伪装） ================= */

app.get('/', (req, res) => {
  res.status(404).send('Not Found')
})

/* ================= 登录 ================= */

app.get('/login', (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Login</title>
<style>
body{background:#0f172a;color:#e5e7eb;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}
.box{background:#020617;padding:30px;border-radius:10px;width:260px}
input,button{width:100%;padding:10px;margin-top:10px;border-radius:6px;border:none}
button{background:#6366f1;color:#fff}
p{color:#f87171}
</style>
</head>
<body>
<div class="box">
<h3>Admin Login</h3>
<input id="pwd" type="password" placeholder="Password"/>
<button onclick="go()">Login</button>
<p id="m"></p>
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
  else m.innerText='Wrong password'
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
  `<div class="v">${v.ip}<br><small>${v.userAgent}</small></div>`
).join('')}
</td>
</tr>
`).join('')

  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Admin</title>
<style>
body{background:#020617;color:#e5e7eb;font-family:sans-serif;padding:20px}
h1{margin-bottom:10px}
button{background:#6366f1;color:#fff;border:none;padding:8px 14px;border-radius:6px}
table{width:100%;border-collapse:collapse;margin-top:15px}
th,td{border-bottom:1px solid #1e293b;padding:8px;text-align:left;vertical-align:top}
th{color:#93c5fd}
.v{background:#020617;border:1px solid #1e293b;padding:6px;margin:4px 0;border-radius:6px}
input{padding:8px;width:320px}
.msg{color:#22c55e;margin-left:10px}
</style>
</head>
<body>

<h1>IP Link Tracker</h1>

<button onclick="gen()">Generate Link</button>
<br><br>
<input id="link" readonly>
<button onclick="copy()">Copy</button>
<span class="msg" id="msg"></span>

<table>
<tr>
<th>Token</th>
<th>Used</th>
<th>Visits</th>
<th>Records</th>
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
    msg.innerText='Copied'
  }catch{
    msg.innerText='Failed'
  }
}
</script>

</body>
</html>
`)
})

/* ================= 生成链接 ================= */

app.post('/api/generate', requireAdmin, async (req, res) => {
  const token = genToken()
  const link = await prisma.link.create({
    data: {
      token,
      targetUrl: 'https://example.com',
      used: false
    }
  })

  res.json({
    url: req.protocol + '://' + req.get('host') + '/r/' + token
  })
})

/* ================= 追踪入口（核心） ================= */

app.get('/r/:token', async (req, res) => {
  const link = await prisma.link.findUnique({
    where: { token: req.params.token }
  })

  if (!link) {
    return res.redirect('https://example.com')
  }

  await prisma.visit.create({
    data: {
      ip: getIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      linkId: link.id
    }
  })

  if (!link.used) {
    await prisma.link.update({
      where: { id: link.id },
      data: { used: true }
    })
  }

  return res.redirect(302, link.targetUrl)
})

/* ================= 启动 ================= */

app.listen(PORT, () => {
  console.log('Server running on ' + PORT)
})
