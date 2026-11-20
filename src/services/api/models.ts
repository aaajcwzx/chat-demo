import { normalizeBaseUrl, type Channel } from '../channels.js'
import { ApiError, request } from './http.js'
import { backendRequest, jsonRequest } from '../backend/client.js'

export const listChannelModels = async (
  channel: Channel,
  signal?: AbortSignal
): Promise<string[]> => {
  if (channel.managed) {
    return backendRequest<string[]>(
      '/channels/models',
      jsonRequest('POST', channel, signal),
      channel.ownerId
    )
  }
  const base =
    channel.protocol === 'deepseek'
      ? channel.baseUrl.replace(/\/+$/, '')
      : normalizeBaseUrl(channel.baseUrl)
  const response = await request(
    `${base}/models`,
    {
      method: 'GET',
      headers: channel.apiKey.trim() ? { Authorization: `Bearer ${channel.apiKey.trim()}` } : {},
      signal,
    },
    channel
  )
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('protocol', { key: 'channelInvalidModelsResponse' })
  }
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
    throw new ApiError('protocol', { key: 'channelInvalidModelsResponse' })
  }
  return [
    ...new Set(
      body.data.flatMap((item: unknown) =>
        item &&
        typeof item === 'object' &&
        'id' in item &&
        typeof item.id === 'string' &&
        item.id.trim()
          ? [item.id]
          : []
      )
    ),
  ].sort()
}
