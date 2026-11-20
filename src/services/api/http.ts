import { translate, type TranslationMessage } from '../../i18n/index.js'
import { getChannelSnapshot, type Channel } from '../channels.js'
import { storageOwner, useAccount } from '../backend/state.js'

export type ApiErrorKind = 'http' | 'stream' | 'network' | 'interrupted' | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage
  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

export const redactApiKey = (message: string, apiKey?: string) =>
  apiKey ? message.replaceAll(apiKey, '[redacted]') : message

export const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const raw = await response.text().catch(() => '')
  let message = raw || fallback
  try {
    const body = JSON.parse(raw) as {
      error?: { message?: unknown } | string
      message?: unknown
      msg?: unknown
    }
    if (typeof body.error === 'string') {
      message = body.error
    } else if (typeof body.error?.message === 'string') {
      message = body.error.message
    } else if (typeof body.message === 'string') {
      message = body.message
    } else if (typeof body.msg === 'string') {
      message = body.msg
    }
  } catch {
    // Display plain-text gateway errors as returned by the service.
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (
  url: string,
  init: RequestInit,
  channel: Channel = getChannelSnapshot()
): Promise<Response> => {
  let target = url
  let options = init
  if (channel.managed) {
    if (channel.ownerId !== storageOwner()) {
      throw new ApiError('http', '登录账号已变化，请刷新页面', 409)
    }
    const full = new URL(url)
    const base = new URL(channel.baseUrl)
    if (
      full.origin !== base.origin ||
      !full.pathname.startsWith(base.pathname.replace(/\/$/, ''))
    ) {
      throw new ApiError('protocol', '模型请求地址与当前渠道不匹配')
    }
    const path = full.pathname.slice(base.pathname.replace(/\/$/, '').length).replace(/^\//, '')
    target = `/api/chat/proxy/${encodeURIComponent(channel.id)}?path=${encodeURIComponent(path)}`
    const headers = new Headers(init.headers)
    headers.delete('Authorization')
    headers.delete('x-api-key')
    headers.set('X-Chat-Owner', String(channel.ownerId))
    options = { ...init, headers, credentials: 'same-origin' }
  }
  let response: Response
  try {
    response = await fetch(target, options)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (channel.managed && channel.ownerId !== storageOwner()) {
    void response.body?.cancel()
    throw new ApiError('http', '登录账号已变化，请刷新页面', 409)
  }
  if (channel.managed && response.headers.has('X-Chat-Authentication')) {
    useAccount.setState({ user: null, dialog: 'login' })
  }
  if (!response.ok) {
    const error = await readErrorResponse(response)
    const headers = new Headers(init.headers)
    const credential =
      headers.get('x-api-key') ?? headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    throw new ApiError(error.kind, redactApiKey(error.message, credential), error.status)
  }
  return response
}
