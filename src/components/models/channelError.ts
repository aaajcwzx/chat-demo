import type { TranslationMessage } from '../../i18n/index.js'
import { ChannelConfigError } from '../../services/channels.js'
import { ApiError } from '../../services/api/http.js'

export const channelErrorMessage = (error: unknown): TranslationMessage => {
  if (error instanceof ChannelConfigError) {
    return { key: error.code }
  }
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return { key: 'channelNetworkError' }
    }
    if (error.status === 401 || error.status === 403) {
      return { key: 'channelAuthError' }
    }
    if (error.status === 404 || error.status === 405) {
      return { key: 'channelModelsUnavailable' }
    }
    if (error.localMessage) {
      return error.localMessage
    }
  }
  return {
    key: 'channelTestFailed',
    params: { message: error instanceof Error ? error.message.slice(0, 300) : String(error) },
  }
}
