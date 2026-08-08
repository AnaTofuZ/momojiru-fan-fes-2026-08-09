import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
import { clock, youtubeSeconds } from './youtube'

type Moment = {
  id: number
  kind: 'archive' | 'quote' | 'moment'
  member: string
  title: string
  body: string
  sourceUrl: string
  timestampSeconds: number | null
  tags: string[]
  authorName: string
  authorAvatarKey: string
  imageKey: string
  status: 'draft' | 'published'
  createdAt: string
}

type FormValue = Omit<Moment, 'id' | 'createdAt'>
type Profile = { displayName: string, avatarKey: string }
const empty: FormValue = { kind: 'moment', member: 'ほうとう組。', title: '', body: '', sourceUrl: '', timestampSeconds: null, tags: [], authorName: '', authorAvatarKey: '', imageKey: '', status: 'published' }
const members = ['ほうとう組。', 'ボス', '司令官', '宝灯桃汁']
const turnstileSitekey = '0x4AAAAAAEKTlDueM9B_l4qU'

declare global {
  interface Window { turnstile?: { render: (element: HTMLElement, options: Record<string, string>) => string, reset: () => void } }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const data: unknown = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : '通信に失敗しました')
  return data as T
}

function Header() {
  return <header>
    <Link className="brand" to="/"><span>🌙</span><span>ほうとう組。<small>思い出広場</small></span></Link>
    <nav aria-label="メインメニュー">
      <NavLink to="/">見る</NavLink>
      <NavLink to="/map">星図</NavLink>
      <NavLink to="/submit">投稿</NavLink>
    </nav>
  </header>
}

function MomentCard({ item, admin, onEdit, onDelete }: { item: Moment, admin?: boolean, onEdit?: () => void, onDelete?: () => void }) {
  return <article className="moment-card">
    <div className="card-top"><span className="member">{item.member}</span>{admin && <span className={`status ${item.status}`}>{item.status === 'draft' ? '下書き' : '公開'}</span>}</div>
    <h3>{item.title || (item.kind === 'quote' ? '名言・迷言' : '好きな瞬間')}</h3>
    {item.imageKey && <img className="moment-image" src={`/media/${item.imageKey}`} alt={item.title || `${item.member}の思い出`} loading="lazy" />}
    {item.body && <p>{item.body}</p>}
    {!!item.tags.length && <div className="tags">{item.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
    {item.sourceUrl && <a className="watch" href={item.sourceUrl} target="_blank" rel="noreferrer">↗ 元の投稿・場面を見る{item.timestampSeconds !== null && `（${clock(item.timestampSeconds)}）`}</a>}
    {item.authorName && <div className="author">{item.authorAvatarKey && <img src={`/media/${item.authorAvatarKey}`} alt="" loading="lazy" />}<small>投稿: {item.authorName}</small></div>}
    {admin && <div className="card-actions"><button className="secondary" onClick={onEdit}>編集</button><button className="danger" onClick={onDelete}>削除</button></div>}
  </article>
}

function Turnstile({ action }: { action: string }) {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    const render = () => {
      if (window.turnstile && element.current) {
        if (!element.current.childElementCount) window.turnstile.render(element.current, { sitekey: turnstileSitekey, action, language: 'ja' })
        return
      }
      timer = window.setTimeout(render, 100)
    }
    render()
    return () => window.clearTimeout(timer)
  }, [action])
  return <div ref={element} />
}

function Home() {
  const [moments, setMoments] = useState<Moment[]>([])
  const [drawn, setDrawn] = useState<Moment | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { request<Moment[]>('/api/moments').then(setMoments).catch(e => setError(e.message)) }, [])
  async function draw() {
    setError('')
    try { setDrawn(await request<Moment>('/api/moments/random')) } catch (e) { setError((e as Error).message) }
  }
  return <>
    <section className="hero">
      <p className="eyebrow">2026.08 もも市民再会の日</p>
      <h1>あの日の「好き」を、<br />もう一度。</h1>
      <p>ボス、司令官、宝灯桃汁。<br />ほうとう組。の思い出をみんなで持ち寄る広場です。</p>
      <button className="gacha" onClick={draw}>🌙 ほうとう組。ガチャを引く</button>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {drawn && <section className="drawn"><p>＼ 今日の一枚 ／</p><MomentCard item={drawn} /><button className="secondary" onClick={draw}>もう一回</button></section>}
    <section className="section-head"><div><p className="eyebrow">MEMORIES</p><h2>みんなの好きな瞬間</h2></div><Link className="text-link" to="/submit">＋ 投稿する</Link></section>
    <div className="grid">{moments.map(item => <MomentCard key={item.id} item={item} />)}</div>
    {!moments.length && !error && <p className="empty">最初の思い出を投稿してみよう。</p>}
  </>
}

