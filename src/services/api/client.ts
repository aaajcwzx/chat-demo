import { getActiveChannel, getChannelSnapshot, type Channel } from '../channels.js'
import { ApiError, readErrorResponse, request } from './http.js'
import { streamOpenAI } from './openai.js'
import { backendRequest, jsonRequest } from '../backend/client.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

export { ApiError, request }
export type { ApiErrorKind } from './http.js'
export const API_ORIGIN = __API_ORIGIN__
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
const FILES_BETA = 'files-api-2025-04-14'

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

export const requireDeepseekChannel = (channel: Channel = getChannelSnapshot()) => {
  if (channel.protocol !== 'deepseek') {
    throw new ApiError('protocol', { key: 'channelFeatureUnavailable' })
  }
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const channel = getChannelSnapshot()
  if (channel.managed) {
    await backendRequest(
      '/channels/models',
      jsonRequest('POST', { ...channel, apiKey }, signal),
      channel.ownerId
    )
    return
  }
  await request(`${getActiveChannel().baseUrl}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal,
  channel: Channel = getChannelSnapshot()
): Promise<FileObject> => {
  requireDeepseekChannel(channel)
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(
    `${ANTHROPIC_BASE_URL}/files`,
    {
      method: 'POST',
      headers: anthropicHeaders(apiKey, true),
      body: form,
      signal,
    },
    channel
  )
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  requireDeepseekChannel()
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  channel: Channel = getChannelSnapshot()
): AsyncGenerator<MessageStreamEvent> {
  if (channel.protocol === 'openai') {
    yield* streamOpenAI({ ...channel, apiKey }, body, signal)
    return
  }
  const response = await request(
    `${ANTHROPIC_BASE_URL}/messages`,
    {
      method: 'POST',
      headers: {
        ...anthropicHeaders(apiKey, hasFile(body)),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    },
    channel
  )
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
