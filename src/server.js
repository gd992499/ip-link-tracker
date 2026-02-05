import express from 'express'
import crypto from 'crypto'
import cookieParser from 'cookie-parser'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()

app.use(express.json())
app.use(cookieParser())

// Railway / Cloudflare
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
  if (req.cookies.admin === '1') return next()
  return res.redirect('/login')
}

/* ================= HTML 模板 ================= */

function page(title, body) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body {
  background:#020617;
  color:#e5e7eb;
  font-family:-apple-system,BlinkMacSystemFont;
  padding:30px;
}
h1 { margin-bottom:10px }
a { color:#38bdf8; text-decoration:none }
button {
  background:#2563eb;
  color:#fff;
  border:none;
  padding:8px 14px;
  border-radius:6px;
  cursor:pointer;
}
input {
  padding:6px;
  border-radius:6px;
  border:none;
}
table {
  width:100%;
  border-collapse:collapse;
  margin-top:20px;
}
th,td {
  border:1px solid #1e293b;
  padding:8px;
  vertical-align:top;
}
th {
  background:#020617;
  text-align:left;
}
.visit {
  font-size:12px;
  color:#94a3b8;
  margin-bottom:4px;
}
.small { color:#94a3b8; font-size:12px }
</style>
</head>
<body>
${body}
</body>
</html>`
}

/* ================= 首页 ================= */

app.get('/', (req, res) => {
  res.send(
    page(
      'IP Link Tracker',
      `<h1>IP Link Tracker</h1>
<p class="small">服务运行中</p>
<a href="/admin">进入后台</a>`
    )
  )
})

/* ================= 登录 ================= */

app.get('/login', (req, res) => {
  res.send(
    page(
      '登录',
      `<h2>管理员登录</h2>
<input id="pwd" type="password" placeholder="密码">
<button onclick="go()">登录</button>
<p id="msg"></p>

<script>
async function go(){
  const r = await fetch('/api/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:pwd.value})
  })
  const d = await r.json()
  if(d.ok) location.href='/admin'
  else msg.innerText='密码错误'
}
</script>`
    )
  )
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
    include: {
      visits: { orderBy: { createdAt: 'desc' } }
    },
    orderBy: { id: 'desc' }
  })

  const rows = links.map(l => {
    const visits = l.visits.length
      ? l.visits.map(v =>
          `<div class="visit">
${v.ip} ｜ ${v.userAgent} ｜ ${new Date(v.createdAt).toLocaleString()}
</div>`
        ).join('')
      : '<div class="visit">无</div>'

    return `<tr>
<td>${l.token}</td>
<td>${l.targetUrl}</td>
<td>${l.used ? '是' : '否'}</td>
<td>${l.visits.length}</td>
<td>${visits}</td>
</tr>`
  }).join('')

  res.send(
    page(
      '后台',
      `<h1>后台管理</h1>

<button onclick="gen()">生成追踪链接</button>
<p id="out" class="small"></p>

<table>
<tr>
<th>Token</th>
<th>目标地址</th>
<th>已使用</th>
<th>访问数</th>
<th>访问记录</th>
</tr>
${rows}
</table>

<script>
async function gen(){
  const r = await fetch('/api/generate',{method:'POST'})
  const d = await r.json()
  out.innerText = d.url
}
</script>`
    )
  )
})

/* ================= 生成链接 ================= */

app.post('/api/generate', requireAdmin, async (req, res) => {
  const token = genToken()

  const link = await prisma.link.create({
    data: {
      token,
      targetUrl: 'https://example.com'
    }
  })

  res.json({
    url: req.protocol + '://' + req.get('host') + '/t/' + link.token
  })
})

/* ================= 无感知追踪入口 ================= */

app.get('/t/:token', async (req, res) => {
  const link = await prisma.link.findUnique({
    where: { token: req.params.token }
  })

  if (!link) {
    // 表现和普通短链一致
    return res.status(404).end()
  }

  // 先记录（用户无感知）
  prisma.visit.create({
    data: {
      ip: getIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      linkId: link.id
    }
  }).catch(()=>{})

  // 可选：一次性
  if (!link.used) {
    prisma.link.update({
      where: { id: link.id },
      data: { used: true }
    }).catch(()=>{})
  }

  // 立刻跳转（关键）
  return res.redirect(302, link.targetUrl)
})

/* ================= 启动 ================= */

app.listen(PORT, () => {
  console.log('Server running on', PORT)
})
