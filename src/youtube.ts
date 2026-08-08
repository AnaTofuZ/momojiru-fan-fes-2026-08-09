export function youtubeSeconds(value: string): number | null {
  try {
    const url = new URL(value)
    const raw = url.searchParams.get('t') ?? url.searchParams.get('start')
    if (!raw) return null
    if (/^\d+$/.test(raw)) return Number(raw)
    const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : null
  } catch {
    return null
  }
}

export function clock(seconds: number | null): string {
  if (seconds === null) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
