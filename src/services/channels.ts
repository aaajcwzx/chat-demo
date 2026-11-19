import { create } from 'zustand'
import { createId } from '../utils/id.js'

export type ChannelProtocol = 'deepseek' | 'openai'
export type Channel = {
  id: string
  name: string
  protocol: ChannelProtocol
  baseUrl: string
  apiKey: string
  model: string
}

export const OFFICIAL_CHANNEL_ID = 'deepseek-official'
export const CHANNELS_STORAGE_KEY = 'chat-demo:channels:v1'
const LEGACY_KEY = 'chat-demo:api-key'

export class ChannelConfigError extends Error {
  constructor(
    readonly code:
      | 'channelInvalidUrl'
      | 'channelNameRequired'
      | 'channelModelRequired'
      | 'channelKeyRequired'
  ) {
    super(code)
    this.name = 'ChannelConfigError'
  }
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Keep an API prefix such as /v1 or /api/v1, rather than a complete endpoint. */
export const normalizeBaseUrl = (value: string): string => {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ChannelConfigError('channelInvalidUrl')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ChannelConfigError('channelInvalidUrl')
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '')
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/v1'
  }
  return url.toString().replace(/\/+$/, '')
}

const officialChannel = (apiKey = ''): Channel => ({
  id: OFFICIAL_CHANNEL_ID,
  name: 'DeepSeek',
  protocol: 'deepseek',
  baseUrl: __API_ORIGIN__.replace(/\/+$/, ''),
  apiKey,
  model: 'deepseek-flash',
})

type ChannelState = {
  channels: Channel[]
  activeId: string
  modelLists: Record<string, string[]>
}
export const EMPTY_MODELS: readonly string[] = []
const normalizeModelList = (models: string[]) =>
  [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort()
const withoutModelList = (lists: ChannelState['modelLists'], id: string) =>
  Object.fromEntries(Object.entries(lists).filter(([channelId]) => channelId !== id))

const load = (): ChannelState => {
  const fallback = {
    channels: [officialChannel(read(LEGACY_KEY)?.trim() ?? '')],
    activeId: OFFICIAL_CHANNEL_ID,
    modelLists: {},
  }
  const raw = read(CHANNELS_STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('channels' in parsed) ||
      !Array.isArray(parsed.channels)
    ) {
      return fallback
    }
    const channels: Channel[] = []
    const ids = new Set<string>()
    for (const item of parsed.channels) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || ids.has(item.id)) {
        continue
      }
      if (item.id === OFFICIAL_CHANNEL_ID) {
        channels.push(
          officialChannel(
            typeof item.apiKey === 'string' ? item.apiKey : fallback.channels[0].apiKey
          )
        )
      } else {
        if (
          item.protocol !== 'openai' ||
          typeof item.name !== 'string' ||
          typeof item.baseUrl !== 'string' ||
          typeof item.apiKey !== 'string' ||
          typeof item.model !== 'string' ||
          !item.name.trim() ||
          !item.model.trim()
        ) {
          continue
        }
        try {
          channels.push({
            id: item.id,
            name: item.name,
            protocol: 'openai',
            baseUrl: normalizeBaseUrl(item.baseUrl),
            apiKey: item.apiKey,
            model: item.model,
          })
        } catch {
          continue
        }
      }
      ids.add(item.id)
    }
    if (!ids.has(OFFICIAL_CHANNEL_ID)) {
      channels.unshift(fallback.channels[0])
    }
    const activeId =
      'activeId' in parsed &&
      typeof parsed.activeId === 'string' &&
      channels.some((channel) => channel.id === parsed.activeId)
        ? parsed.activeId
        : OFFICIAL_CHANNEL_ID
    const modelLists: Record<string, string[]> = {}
    if ('modelLists' in parsed && parsed.modelLists && typeof parsed.modelLists === 'object') {
      for (const channel of channels) {
        const list = (parsed.modelLists as Record<string, unknown>)[channel.id]
        if (Array.isArray(list)) {
          modelLists[channel.id] = normalizeModelList(
            list.filter((id): id is string => typeof id === 'string')
          )
        }
      }
    }
    return { channels, activeId, modelLists }
  } catch {
    return fallback
  }
}

export const useChannels = create<ChannelState>(() => load())
export const getActiveChannel = (): Channel => {
  const { channels, activeId } = useChannels.getState()
  return channels.find((channel) => channel.id === activeId) ?? channels[0]
}
export const useActiveChannel = () =>
  useChannels(
    (state) => state.channels.find((channel) => channel.id === state.activeId) ?? state.channels[0]
  )
