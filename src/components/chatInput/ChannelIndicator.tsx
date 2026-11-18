import { useActiveChannel, OFFICIAL_CHANNEL_ID } from '../../services/channels.js'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './ChannelIndicator.module.css'

export const ChannelIndicator = () => {
  const channel = useActiveChannel()
  const t = useTranslate()
  const name = channel.id === OFFICIAL_CHANNEL_ID ? t('channelOfficial') : channel.name
  return (
    <button
      type="button"
      className={styles.indicator}
      aria-label={t('channelCurrent')}
      title={`${name} · ${channel.model}`}
      onClick={() => openSettings('service')}
    >
      <span>
        {name} · {channel.model}
      </span>
      <IconChevronDownOutline14 />
    </button>
  )
}
