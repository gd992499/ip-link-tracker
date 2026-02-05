// server.js  (Node 22 / ESM / 100% 稳定)

import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import Database from 'better-sqlite3'

const app = express()
const PORT = process.env.PORT || 3000

/* ================= 基础配置 ================= */

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

/* ================= 数据库 ================= */

const db = new Database('data.db')

db.exec(`
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  target TEXT,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT,
  ip TEXT,
  ua TEXT,
  time INTEGER
);

CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY,
  password TEXT
);
`)

// 初始化管理员密码
const defaultPwd = process.env.ADMIN_PASSWORD || 'admin123'
const hash = s => crypto.createHash('sha256').update(s).digest('hex')

const admin = db.prepare('SELECT * FROM admin WHERE id=1').get()
if (!admin) {
  db.prepare('INSERT INTO admin (id,password) VALUES (1,?)')
    .run(hash(defaultPwd))
}

/* ================= 工具 ================= */

const auth = (req, res, next) => {
  if (req.cookies.admin === '1') return next()
  res.redirect('/login')
}

const rand = () => crypto.randomBytes(4).toString('hex')

/* ================= 登录 ================= */

app.get('/login', (req, res) => {
  res.send(`
<!doctype html>
<html>
<head><title>Admin Login</title>
<style>
body{background:#0f172a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}
input,button{padding:10px;border-radius:6px;border:none}
button{background:#6366f1;color:#fff}
</style>
</head>
<body>
<form method="post" action="/login">
  <h2>后台登录</h2>
  <input name="password" type="password" placeholder="密码" required />
  <br/><br/>
  <button>登录</button>
</form>
</body>
</html>
`)
})

app.post('/login', (req, res) => {
  const row = db.prepare('SELECT password FROM admin WHERE id=1').get()
  if (hash(req.body.password) === row.password) {
    res.cookie('admin', '1', { httpOnly: true })
    return res.redirect('/admin')
  }
  res.send('密码错误')
})

/* ================= 后台 ================= */

app.get('/admin', auth, (req, res) => {
  const links = db.prepare('SELECT * FROM links ORDER BY id DESC').all()
  const visits = db.prepare('SELECT * FROM visits ORDER BY id DESC').all()

  const rows = links.map(l => `
<tr>
<td>${l.slug}</td>
<td>${l.target}</td>
<td>
<button onclick="copy('${process.env.BASE_URL || ''}/${PATH}/${l.slug}')">复制</button>
</td>
</tr>`).join('')

  res.send(`
<!doctype html>
<html>
<head>
<title>后台</title>
<style>
body{background:#020617;color:#e5e7eb;font-family:sans-serif;padding:20px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #1e293b}
button{padding:6px 10px;border-radius:6px;border:none;background:#6366f1;color:white}
input{padding:6px}
</style>
</head>
<body>

<h2>生成链接</h2>
<form method="post" action="/admin/create">
<input name="target" placeholder="跳转目标 URL" required size="40"/>
<button>生成</button>
</form>

<h2>链接列表</h2>
<table>
<tr><th>Slug</th><th>目标</th><th>复制</th></tr>
${rows}
</table>

<h2>修改后台密码</h2>
<form method="post" action="/admin/password">
<input name="password" type="password" placeholder="新密码" required/>
<button>修改</button>
</form>

<script>
function copy(t){
  navigator.clipboard.writeText(t)
  alert('已复制')
}
</script>

</body>
</html>
`)
})

app.post('/admin/create', auth, (req, res) => {
  const slug = rand()
  db.prepare(
    'INSERT INTO links (slug,target,createdAt) VALUES (?,?,?)'
  ).run(slug, req.body.target, Date.now())
  res.redirect('/admin')
})

app.post('/admin/password', auth, (req, res) => {
  db.prepare('UPDATE admin SET password=? WHERE id=1')
    .run(hash(req.body.password))
  res.send('密码已修改')
})

/* ================= 跳转（伪装路径） ================= */

// 自定义伪装路径（改这里即可）
const PATH = 'news'   // 例如 /news/xxxx

app.get(`/${PATH}/:slug`, (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE slug=?')
    .get(req.params.slug)

  if (!link) return res.status(404).end()

  db.prepare(
    'INSERT INTO visits (slug,ip,ua,time) VALUES (?,?,?,?)'
  ).run(
    link.slug,
    req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    req.headers['user-agent'] || '',
    Date.now()
  )

  // 0 停留 302
  res.redirect(302, link.target)
})

/* ================= 启动 ================= */

app.listen(PORT, () => {
  console.log('Server running on', PORT)
})
