import express from 'express'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const app = express()
const prisma = new PrismaClient()
const PORT = process.env.PORT || 3000

app.use(express.json())

/* ================= 工具 ================= */

function genToken(len = 6) {
  return crypto.randomBytes(len).toString('hex').slice(0, len)
}

function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown'
  )
}

/* ================= 跳转入口（伪装路径） ================= */
/* 看起来 = 正常短链
   行为 = 立刻 302 跳转
   无页面 / 无停留 */

app.get('/go/:token', async (req, res) => {
  const { token } = req.params

  const link = await prisma.link.findUnique({ where: { token } })
  if (!link) return res.status(404).send('Not Found')

  // 记录访问
  await prisma.visit.create({
    data: {
      ip: getIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      linkId: link.id
    }
  })

  // 标记已使用（可选）
  if (!link.used) {
    await prisma.link.update({
      where: { id: link.id },
      data: { used: true }
    })
  }

  // 立刻跳转（无提示）
  return res.redirect(302, link.targetUrl)
})

/* ================= 后台页面 ================= */

app.get('/admin', async (req, res) => {
  const links = await prisma.link.findMany({
    include: { visits: true },
    orderBy: { createdAt: 'desc' }
  })

  const rows = links.map(l => `
    <tr>
      <td>${l.token}</td>
      <td>${l.visits.length}</td>
      <td>
        <span class="badge ${l.used ? 'used' : 'new'}">
          ${l.used ? '已使用' : '未使用'}
        </span>
      </td>
      <td>
        <button onclick="copy('${l.token}')">复制</button>
      </td>
    </tr>
  `).join('')

  res.send(`
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>IP Link Tracker</title>
<style>
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont;
  background:#0f1220;
  color:#eee;
  margin:0;
}
.container {
  max-width:900px;
  margin:40px auto;
  background:#161a2e;
  padding:24px;
  border-radius:12px;
}
h1 {
  margin-top:0;
}
button {
  background:#6c7cff;
  border:none;
  padding:6px 12px;
  border-radius:6px;
  color:#fff;
  cursor:pointer;
}
table {
  width:100%;
  border-collapse:collapse;
  margin-top:20px;
}
th,td {
  padding:10px;
  border-bottom:1px solid #222;
  text-align:left;
}
tr:hover {
  background:#1d2140;
}
.badge {
  padding:3px 8px;
  border-radius:10px;
  font-size:12px;
}
.badge.new { background:#1f7a1f }
.badge.used { background:#7a1f1f }
input {
  padding:8px;
  width:60%;
  border-radius:6px;
  border:none;
}
.msg {
  margin-left:10px;
  font-size:13px;
  opacity:.8;
}
</style>
</head>
<body>
<div class="container">
  <h1>IP Link Tracker 后台</h1>

  <div>
    <input id="url" placeholder="目标跳转链接 https://example.com" />
    <button onclick="gen()">生成</button>
    <span class="msg" id="msg"></span>
  </div>

  <table>
    <tr>
      <th>Token</th>
      <th>访问数</th>
      <th>状态</th>
      <th>操作</th>
    </tr>
    ${rows}
  </table>
</div>

<script>
async function gen(){
  const url = document.getElementById('url').value
  if(!url) return
  const r = await fetch('/api/generate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url})
  })
  const d = await r.json()
  await navigator.clipboard.writeText(d.url)
  msg.innerText = '已生成并复制'
  location.reload()
}

async function copy(token){
  const full = location.origin + '/go/' + token
  await navigator.clipboard.writeText(full)
  msg.innerText = '已复制 ' + full
}
</script>
</body>
</html>
`)
})

/* ================= 生成接口 ================= */

app.post('/api/generate', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'no url' })

  const token = genToken()

  await prisma.link.create({
    data: {
      token,
      targetUrl: url
    }
  })

  res.json({
    url: `${req.protocol}://${req.get('host')}/go/${token}`
  })
})

/* ================= 启动 ================= */

app.listen(PORT, () => {
  console.log('Server running on', PORT)
})
