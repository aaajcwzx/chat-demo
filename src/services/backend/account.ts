import { backendRequest, jsonRequest } from './client.js'
import { useAccount, type Account } from './state.js'
import { hasPendingHistoryWrites, useChatStore } from '../chat/store.js'
import { useUploads } from '../attachments.js'

const ensureIdle = () => {
  if (
    hasPendingHistoryWrites() ||
    Object.keys(useChatStore.getState().streaming).length ||
    Object.values(useUploads.getState().tasks).some((task) => task.status === 'uploading')
  ) {
    throw new Error('请先等待生成、上传和保存完成')
  }
}

let initialization: Promise<void> | undefined
export const initAccount = (): Promise<void> =>
  (initialization ??= (async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 8000)
    try {
      const status = await backendRequest<{ enabled: boolean; publicOrigin: string }>('/status', {
        signal: controller.signal,
      })
      useAccount.setState({ enabled: status.enabled, publicOrigin: status.publicOrigin })
      const secure =
        location.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(location.hostname)
      if (secure) {
        try {
          useAccount.setState({
            user: await backendRequest<Account>('/auth/me', { signal: controller.signal }),
          })
        } catch {
          useAccount.setState({ user: null })
        }
      }
    } catch {
      useAccount.setState({ enabled: false, user: null })
    } finally {
      window.clearTimeout(timer)
      useAccount.setState({ ready: true })
    }
  })())

export const signIn = async (username: string, password: string) => {
  ensureIdle()
  const user = await backendRequest<Account>(
    '/auth/login',
    jsonRequest('POST', { username, password })
  )
  useAccount.setState({ user, dialog: null })
}
export const signUp = async (
  username: string,
  password: string,
  nickname: string,
  inviteCode: string
) => {
  ensureIdle()
  const user = await backendRequest<Account>(
    '/auth/register',
    jsonRequest('POST', { username, password, nickname, inviteCode })
  )
  useAccount.setState({ user, dialog: null })
}
export const signOut = async () => {
  ensureIdle()
  await backendRequest('/auth/logout', jsonRequest('POST', {}))
  useAccount.setState({ user: null, dialog: null })
}
export const changeAccountPassword = async (oldPassword: string, newPassword: string) => {
  ensureIdle()
  await backendRequest('/auth/password', jsonRequest('POST', { oldPassword, newPassword }))
  useAccount.setState({ dialog: null })
}
