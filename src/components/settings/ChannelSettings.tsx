import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  ChannelConfigError,
  cacheChannelModels,
  EMPTY_MODELS,
  getActiveChannel,
  getChannelSnapshot,
  newChannel,
  normalizeBaseUrl,
  OFFICIAL_CHANNEL_ID,
  removeChannel,
  saveChannel,
  useChannels,
  type Channel,
} from '../../services/channels.js'
import { listChannelModels } from '../../services/api/models.js'
import { useChatStore } from '../../services/chat/store.js'
import { useUploads } from '../../services/attachments.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ModelPicker } from '../models/ModelPicker.js'
import { channelErrorMessage } from '../models/channelError.js'
import { closeSettings, useSettingsDialog } from './settingsDialogState.js'
import styles from './ChannelSettings.module.css'

export const ChannelSettings = ({
  onExpandedChange,
}: {
  onExpandedChange: (expanded: boolean) => void
}) => {
  const t = useTranslate()
  const fields = useId()
  const channels = useChannels((state) => state.channels)
  const activeId = useChannels((state) => state.activeId)
  const [draft, setDraft] = useState(() =>
    getChannelSnapshot(useSettingsDialog.getState().channelId)
  )
  const [models, setModels] = useState<string[] | undefined>(
    () => useChannels.getState().modelLists[draft.id]
  )
  const [keyDraft, setKeyDraft] = useState({ editing: false, value: '', clear: false })
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const busy = useChatStore((state) => Object.keys(state.streaming).length > 0)
  const uploading = useUploads((state) =>
    Object.values(state.tasks).some((task) => task.status === 'uploading')
  )
  const importing = useChatStore((state) => state.importingHistory)
  const locked = busy || uploading || importing || saving
  const official = draft.id === OFFICIAL_CHANNEL_ID
  const saved = channels.some((channel) => channel.id === draft.id)
  const keyConfigured = Boolean(draft.managed ? draft.hasKey : draft.apiKey.trim())
  const editingKey = keyDraft.editing || !keyConfigured
  const apiKey = keyDraft.value.trim() || (keyDraft.clear ? '' : draft.apiKey.trim())
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => onExpandedChange(!official), [official, onExpandedChange])

  const resetTest = () => {
    controller.current?.abort()
    controller.current = null
    setLoading(false)
    setFeedback(null)
    setModels(undefined)
  }
  const select = (channel: Channel) => {
    resetTest()
    setDraft({ ...channel })
    setModels(useChannels.getState().modelLists[channel.id])
    setKeyDraft({ editing: false, value: '', clear: false })
  }
  const update = (field: 'name' | 'baseUrl' | 'model', value: string) => {
    if (field === 'baseUrl') {
      resetTest()
    } else {
      setFeedback(null)
    }
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const changeKey = (value: string) => {
    resetTest()
    setKeyDraft((current) => ({ ...current, value, clear: current.clear && !value.trim() }))
  }
  const cancelKeyChange = () => {
    resetTest()
    setKeyDraft({ editing: false, value: '', clear: false })
  }
  const describe = (error: unknown): string => {
    const message = channelErrorMessage(error)
    return t(message.key, message.params)
  }
  const test = async () => {
    controller.current?.abort()
    const operation = new AbortController()
    controller.current = operation
    setLoading(true)
    setFeedback(null)
    try {
      if (official && !apiKey && !keyConfigured) {
        throw new ChannelConfigError('channelKeyRequired')
      }
      const ids = await listChannelModels(
        { ...draft, apiKey, clearKey: keyDraft.clear },
        operation.signal
      )
      if (operation.signal.aborted) {
        return
      }
      setModels(ids)
      const savedChannel = useChannels
        .getState()
        .channels.find((channel) => channel.id === draft.id)
      if (
        savedChannel &&
        savedChannel.baseUrl === (official ? draft.baseUrl : normalizeBaseUrl(draft.baseUrl)) &&
        savedChannel.apiKey === apiKey
      ) {
        await cacheChannelModels(draft.id, ids)
      }
      if (!official && ids.length) {
        setDraft((current) => ({ ...current, model: current.model || ids[0] }))
      }
      setFeedback({
        error: false,
        text: ids.length ? t('channelTestSuccess', { count: ids.length }) : t('channelModelsEmpty'),
      })
    } catch (error) {
      if (!operation.signal.aborted) {
        setFeedback({ error: true, text: describe(error) })
      }
    } finally {
      if (controller.current === operation) {
        setLoading(false)
      }
    }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked) {
      return
    }
    setSaving(true)
    try {
      const channel = await saveChannel({ ...draft, apiKey, clearKey: keyDraft.clear }, models)
      controller.current?.abort()
      showToast({
        key: 'channelSaved',
        params: { name: channel.id === OFFICIAL_CHANNEL_ID ? t('channelOfficial') : channel.name },
      })
      closeSettings()
    } catch (error) {
      setFeedback({ error: true, text: describe(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.selectorRow}>
          <Select
            value={draft.id}
            options={channels.map((channel) => ({
              value: channel.id,
              label: `${channel.id === OFFICIAL_CHANNEL_ID ? t('channelOfficial') : channel.name}${channel.id === activeId ? ` · ${t('channelInUse')}` : ''}`,
            }))}
            placeholder={t('channelNew')}
            ariaLabel={t('channelSelect')}
            className={styles.selector}
            onChange={(id) => select(getChannelSnapshot(id))}
          />
          <Button variant="outlined" size="s" onClick={() => select(newChannel())}>
            {t('channelAdd')}
          </Button>
        </div>
        <p className={styles.description}>
          {official ? t('channelOfficialHint') : t('channelCustomHint')}
        </p>
        {!official ? (
          <>
            <div className={styles.identityRow}>
              <label className={styles.field} htmlFor={`${fields}-name`}>
                <span>{t('channelName')}</span>
                <input
                  id={`${fields}-name`}
                  aria-label={t('channelName')}
                  value={draft.name}
                  maxLength={80}
                  placeholder={t('channelNamePlaceholder')}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <div className={styles.protocol}>
                <span>{t('channelProtocol')}</span>
                <span>{t('channelProtocolOpenAI')}</span>
              </div>
            </div>
            <label className={styles.field} htmlFor={`${fields}-url`}>
              <span>{t('channelBaseUrl')}</span>
              <input
                id={`${fields}-url`}
                aria-label={t('channelBaseUrl')}
                type="url"
                autoComplete="off"
                spellCheck={false}
                value={draft.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(event) => update('baseUrl', event.target.value)}
              />
              <small>{t('channelUrlHint')}</small>
            </label>
          </>
        ) : null}
        <div className={styles.field}>
          <label htmlFor={editingKey ? `${fields}-key` : undefined}>API Key</label>
          {editingKey ? (
            <div className={styles.inputRow}>
              <input
                id={`${fields}-key`}
                aria-label="API Key"
                type="password"
                value={keyDraft.value}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t(
                  keyConfigured ? 'channelKeyReplacePlaceholder' : 'apiKeyPlaceholder'
                )}
                onChange={(event) => changeKey(event.target.value)}
              />
              {keyConfigured ? (
                <Button variant="outlined" size="s" onClick={cancelKeyChange}>
                  {t('cancel')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className={styles.keySaved}>
              <span className={styles.keyMask} aria-hidden="true">
                ••••••••
              </span>
              <span className={styles.keyStatus}>{t('channelKeyConfigured')}</span>
              <Button
                variant="outlined"
                size="s"
                onClick={() => setKeyDraft((current) => ({ ...current, editing: true }))}
              >
                {t('changeApiKey')}
              </Button>
            </div>
          )}
          {editingKey && keyConfigured ? (
            <small>{t(keyDraft.clear ? 'channelKeyClearPending' : 'channelKeyReplaceHint')}</small>
          ) : null}
          {editingKey && keyConfigured && !official && !keyDraft.clear ? (
            <button
              type="button"
              className={styles.keyClear}
              onClick={() => {
                resetTest()
                setKeyDraft({ editing: true, value: '', clear: true })
              }}
            >
              {t('channelKeyClear')}
            </button>
          ) : null}
          {!official && !keyConfigured ? <small>{t('channelKeyHint')}</small> : null}
        </div>
        {!official ? (
          <div className={styles.field}>
            <label htmlFor={`${fields}-model`}>{t('channelModel')}</label>
            <div className={styles.inputRow}>
              <ModelPicker
                inputId={`${fields}-model`}
                value={draft.model}
                models={models ?? EMPTY_MODELS}
                resetKey={draft.id}
                placeholder={t('channelModelPlaceholder')}
                loading={loading}
                onChange={(model) => update('model', model)}
              />
              <Button variant="outlined" size="s" disabled={loading} onClick={() => void test()}>
                {t('channelFetchModels')}
              </Button>
            </div>
            <small>{t('channelModelHint')}</small>
          </div>
        ) : (
          <div className={styles.protocol}>
            <span>{t('channelModel')}</span>
            <span>{draft.model}</span>
          </div>
        )}
        <div className={styles.capabilities}>
          {t('channelCapabilities')}:{' '}
          {t(official ? 'channelOfficialCapabilities' : 'channelCustomCapabilities')}
        </div>
        {feedback ? (
          <p
            className={feedback.error ? styles.error : styles.success}
            role={feedback.error ? 'alert' : 'status'}
          >
            {feedback.text}
          </p>
        ) : null}
        {locked ? (
          <p className={styles.description} role="status">
            {t('channelBusy')}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button variant="outlined" size="m" disabled={loading} onClick={() => void test()}>
            {t(loading ? 'channelTesting' : 'channelTest')}
          </Button>
          <Button type="submit" size="m" disabled={locked}>
            {t('channelSaveUse')}
          </Button>
          {!official && saved ? (
            <Button
              variant="dangerOutlined"
              size="s"
              disabled={locked}
              onClick={() => setDeleting(true)}
            >
              {t('channelDelete')}
            </Button>
          ) : null}
        </div>
      </form>
      {deleting ? (
        <Modal
          title={t('channelDeleteTitle')}
          onClose={() => setDeleting(false)}
          footer={
            <div className={styles.actions}>
              <Button variant="outlined" size="m" onClick={() => setDeleting(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="m"
                disabled={locked}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await removeChannel(draft.id)
                    select(getActiveChannel())
                    setDeleting(false)
                  } catch (error) {
                    setFeedback({ error: true, text: describe(error) })
                    setDeleting(false)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </div>
          }
        >
          {t(draft.id === activeId ? 'channelDeleteActiveHint' : 'channelDeleteHint', {
            name: draft.name,
          })}
        </Modal>
      ) : null}
    </>
  )
}
