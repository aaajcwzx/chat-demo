import type { Channel } from '../channels.js'
import { createId } from '../../utils/id.js'
import { ApiError, readErrorResponse, redactApiKey, request } from './http.js'
import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageStreamEvent, MessageUsage, StopReason } from './types.js'

const toMessages = (body: CreateMessageRequest) => {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: body.system },
  ]
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
    if (content.trim()) {
      messages.push({ role: message.role, content })
    }
  }
  return messages
}

type Chunk = {
  id?: string
  model?: string
  error?: { message?: string }
  choices?: {
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      refusal?: string | null
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

const tokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/** Convert Chat Completions streams to the existing message/block event format. */
export async function* streamOpenAI(
  channel: Channel,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${channel.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(channel.apiKey ? { Authorization: `Bearer ${channel.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: body.model, messages: toMessages(body), stream: true }),
    signal,
  })
  if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
    const error = await readErrorResponse(response, 'protocol')
    throw new ApiError(error.kind, redactApiKey(error.message, channel.apiKey), error.status)
  }
  let started = false
  let hasContent = false
  let finished = false
  let stopReason: StopReason = 'end_turn'
  let usage: MessageUsage | undefined
  let blockKind: 'text' | 'thinking' | null = null
  let index = -1

  function* append(kind: 'text' | 'thinking', value: string): Generator<MessageStreamEvent> {
    if (!value) {
      return
    }
    hasContent = true
    if (blockKind !== kind) {
      if (blockKind) {
        yield { type: 'content_block_stop', index }
      }
      index++
      blockKind = kind
      yield {
        type: 'content_block_start',
        index,
        content_block:
          kind === 'text'
            ? { type: 'text', text: '' }
            : { type: 'thinking', thinking: '', signature: '' },
      }
    }
    yield {
      type: 'content_block_delta',
      index,
      delta:
        kind === 'text'
          ? { type: 'text_delta', text: value }
          : { type: 'thinking_delta', thinking: value },
    }
  }

  for await (const event of readServerSentEvents(response.body, signal)) {
    signal.throwIfAborted()
    if (event.data.trim() === '[DONE]') {
      finished = true
      break
    }
    let chunk: Chunk
    try {
      const value: unknown = JSON.parse(event.data)
      if (!value || typeof value !== 'object') {
        throw new Error('invalid chunk')
      }
      chunk = value as Chunk
    } catch {
      throw new ApiError('protocol', { key: 'channelInvalidStream' })
    }
    if (chunk.error) {
      throw new ApiError(
        'stream',
        typeof chunk.error.message === 'string'
          ? redactApiKey(chunk.error.message, channel.apiKey)
          : { key: 'channelInvalidStream' }
      )
    }
    if (!Array.isArray(chunk.choices)) {
      throw new ApiError('protocol', { key: 'channelInvalidStream' })
    }
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: { id: chunk.id ?? createId(), model: chunk.model ?? body.model },
      }
    }
    if (chunk.usage) {
      const cached = tokenCount(chunk.usage.prompt_tokens_details?.cached_tokens)
      usage = {
        input_tokens: Math.max(0, tokenCount(chunk.usage.prompt_tokens) - cached),
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: 0,
        output_tokens: tokenCount(chunk.usage.completion_tokens),
      }
    }
    const choice = chunk.choices[0]
    const delta = choice?.delta
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (typeof reasoning === 'string') {
      yield* append('thinking', reasoning)
    }
    if (typeof delta?.content === 'string') {
      yield* append('text', delta.content)
    }
    if (typeof delta?.refusal === 'string' && delta.refusal) {
      stopReason = 'refusal'
      hasContent = true
    }
    if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
      finished = true
      stopReason =
        choice.finish_reason === 'length'
          ? 'max_tokens'
          : choice.finish_reason === 'content_filter'
            ? 'refusal'
            : choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
              ? 'tool_use'
              : 'end_turn'
    }
  }
  signal.throwIfAborted()
  if (!finished) {
    throw new ApiError('interrupted', { key: 'channelStreamInterrupted' })
  }
  if (!started || !hasContent) {
    throw new ApiError('protocol', { key: 'channelEmptyResponse' })
  }
  if (blockKind) {
    yield { type: 'content_block_stop', index }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}
