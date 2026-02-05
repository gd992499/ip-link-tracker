// server.js  (Node 22 / ESM / Railway 稳定)

import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import Database from 'better-sqlite3'

/* ================= 基础 ================= */

const app = express()
const PORT = process.env.PORT || 3000
const PATH = 'news' // 伪装路径
const BASE_URL = process.env.BASE_URL || ''

app.set('trust proxy', true)

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

/* ================= 管理员初始化 ================= */

const hash = s => crypto.createHash('sha256').update(s).digest('hex')
const defaultPwd = process.env.ADMIN_PASSWORD || 'admin123'

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
<body style="background:#020617;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh">
<form method="post">
<h2>后台登录</h2>
<input name="password" type="password" required />
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

  const rows = links.map(l => `
<tr>
<td>${l.slug}</td>
<td>${l.target}</td>
<td>
<button onclick="copy('${BASE_URL}/${PATH}/${l.slug}')">复制</button>
</td>
</tr>`).join('')

  res.send(`
<!doctype html>
<html>
<body style="background:#020617;color:#e5e7eb;padding:20px">
<h2>生成链接</h2>
<form method="post" action="/admin/create">
<input name="target" required size="40"/>
<button>生成</button>
</form>

<h2>链接</h2>
<table>${rows}</table>

<h2>修改密码</h2>
<form method="post" action="/admin/password">
<input name="password" type="password" required/>
<button>修改</button>
</form>

<script>
function copy(t){navigator.clipboard.writeText(t);alert('已复制')}
</script>
</body>
</html>
`)
})

app.post('/admin/create', auth, (req, res) => {
  db.prepare(
    'INSERT INTO links (slug,target,createdAt) VALUES (?,?,?)'
  ).run(rand(), req.body.target, Date.now())
  res.redirect('/admin')
})

app.post('/admin/password', auth, (req, res) => {
  db.prepare('UPDATE admin SET password=? WHERE id=1')
    .run(hash(req.body.password))
  res.send('密码已修改')
})

/* ================= 跳转 ================= */

app.get(`/${PATH}/:slug`, (req, res) => {
  const link = db.prepare('SELECT * FROM links WHERE slug=?')
    .get(req.params.slug)

  if (!link) return res.sendStatus(404)

  const ip = (req.headers['x-forwarded-for'] || req.ip || '')
    .toString().split(',')[0]

  db.prepare(
    'INSERT INTO visits (slug,ip,ua,time) VALUES (?,?,?,?)'
  ).run(link.slug, ip, req.headers['user-agent'] || '', Date.now())

  res.redirect(302, link.target)
})

app.listen(PORT, () => {
  console.log('Server running on', PORT)
})
