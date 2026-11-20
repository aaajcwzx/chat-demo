import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { readLocalSnapshot, type StoredFile } from '../chat/db.js'
import type { Session } from '../chat/types.js'
import {
  readLocalChannels,
  loadAccountChannels,
  OFFICIAL_CHANNEL_ID,
  type Channel,
} from '../channels.js'
import { backendRequest, jsonRequest } from './client.js'
import { storageOwner, useAccount } from './state.js'
import { cloudImport } from './storage.js'
import { hasPendingHistoryWrites, refreshCloudHistory, useChatStore } from '../chat/store.js'

export type BrowserSnapshot = {
  sessions: Session[]
  files: StoredFile[]
  channels: ReturnType<typeof readLocalChannels>
}
type Peer = { window: Window; origin: string; nonce: string; expires: number }
let peer: Peer | undefined
let requested = false
export const useMigration = create(() => ({
  outgoing: false,
  waiting: false,
  incoming: null as BrowserSnapshot | null,
}))
const nonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
export const legacyOrigin = () => {
  const url = new URL(useAccount.getState().publicOrigin || location.origin)
  url.protocol = 'http:'
  return url.origin
}
const tokenParam = (name: string) => {
  const value = new URL(location.href).searchParams.get(name)
  return value && /^[a-f0-9]{32}$/.test(value) ? value : undefined
}
export const openSecureLogin = () => {
  const origin = useAccount.getState().publicOrigin
  const value = nonce()
  const popup = window.open(`${origin}/?from-browser=${value}`, `chat-demo-login-${value}`)
  if (!popup) {
    throw new Error('请允许打开登录窗口后重试')
  }
  peer = { window: popup, origin, nonce: value, expires: Date.now() + 20 * 60 * 1000 }
}
export const openLegacyMigration = () => {
  const value = nonce()
  const origin = legacyOrigin()
  const popup = window.open(`${origin}/?send-to-cloud=${value}`, `chat-demo-import-${value}`)
  if (!popup) {
    throw new Error('请允许打开原页面后重试')
  }
  peer = { window: popup, origin, nonce: value, expires: Date.now() + 20 * 60 * 1000 }
  useMigration.setState({ waiting: true })
}
export const requestOriginalBrowserData = () => {
  const value = tokenParam('from-browser')
  if (!value || !window.opener || requested || storageOwner() === null) {
    return
  }
  requested = true
  peer = {
    window: window.opener as Window,
    origin: legacyOrigin(),
    nonce: value,
    expires: Date.now() + 20 * 60 * 1000,
  }
  useMigration.setState({ waiting: true })
  peer.window.postMessage({ type: 'chat-demo:migration-request', nonce: value }, peer.origin)
}
export const prepareLocalMigration = async () => {
  useMigration.setState({
    incoming: { ...(await readLocalSnapshot()), channels: readLocalChannels() },
  })
}
export const confirmBrowserTransfer = async () => {
  if (!peer || Date.now() > peer.expires) {
    throw new Error('迁移窗口已失效，请重新打开')
  }
  const snapshot: BrowserSnapshot = {
    ...(await readLocalSnapshot()),
    channels: readLocalChannels(),
  }
  peer.window.postMessage(
    { type: 'chat-demo:browser-snapshot', nonce: peer.nonce, snapshot },
    peer.origin
  )
  useMigration.setState({ outgoing: false })
}
export const closeMigration = () =>
  useMigration.setState({ outgoing: false, incoming: null, waiting: false })
const isSnapshot = (value: unknown): value is BrowserSnapshot => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Partial<BrowserSnapshot>
  return (
    Array.isArray(row.sessions) &&
    Array.isArray(row.files) &&
    !!row.channels &&
    Array.isArray(row.channels.channels) &&
    row.sessions.length <= 10000 &&
    row.files.length <= 10000 &&
    row.files.every((file) => typeof file.id === 'string' && file.blob instanceof Blob)
  )
}
export const bindBrowserMigration = () => {
  const value = tokenParam('send-to-cloud')
  if (value && window.opener && location.protocol === 'http:') {
    peer = {
      window: window.opener as Window,
      origin: useAccount.getState().publicOrigin,
      nonce: value,
      expires: Date.now() + 20 * 60 * 1000,
    }
    useMigration.setState({ outgoing: true })
  }
  const receive = (event: MessageEvent) => {
    if (
      !peer ||
      event.source !== peer.window ||
      event.origin !== peer.origin ||
      Date.now() > peer.expires ||
      event.data?.nonce !== peer.nonce
    ) {
      return
    }
    if (event.data.type === 'chat-demo:migration-request' && location.protocol === 'http:') {
      useMigration.setState({ outgoing: true })
    } else if (
      event.data.type === 'chat-demo:browser-snapshot' &&
      location.protocol === 'https:' &&
      storageOwner() !== null &&
      isSnapshot(event.data.snapshot)
    ) {
      useMigration.setState({ waiting: false, incoming: event.data.snapshot as BrowserSnapshot })
    }
  }
  window.addEventListener('message', receive)
  return () => window.removeEventListener('message', receive)
}

/** Only this explicit confirmation sends local history and optional keys to the server. */
export const importBrowserSnapshot = async (
  snapshot: BrowserSnapshot,
  includeChannels: boolean
) => {
  const owner = storageOwner()
  if (
    owner === null ||
    hasPendingHistoryWrites() ||
    Object.keys(useChatStore.getState().streaming).length
  ) {
    throw new Error('请先登录并等待当前操作保存完成')
  }
  const size = snapshot.files.reduce((total, file) => total + file.blob.size, 0)
  if (size > 250 * 1024 * 1024) {
    throw new Error('附件总大小超过 250 MB，请分批通过归档导入')
  }
  useChatStore.setState({ importingHistory: true })
  try {
    const remote = await backendRequest<{ channels: Channel[] }>('/channels', {}, owner)
    const existing = new Map(remote.channels.map((channel) => [channel.id, channel]))
    const idMap = new Map<string, string>()
    if (includeChannels) {
      for (const local of snapshot.channels.channels) {
        if (local.id === OFFICIAL_CHANNEL_ID && (!local.apiKey || existing.get(local.id)?.hasKey)) {
          continue
        }
        if (local.id !== OFFICIAL_CHANNEL_ID && (!local.name || !local.baseUrl || !local.model)) {
          continue
        }
        // Retain already configured server channels; collisions receive an independent copy.
        const id =
          existing.has(local.id) && local.id !== OFFICIAL_CHANNEL_ID ? createId() : local.id
        await backendRequest(
          `/channels/${encodeURIComponent(id)}`,
          jsonRequest('PUT', {
            id,
            name: local.name,
            protocol: local.protocol,
            baseUrl: local.baseUrl,
            model: local.model,
            apiKey: local.apiKey,
            models: snapshot.channels.modelLists[local.id],
          }),
          owner
        )
        idMap.set(local.id, id)
      }
    }
    const sessions = snapshot.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.role === 'assistant'
          ? { ...message, channelId: idMap.get(message.channelId ?? '') ?? message.channelId }
          : { ...message, files: message.files.map((file) => ({ ...file, serverId: null })) }
      ),
    }))
    const list = await cloudImport(owner, sessions, snapshot.files, false)
    await loadAccountChannels(owner)
    closeMigration()
    return list.length
  } finally {
    if (storageOwner() === owner) {
      useChatStore.setState({ importingHistory: false })
      await refreshCloudHistory()
    }
  }
}
