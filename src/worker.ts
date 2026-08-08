import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { basicAuth } from 'hono/basic-auth'
import { HTTPException } from 'hono/http-exception'
import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { youtubeSeconds } from './youtube'

type Bindings = Env & { ADMIN_USER?: string, ADMIN_PASSWORD?: string }
type MomentInput = {
  kind: 'archive' | 'quote' | 'moment'
  member: string
  title: string
  body: string
  sourceUrl: string
  timestampSeconds: number | null
  tags: string[]
  authorName: string
  imageKey: string
  status: 'draft' | 'published'
}

const app = new Hono<{ Bindings: Bindings }>()
const smallBody = bodyLimit({ maxSize: 16 * 1024 })
const imageBody = bodyLimit({ maxSize: 5 * 1024 * 1024 + 64 * 1024 })
app.use('/api/*', (c, next) => c.req.path === '/api/images' ? imageBody(c, next) : smallBody(c, next))

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error(JSON.stringify({ message: 'request failed', error: error instanceof Error ? error.message : String(error), path: c.req.path }))
  return c.json({ error: '処理に失敗しました' }, 500)
})

async function secureEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

const requireAdmin: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASSWORD) throw new HTTPException(503, { message: '管理者認証が未設定です' })
  return basicAuth({
    realm: 'ほうとう組。思い出広場 管理',
    verifyUser: async (username, password) => (await secureEqual(username, c.env.ADMIN_USER!)) && (await secureEqual(password, c.env.ADMIN_PASSWORD!)),
  })(c, next)
}

app.use('/admin', requireAdmin)
app.use('/admin/*', requireAdmin)
app.use('/api/admin/*', requireAdmin)
app.get('/admin', (c) => c.env.ASSETS.fetch(c.req.raw))
app.get('/admin/*', (c) => c.env.ASSETS.fetch(c.req.raw))

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function input(request: Request, admin: boolean): Promise<MomentInput> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HTTPException(400, { message: 'JSONを読み取れません' })
  }
  if (!value || typeof value !== 'object') throw new HTTPException(400, { message: '入力内容が不正です' })
  const data = value as Record<string, unknown>
  const kinds = ['archive', 'quote', 'moment'] as const
  const kind = kinds.includes(data.kind as typeof kinds[number]) ? data.kind as MomentInput['kind'] : 'moment'
  const sourceUrl = text(data.sourceUrl, 2000)
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      throw new HTTPException(400, { message: 'http(s)の参照URLを入力してください' })
    }
  }
  if (!sourceUrl && kind === 'archive') throw new HTTPException(400, { message: 'おすすめアーカイブのURLを入力してください' })
  const tags = Array.isArray(data.tags) ? data.tags.map((tag) => text(tag, 30)).filter(Boolean).slice(0, 10) : []
  const suppliedSeconds = typeof data.timestampSeconds === 'number' && Number.isInteger(data.timestampSeconds) && data.timestampSeconds >= 0
    ? data.timestampSeconds
    : null
  return {
    kind,
    member: text(data.member, 30) || 'ほうとう組。',
    title: text(data.title, 120),
    body: text(data.body, 1000),
    sourceUrl,
    timestampSeconds: suppliedSeconds ?? youtubeSeconds(sourceUrl),
    tags,
    authorName: text(data.authorName, 50),
    imageKey: text(data.imageKey, 100),
    status: admin && data.status === 'draft' ? 'draft' : 'published',
  }
}

const columns = 'id, kind, member, title, body, source_url, timestamp_seconds, tags, author_name, image_key, status, created_at, updated_at'

