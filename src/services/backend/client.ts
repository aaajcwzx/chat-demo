import { storageOwner, useAccount } from './state.js'

export class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

export const backendRequest = async <T>(
  path: string,
  init: RequestInit = {},
  owner?: number | null
): Promise<T> => {
  if (owner !== undefined && owner !== storageOwner()) {
    throw new BackendError(409, '登录账号已变化，请重新打开页面')
  }
  const headers = new Headers(init.headers)
  if (owner !== undefined && owner !== null) {
    headers.set('X-Chat-Owner', String(owner))
  }
  let response: Response
  try {
    response = await fetch(`/api/chat${path}`, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new BackendError(0, '无法连接服务器，请检查网络')
  }
  const body: { code?: number; data?: T; msg?: string } = await response.json().catch(() => ({}))
  if (owner !== undefined && owner !== storageOwner()) {
    throw new BackendError(409, '登录账号已变化，请重新打开页面')
  }
  if (!response.ok || body.code !== 0) {
    if (response.headers.has('X-Chat-Authentication') && owner === storageOwner()) {
      useAccount.setState({ user: null, dialog: 'login' })
    }
    throw new BackendError(response.status, body.msg || '服务器请求失败')
  }
  return body.data as T
}
export const jsonRequest = (method: string, data: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
  signal,
})