function MomentForm({ admin = false, initial = empty, onSaved }: { admin?: boolean, initial?: FormValue, onSaved?: () => void }) {
  const [value, setValue] = useState(initial)
  const [tags, setTags] = useState(initial.tags.join(', '))
  const [image, setImage] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue(initial); setTags(initial.tags.join(', ')); setImage(null) }, [initial])
  function set<K extends keyof FormValue>(key: K, next: FormValue[K]) { setValue(current => ({ ...current, [key]: next })) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const data = { ...value, timestampSeconds: youtubeSeconds(value.sourceUrl), tags: tags.split(',').map(t => t.trim()).filter(Boolean) }
      const id = (initial as FormValue & { id?: number }).id
      if (admin) {
        if (image) {
          const form = new FormData()
          form.append('image', image)
          data.imageKey = (await request<{ imageKey: string }>('/api/admin/images', { method: 'POST', body: form })).imageKey
        }
        await request(`/api/admin/moments${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        })
      } else {
        const form = new FormData()
        form.append('payload', JSON.stringify(data))
        form.append('turnstileToken', String(new FormData(event.currentTarget).get('cf-turnstile-response') || ''))
        if (image) form.append('image', image)
        await request('/api/moments', { method: 'POST', body: form })
      }
      setMessage(admin ? '保存しました' : '投稿しました。ありがとう！')
      if (!id) { setValue(empty); setTags('') }
      onSaved?.()
    } catch (e) {
      if (!admin) window.turnstile?.reset()
      setMessage((e as Error).message)
    } finally { setSaving(false) }
  }
  const seconds = youtubeSeconds(value.sourceUrl)
  return <form className="moment-form" onSubmit={submit}>
    <label>誰の思い出？<select value={value.member} onChange={e => set('member', e.target.value)}>{members.map(member => <option key={member}>{member}</option>)}</select></label>
    <label>種類<select value={value.kind} onChange={e => set('kind', e.target.value as FormValue['kind'])}><option value="moment">好きな瞬間</option><option value="archive">おすすめアーカイブ</option><option value="quote">名言・迷言</option></select></label>
    <label>参照URL {value.kind === 'archive' && <span className="required">必須</span>}<input type="url" inputMode="url" required={value.kind === 'archive'} placeholder={value.kind === 'archive' ? 'https://youtu.be/...?t=123' : 'オフイベントの思い出などは空欄でOK'} value={value.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} /></label>
    {seconds !== null && <p className="detected">✓ タイムスタンプ {clock(seconds)} を検出</p>}
    <label>タイトル<input maxLength={120} placeholder="例: 3人で笑いが止まらなくなる場面" value={value.title} onChange={e => set('title', e.target.value)} /></label>
    <label>ひとこと<textarea maxLength={1000} rows={4} placeholder="この瞬間の好きなところ" value={value.body} onChange={e => set('body', e.target.value)} /></label>
    <label>画像（任意・5MBまで）<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => setImage(e.target.files?.[0] ?? null)} /></label>
    <label>タグ<input maxLength={200} placeholder="雑談, 山梨, 迷言" value={tags} onChange={e => setTags(e.target.value)} /></label>
    {admin && <label>投稿者名（任意）<input maxLength={50} value={value.authorName} onChange={e => set('authorName', e.target.value)} /></label>}
    {admin && <label>状態<select value={value.status} onChange={e => set('status', e.target.value as FormValue['status'])}><option value="draft">下書き</option><option value="published">公開</option></select></label>}
    {!admin && <Turnstile action="submit_moment" />}
    <button disabled={saving}>{saving ? '保存中…' : admin && value.status === 'draft' ? '下書き保存' : '登録する 🌙'}</button>
    {message && <p className={message.includes('ました') || message.includes('ありがとう') ? 'success' : 'error'} role="status">{message}</p>}
  </form>
}

function Registration({ onRegistered }: { onRegistered: (profile: Profile) => void }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      const form = new FormData(event.currentTarget)
      form.set('turnstileToken', String(form.get('cf-turnstile-response') || ''))
      const result = await request<{ profile: Profile }>('/api/profile', { method: 'POST', body: form })
      onRegistered(result.profile)
    } catch (e) {
      window.turnstile?.reset()
      setMessage((e as Error).message)
    } finally { setSaving(false) }
  }
  return <form className="moment-form profile-form" onSubmit={submit}>
    <h2>最初に参加登録</h2>
    <p>自分のインターネット名と、アイコンまたは自分だとわかる画像で登録してください。この端末では次回から入力不要です。</p>
    <label>表示名 <span className="required">必須</span><input name="displayName" required maxLength={50} autoComplete="nickname" /></label>
    <label>アイコン画像 <span className="required">必須・5MBまで</span><input name="avatar" type="file" required accept="image/jpeg,image/png,image/webp,image/gif" /></label>
    <Turnstile action="register_profile" />
    <button disabled={saving}>{saving ? '登録中…' : '参加登録する 🌙'}</button>
    {message && <p className="error" role="alert">{message}</p>}
  </form>
}

function Submit() {
  const [profile, setProfile] = useState<Profile | null | undefined>()
  const [error, setError] = useState('')
  useEffect(() => { request<{ profile: Profile | null }>('/api/profile').then(result => setProfile(result.profile)).catch(e => setError(e.message)) }, [])
  return <section className="page"><p className="eyebrow">SHARE A MEMORY</p><h1>思い出を投稿する</h1><p>YouTubeの時間入りURLなら再生位置も自動で残ります。<br />好きな瞬間や名言・迷言はリンクなしでも投稿できます。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {profile === null && <Registration onRegistered={setProfile} />}
    {profile && <><div className="profile"><img src={`/media/${profile.avatarKey}`} alt="" /><span><small>投稿者</small>{profile.displayName}</span></div><MomentForm /></>}
  </section>
}

function point(item: Moment, index: number) {
  return { x: 10 + ((item.id * 47 + index * 13) % 80), y: 12 + ((item.id * 71 + index * 17) % 76) }
}

function MemoryMap() {
  const [moments, setMoments] = useState<Moment[]>([])
  const [selected, setSelected] = useState<Moment | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { request<Moment[]>('/api/moments').then(items => setMoments(items.slice(0, 60))).catch(e => setError(e.message)) }, [])
  const nodes = moments.map((item, index) => ({ item, ...point(item, index) }))
  return <section className="map-page">
    <p className="eyebrow">MEMORY CONSTELLATION</p>
    <h1>みんなの思い出星図</h1>
    <p>漂う思い出をタップすると、その日の記憶が開きます。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="memory-sky" aria-label="投稿同士を結んだ思い出の星図">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {nodes.slice(1).map((node, index) => <line key={node.item.id} x1={nodes[index].x} y1={nodes[index].y} x2={node.x} y2={node.y} />)}
      </svg>
      {nodes.map((node, index) => <button
        className={`memory-node member-${members.indexOf(node.item.member)}`}
        key={node.item.id}
        style={{ left: `${node.x}%`, top: `${node.y}%`, animationDelay: `${-(index % 8)}s` }}
        onClick={() => setSelected(node.item)}
        aria-label={`${node.item.member}: ${node.item.title || node.item.body || '思い出'}`}
      ><small>{node.item.member}</small><span>{node.item.title || node.item.body || '思い出'}</span></button>)}
      {!nodes.length && !error && <p className="sky-empty">投稿が集まると、ここに思い出の星が浮かびます。</p>}
    </div>
    {selected && <div className="selected-memory"><MomentCard item={selected} /></div>}
  </section>
}

function Admin() {
  const [moments, setMoments] = useState<Moment[]>([])
  const [editing, setEditing] = useState<Moment | null>(null)
  const [error, setError] = useState('')
  async function load() {
    setError('')
    try { setMoments(await request('/api/admin/moments')) } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load() }, [])
  async function remove(item: Moment) {
    if (!confirm(`「${item.title || 'この思い出'}」を削除しますか？`)) return
    try { await request(`/api/admin/moments/${item.id}`, { method: 'DELETE' }); await load() } catch (e) { setError((e as Error).message) }
  }
  const initial = editing ? { ...editing } : { ...empty, status: 'draft' as const }
  return <section className="page admin-page">
    <p className="eyebrow">QUICK ENTRY</p><h1>管理・クイック登録</h1>
    {error && <p className="error" role="alert">{error}</p>}
    <h2>{editing ? '思い出を編集' : 'URLだけでも下書き保存'}</h2>
    <MomentForm admin initial={initial} onSaved={() => { setEditing(null); void load() }} />
    {editing && <button className="secondary cancel" onClick={() => setEditing(null)}>編集をやめる</button>}
    <div className="section-head"><h2>登録済み（{moments.length}件）</h2></div>
    <div className="grid">{moments.map(item => <MomentCard key={item.id} item={item} admin onEdit={() => { setEditing(item); scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={() => void remove(item)} />)}</div>
  </section>
}

export default function App() {
  return <><Header /><main><Routes><Route path="/" element={<Home />} /><Route path="/map" element={<MemoryMap />} /><Route path="/submit" element={<Submit />} /><Route path="/admin" element={<Admin />} /><Route path="*" element={<Home />} /></Routes></main><footer>ほうとう組。は不滅です 🌙</footer></>
}
