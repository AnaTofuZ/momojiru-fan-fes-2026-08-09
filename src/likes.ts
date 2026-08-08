export type LikeTarget = { kind: string, status: string, eligible: number }

export function likeAllowed(target: LikeTarget | null) {
  return target?.kind === 'moment' && target.status === 'published' && Boolean(target.eligible)
}

export function starBoost(likes: number) {
  return Math.min(Math.max(likes, 0), 20)
}
