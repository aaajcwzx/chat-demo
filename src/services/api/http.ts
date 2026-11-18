import { translate, type TranslationMessage } from '../../i18n/index.js'

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
    const body = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown }
    if (typeof body.error === 'string') {
      message = body.error
    } else if (typeof body.error?.message === 'string') {
      message = body.error.message
    } else if (typeof body.message === 'string') {
      message = body.message
    }
  } catch {
    // Display plain-text gateway errors as returned by the service.
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
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
