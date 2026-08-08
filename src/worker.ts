import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { turnstileValid, type TurnstileResult } from './turnstile'
import { youtubeSeconds } from './youtube'
import { sessionHash } from './session'
import { likeAllowed, type LikeTarget } from './likes'

type Bindings = Env & { TURNSTILE_SECRET?: string }
type MomentInput = {
  kind: 'archive' | 'quote' | 'moment'
  member: string
  title: string
  body: string
  sourceUrl: string
  timestampSeconds: number | null
  tags: string[]
  authorName: string
  authorAvatarKey: string
  profileId: number | null
  imageKey: string
  status: 'draft' | 'published'
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    connectSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://cloudflareinsights.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    frameSrc: ['https://challenges.cloudflare.com'],
    imgSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://static.cloudflareinsights.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  },
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
}))
const smallBody = bodyLimit({ maxSize: 16 * 1024 })
const imageBody = bodyLimit({ maxSize: 5 * 1024 * 1024 + 64 * 1024 })
app.use('/api/*', (c, next) => ['/api/admin/images', '/api/profile', '/api/moments'].includes(c.req.path) ? imageBody(c, next) : smallBody(c, next))

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  console.error(JSON.stringify({ message: 'request failed', error: error instanceof Error ? error.message : String(error), path: c.req.path }))
  return c.json({ error: '処理に失敗しました' }, 500)
})

async function asset(c: Context<{ Bindings: Bindings }>) {
  const response = await c.env.ASSETS.fetch(c.req.raw)
  return new Response(response.body, response)
}
app.get('/admin', asset)
app.get('/admin/*', asset)

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
    authorAvatarKey: text(data.authorAvatarKey, 100),
    profileId: null,
    imageKey: text(data.imageKey, 100),
    status: admin && data.status === 'draft' ? 'draft' : 'published',
  }
}

async function verifyTurnstile(c: Context<{ Bindings: Bindings }>, token: string, action = 'submit_moment') {
  if (!c.env.TURNSTILE_SECRET) throw new HTTPException(503, { message: '投稿認証が未設定です' })
  const form = new FormData()
  form.set('secret', c.env.TURNSTILE_SECRET)
  form.set('response', token.slice(0, 2048))
  const ip = c.req.header('CF-Connecting-IP')
  if (ip) form.set('remoteip', ip)
  let result: TurnstileResult
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(5000),
    })
    result = await response.json()
  } catch {
    throw new HTTPException(503, { message: '投稿認証に失敗しました。もう一度お試しください' })
  }
  if (!turnstileValid(result, c.env.TURNSTILE_HOSTNAME, action)) {
    throw new HTTPException(403, { message: '投稿認証に失敗しました。もう一度お試しください' })
  }
}

