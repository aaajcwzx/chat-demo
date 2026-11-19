import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { ChatModelMenu } from '../models/ChatModelMenu.js'
import { CollapsedSider } from '../sider/CollapsedSider.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './ChatHeader.module.css'

/** A shared toolbar above both new chats and existing conversations. */
export const ChatHeader = ({
  title,
  siderCollapsed,
}: {
  title?: string
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <header className={styles.header} aria-label={t('chatToolbar')}>
      {isMobile ? (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconMenuOutline20 />}
          aria-label={t('expandSiderbarButton')}
          onClick={openMobileSider}
        />
      ) : siderCollapsed ? (
        <CollapsedSider />
      ) : null}
      <ChatModelMenu />
      {!isMobile && title ? (
        <span className={styles.title} title={title}>
          {title}
        </span>
      ) : null}
      {isMobile && title !== undefined ? (
        <IconButton
          className={styles.newChat}
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      ) : null}
    </header>
  )
}
