export type TurnstileResult = { success?: boolean, hostname?: string, action?: string }

export function turnstileValid(result: TurnstileResult, hostname: string, action = 'submit_moment') {
  return result.success === true && result.action === action && result.hostname === hostname
}