const columns = 'id, kind, member, title, body, source_url, timestamp_seconds, tags, author_name, author_avatar_key, profile_id, image_key, likes_count, status, created_at, updated_at'

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
    authorAvatarKey: row.author_avatar_key,
    profileId: row.profile_id,
    imageKey: row.image_key,
    likesCount: row.likes_count,
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
  const result = await db.prepare(`INSERT INTO moments (kind, member, title, body, source_url, timestamp_seconds, tags, author_name, author_avatar_key, profile_id, image_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(data.kind, data.member, data.title, data.body, data.sourceUrl, data.timestampSeconds, JSON.stringify(data.tags), data.authorName, data.authorAvatarKey, data.profileId, data.imageKey, data.status).run()
  return find(db, Number(result.meta.last_row_id))
}

async function storeImage(bucket: R2Bucket, file: File) {
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
  await bucket.put(key, data, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })
  return key
}

const sessionCookie = 'momoshimin_session'

async function profile(c: Context<{ Bindings: Bindings }>) {
  const token = getCookie(c, sessionCookie)
  if (!token) return null
  const row = await c.env.DB.prepare('SELECT id, display_name, avatar_key FROM profiles WHERE session_hash = ?')
    .bind(await sessionHash(token)).first<{ id: number, display_name: string, avatar_key: string }>()
  return row ? { id: row.id, displayName: row.display_name, avatarKey: row.avatar_key } : null
}

app.get('/api/profile', async (c) => c.json({ profile: await profile(c) }))

app.post('/api/profile', async (c) => {
  const form = await c.req.formData()
  await verifyTurnstile(c, text(form.get('turnstileToken'), 2048), 'register_profile')
  const displayName = text(form.get('displayName'), 50)
  const avatar = form.get('avatar')
  if (!displayName) throw new HTTPException(400, { message: '表示名を入力してください' })
  if (!(avatar instanceof File) || !avatar.size) throw new HTTPException(400, { message: 'アイコン画像を選択してください' })
  const avatarKey = await storeImage(c.env.IMAGES, avatar)
  const token = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO profiles (display_name, avatar_key, session_hash) VALUES (?, ?, ?)')
    .bind(displayName, avatarKey, await sessionHash(token)).run()
  setCookie(c, sessionCookie, token, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: 60 * 60 * 24 * 365 })
  return c.json({ profile: { displayName, avatarKey } }, 201)
})

app.post('/api/admin/images', async (c) => {
  const file = (await c.req.formData()).get('image')
  if (!(file instanceof File)) throw new HTTPException(400, { message: '画像を選択してください' })
  const imageKey = await storeImage(c.env.IMAGES, file)
  return c.json({ imageKey, imageUrl: `/media/${imageKey}` }, 201)
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

app.post('/api/moments', async (c) => {
  const form = await c.req.formData()
  await verifyTurnstile(c, text(form.get('turnstileToken'), 2048))
  const memberProfile = await profile(c)
  if (!memberProfile) throw new HTTPException(401, { message: '先に参加登録してください' })
  const payload = text(form.get('payload'), 16 * 1024)
  const data = await input(new Request('https://internal', { method: 'POST', body: payload }), false)
  data.authorName = memberProfile.displayName
  data.authorAvatarKey = memberProfile.avatarKey
  data.profileId = memberProfile.id
  const file = form.get('image')
  if (file instanceof File && file.size) data.imageKey = await storeImage(c.env.IMAGES, file)
  return c.json(await insert(c.env.DB, data), 201)
})

app.post('/api/moments/:id/likes', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'IDが不正です' })
  const memberProfile = await profile(c)
  if (!memberProfile) throw new HTTPException(401, { message: '参加登録するといいねできます' })
  const target = await c.env.DB.prepare(`SELECT kind, status,
    EXISTS(SELECT 1 FROM moments authored WHERE authored.profile_id = ? AND authored.status = 'published') AS eligible
    FROM moments WHERE id = ?`).bind(memberProfile.id, id).first<LikeTarget>()
  if (!target || target.status !== 'published') throw new HTTPException(404, { message: '投稿が見つかりません' })
  if (!likeAllowed(target)) throw new HTTPException(403, { message: '思い出を1件投稿するといいねできます' })
  await c.env.DB.prepare('UPDATE moments SET likes_count = likes_count + 1 WHERE id = ?').bind(id).run()
  const row = await c.env.DB.prepare('SELECT likes_count FROM moments WHERE id = ?').bind(id).first<{ likes_count: number }>()
  return c.json({ likesCount: row?.likes_count ?? 0 })
})

app.get('/api/admin/moments', async (c) => {
  const result = await c.env.DB.prepare(`SELECT ${columns} FROM moments ORDER BY created_at DESC LIMIT 500`).all()
  return c.json(result.results.map(moment))
})

app.post('/api/admin/moments', async (c) => c.json(await insert(c.env.DB, await input(c.req.raw, true)), 201))

app.put('/api/admin/moments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'IDが不正です' })
  const data = await input(c.req.raw, true)
  const result = await c.env.DB.prepare(`UPDATE moments SET kind = ?, member = ?, title = ?, body = ?, source_url = ?, timestamp_seconds = ?, tags = ?, author_name = ?, author_avatar_key = ?, image_key = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(data.kind, data.member, data.title, data.body, data.sourceUrl, data.timestampSeconds, JSON.stringify(data.tags), data.authorName, data.authorAvatarKey, data.imageKey, data.status, id).run()
  if (!result.meta.changes) throw new HTTPException(404, { message: '思い出が見つかりません' })
  return c.json(await find(c.env.DB, id))
})

app.delete('/api/admin/moments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'IDが不正です' })
  const result = await c.env.DB.prepare('DELETE FROM moments WHERE id = ?').bind(id).run()
  return result.meta.changes ? c.body(null, 204) : c.json({ error: '思い出が見つかりません' }, 404)
})

app.all('*', asset)

export default app