export const getChannelSnapshot = (id?: string): Channel => ({
  ...(id
    ? (useChannels.getState().channels.find((channel) => channel.id === id) ?? getActiveChannel())
    : getActiveChannel()),
})
export const isChannelConfigured = (channel = getActiveChannel()) =>
  channel.protocol === 'deepseek'
    ? Boolean(channel.apiKey.trim())
    : Boolean(channel.baseUrl && channel.model.trim())

const persist = () => {
  const state = useChannels.getState()
  try {
    localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify({ version: 1, ...state }))
    const key = state.channels.find((channel) => channel.id === OFFICIAL_CHANNEL_ID)?.apiKey ?? ''
    if (key) {
      localStorage.setItem(LEGACY_KEY, key)
    } else {
      localStorage.removeItem(LEGACY_KEY)
    }
  } catch {
    // Keep the current page usable when browser storage is unavailable.
  }
}

export const newChannel = (): Channel => ({
  id: createId(),
  name: '',
  protocol: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
})
export const validateChannel = (draft: Channel): Channel => {
  if (draft.id === OFFICIAL_CHANNEL_ID) {
    if (!draft.apiKey.trim()) {
      throw new ChannelConfigError('channelKeyRequired')
    }
    return officialChannel(draft.apiKey.trim())
  }
  if (!draft.name.trim()) {
    throw new ChannelConfigError('channelNameRequired')
  }
  if (!draft.model.trim()) {
    throw new ChannelConfigError('channelModelRequired')
  }
  return {
    ...draft,
    protocol: 'openai',
    name: draft.name.trim(),
    baseUrl: normalizeBaseUrl(draft.baseUrl),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
  }
}

export const saveChannel = (draft: Channel, models?: string[]): Channel => {
  const channel = validateChannel(draft)
  useChannels.setState((state) => {
    const previous = state.channels.find((item) => item.id === channel.id)
    let modelLists = { ...state.modelLists }
    if (models !== undefined) {
      modelLists[channel.id] = normalizeModelList(models)
    } else if (
      !previous ||
      previous.baseUrl !== channel.baseUrl ||
      previous.apiKey !== channel.apiKey
    ) {
      modelLists = withoutModelList(modelLists, channel.id)
    }
    return {
      channels: previous
        ? state.channels.map((item) => (item.id === channel.id ? channel : item))
        : [...state.channels, channel],
      activeId: channel.id,
      modelLists,
    }
  })
  persist()
  return channel
}
export const activateChannel = (id: string) => {
  if (!useChannels.getState().channels.some((channel) => channel.id === id)) {
    return
  }
  useChannels.setState({ activeId: id })
  persist()
}
export const removeChannel = (id: string) => {
  if (id === OFFICIAL_CHANNEL_ID) {
    return
  }
  useChannels.setState((state) => {
    const modelLists = withoutModelList(state.modelLists, id)
    return {
      channels: state.channels.filter((channel) => channel.id !== id),
      activeId: state.activeId === id ? OFFICIAL_CHANNEL_ID : state.activeId,
      modelLists,
    }
  })
  persist()
}
export const setActiveApiKey = (apiKey: string | null) => {
  const active = getActiveChannel()
  const key = apiKey?.trim() ?? ''
  useChannels.setState((state) => {
    const modelLists =
      active.apiKey !== key ? withoutModelList(state.modelLists, active.id) : state.modelLists
    return {
      channels: state.channels.map((channel) =>
        channel.id === active.id ? { ...channel, apiKey: key } : channel
      ),
      modelLists,
    }
  })
  persist()
}

export const cacheChannelModels = (id: string, models: string[]) => {
  if (!useChannels.getState().channels.some((channel) => channel.id === id)) {
    return
  }
  useChannels.setState((state) => ({
    modelLists: { ...state.modelLists, [id]: normalizeModelList(models) },
  }))
  persist()
}

export const setChannelModel = (id: string, model: string) => {
  if (!model.trim()) {
    return
  }
  useChannels.setState((state) => ({
    channels: state.channels.map((channel) =>
      channel.id === id && channel.protocol === 'openai'
        ? { ...channel, model: model.trim() }
        : channel
    ),
  }))
  persist()
}

// Migrate a legacy official key once without touching chat history.
if (!read(CHANNELS_STORAGE_KEY) && read(LEGACY_KEY)) {
  persist()
}