function moment(row: Record<string, unknown>) {
  let tags: string[] = []
  try { tags = JSON.parse(String(row.tags)) } catch { /* old data remains displayable */ }
  return {
    id: row.id,
    kind: row.kind,
    member: row.member,
    title: row.title,
    body: row.body,
    sourceUrl: row.source_url,
    timestampSeconds: row.timestamp_seconds,
    tags,
    authorName: row.author_name,
    imageKey: row.image_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function find(db: D1Database, id: number) {
  const row = await db.prepare(`SELECT ${columns} FROM moments WHERE id = ?`).bind(id).first()
  return row ? moment(row) : null
}

async function insert(db: D1Database, data: MomentInput) {
  const result = await db.prepare(`INSERT INTO moments (kind, member, title, body, source_url, timestamp_seconds, tags, author_name, image_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(data.kind, data.member, data.title, data.body, data.sourceUrl, data.timestampSeconds, JSON.stringify(data.tags), data.authorName, data.imageKey, data.status).run()
  return find(db, Number(result.meta.last_row_id))
}

app.post('/api/images', async (c) => {
  const form = await c.req.formData()
  const file = form.get('image')
  if (!(file instanceof File)) throw new HTTPException(400, { message: '画像を選択してください' })
  if (file.size > 5 * 1024 * 1024) throw new HTTPException(413, { message: '画像は5MB以下にしてください' })
  const data = await file.arrayBuffer()
  const bytes = new Uint8Array(data)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? ['image/jpeg', 'jpg']
    : bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]) ? ['image/png', 'png']
    : ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ? ['image/gif', 'gif']
    : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? ['image/webp', 'webp']
    : null
  if (!type) throw new HTTPException(400, { message: 'JPEG、PNG、WebP、GIFのみ投稿できます' })
  const [contentType, extension] = type
  const key = `${crypto.randomUUID()}.${extension}`
  await c.env.IMAGES.put(key, data, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })
  return c.json({ imageKey: key, imageUrl: `/media/${key}` }, 201)
})

app.get('/media/:key', async (c) => {
  const key = c.req.param('key')
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/.test(key)) return c.notFound()
  const object = await c.env.IMAGES.get(key)
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(object.body, { headers })
})

app.get('/api/moments', async (c) => {
  const result = await c.env.DB.prepare(`SELECT ${columns} FROM moments WHERE status = 'published' ORDER BY created_at DESC LIMIT 200`).all()
  return c.json(result.results.map(moment))
})

app.get('/api/moments/random', async (c) => {
  // ponytail: ORDER BY RANDOM() is fine for an event-sized DB; add a random key if this reaches thousands of rows.
  const row = await c.env.DB.prepare(`SELECT ${columns} FROM moments WHERE status = 'published' ORDER BY RANDOM() LIMIT 1`).first()
  return row ? c.json(moment(row)) : c.json({ error: 'まだ思い出がありません' }, 404)
})

app.post('/api/moments', async (c) => c.json(await insert(c.env.DB, await input(c.req.raw, false)), 201))

app.get('/api/admin/moments', async (c) => {
  const result = await c.env.DB.prepare(`SELECT ${columns} FROM moments ORDER BY created_at DESC LIMIT 500`).all()
  return c.json(result.results.map(moment))
})

app.post('/api/admin/moments', async (c) => c.json(await insert(c.env.DB, await input(c.req.raw, true)), 201))

app.put('/api/admin/moments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'IDが不正です' })
  const data = await input(c.req.raw, true)
  const result = await c.env.DB.prepare(`UPDATE moments SET kind = ?, member = ?, title = ?, body = ?, source_url = ?, timestamp_seconds = ?, tags = ?, author_name = ?, image_key = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(data.kind, data.member, data.title, data.body, data.sourceUrl, data.timestampSeconds, JSON.stringify(data.tags), data.authorName, data.imageKey, data.status, id).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: '思い出が見つかりません' })
  return c.json(await find(c.env.DB, id))
})

app.delete('/api/admin/moments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'IDが不正です' })
  const result = await c.env.DB.prepare('DELETE FROM moments WHERE id = ?').bind(id).run()
  return result.meta.changes ? c.body(null, 204) : c.json({ error: '思い出が見つかりません' }, 404)
})

export default app
