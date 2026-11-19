import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate, type TranslationMessage } from '../../i18n/index.js'
import {
  activateChannel,
  cacheChannelModels,
  EMPTY_MODELS,
  OFFICIAL_CHANNEL_ID,
  setChannelModel,
  useActiveChannel,
  useChannels,
} from '../../services/channels.js'
import { listChannelModels } from '../../services/api/models.js'
import { useChatStore } from '../../services/chat/store.js'
import { useUploads } from '../../services/attachments.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { channelErrorMessage } from './channelError.js'
import { ModelPicker } from './ModelPicker.js'
import styles from './ChatModelMenu.module.css'

export const ChatModelMenu = () => {
  const t = useTranslate()
  const channel = useActiveChannel()
  const channels = useChannels((state) => state.channels)
  const cachedModels = useChannels((state) => state.modelLists[channel.id])
  const busy = useChatStore((state) => Object.keys(state.streaming).length > 0)
  const uploading = useUploads((state) =>
    Object.values(state.tasks).some((task) => task.status === 'uploading')
  )
  const locked = busy || uploading
  const custom = channel.protocol === 'openai'
  const hasModels = cachedModels !== undefined
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<TranslationMessage | null>(null)
  const controller = useRef<AbortController | null>(null)

  const refreshModels = useCallback(async () => {
    controller.current?.abort()
    const operation = new AbortController()
    controller.current = operation
    setLoading(true)
    setFeedback(null)
    try {
      const models = await listChannelModels(channel, operation.signal)
      if (!operation.signal.aborted) {
        cacheChannelModels(channel.id, models)
      }
    } catch (error) {
      if (!operation.signal.aborted) {
        setFeedback(channelErrorMessage(error))
      }
    } finally {
      if (controller.current === operation) {
        setLoading(false)
      }
    }
  }, [channel])

  useEffect(() => {
    setFeedback(null)
    setLoading(false)
    if (open && custom && !hasModels) {
      void refreshModels()
    }
    return () => controller.current?.abort()
  }, [open, custom, hasModels, refreshModels])

  const name = channel.id === OFFICIAL_CHANNEL_ID ? t('channelOfficial') : channel.name
  return (
    <ModelPicker
      value={channel.model}
      subtitle={name}
      models={custom ? (cachedModels ?? EMPTY_MODELS) : EMPTY_MODELS}
      resetKey={channel.id}
      editable={false}
      open={open}
      selectionDisabled={locked}
      loading={loading}
      onOpenChange={setOpen}
      onChange={(model) => setChannelModel(channel.id, model)}
      menuHeader={
        <div className={styles.channelRow}>
          <label htmlFor="chat-model-channel">{t('channelSelect')}</label>
          <select
            id="chat-model-channel"
            aria-label={t('channelSelect')}
            value={channel.id}
            disabled={locked}
            onChange={(event) => activateChannel(event.target.value)}
          >
            {channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id === OFFICIAL_CHANNEL_ID ? t('channelOfficial') : item.name}
              </option>
            ))}
          </select>
        </div>
      }
      menuFooter={
        <div className={styles.footer}>
          {feedback ? (
            <p className={styles.error} role="alert">
              {t(feedback.key, feedback.params)}
            </p>
          ) : null}
          {locked ? (
            <p className={styles.hint} role="status">
              {t('channelBusy')}
            </p>
          ) : null}
          <div className={styles.actions}>
            {custom ? (
              <button type="button" disabled={loading} onClick={() => void refreshModels()}>
                {t(loading ? 'modelFetching' : 'modelRefresh')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openSettings('service')
              }}
            >
              {t('channelManage')}
            </button>
          </div>
        </div>
      }
    />
  )
}
