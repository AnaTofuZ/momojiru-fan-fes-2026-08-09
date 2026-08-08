export type TurnstileResult = { success?: boolean, hostname?: string, action?: string }

export function turnstileValid(result: TurnstileResult, hostname: string) {
  return result.success === true && result.action === 'submit_moment' && result.hostname === hostname
}
