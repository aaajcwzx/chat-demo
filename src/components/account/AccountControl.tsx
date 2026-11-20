import { useEffect, useState, type FormEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useAccount, openAccountDialog, closeAccountDialog } from '../../services/backend/state.js'
import { signIn, signUp, signOut, changeAccountPassword } from '../../services/backend/account.js'
import {
  hasPendingHistoryWrites,
  refreshCloudHistory,
  useChatStore,
} from '../../services/chat/store.js'
import { useUploads } from '../../services/attachments.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import {
  bindBrowserMigration,
  closeMigration,
  confirmBrowserTransfer,
  importBrowserSnapshot,
  openLegacyMigration,
  openSecureLogin,
  prepareLocalMigration,
  requestOriginalBrowserData,
  useMigration,
} from '../../services/backend/migration.js'
import styles from './AccountControl.module.css'

const useAccountBusy = () => {
  const streaming = useChatStore((state) => Object.keys(state.streaming).length > 0)
  const importing = useChatStore((state) => state.importingHistory)
  const errors = useChatStore((state) => state.sessionSaveErrors)
  const uploading = useUploads((state) =>
    Object.values(state.tasks).some((task) => task.status === 'uploading')
  )
  return (
    streaming ||
    importing ||
    uploading ||
    Object.values(errors).some(Boolean) ||
    hasPendingHistoryWrites()
  )
}

export const AccountControl = () => {
  const t = useTranslate()
  const { ready, enabled, user, publicOrigin } = useAccount()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const locked = useAccountBusy() || working
  useEffect(() => {
    setOpen(false)
    setError('')
  }, [user?.id])
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }
  const secure =
    location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)
  if (!ready || !enabled) {
    return null
  }
  return (
    <div className={styles.control}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={user ? t('accountMenu') : t('accountLogin')}
        onClick={() => (user ? setOpen(true) : secure ? openAccountDialog() : setOpen(true))}
      >
        {user ? (
          <span className={styles.avatar}>
            {(user.nickname || user.username).slice(0, 1).toUpperCase()}
          </span>
        ) : null}
        <span className={styles.name}>
          {user ? user.nickname || user.username : t('accountLogin')}
        </span>
        <span className={styles.mode}>{t(user ? 'accountCloudBadge' : 'accountLocalBadge')}</span>
      </button>
      {open ? (
        <Modal
          title={t('accountMenu')}
          closable
          className={styles.dialog}
          onClose={() => !working && setOpen(false)}
        >
          <div className={styles.panel}>
            <p className={styles.explanation}>
              {t(user ? 'accountCloudHint' : 'accountLocalHint')}
            </p>
            {user ? <p>{user.username}</p> : <p>{t('accountHttpsHint')}</p>}
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            <div className={styles.actions}>
              {!user ? (
                <Button
                  disabled={locked}
                  onClick={() => {
                    try {
                      openSecureLogin()
                      setOpen(false)
                    } catch (cause) {
                      setError((cause as Error).message)
                    }
                  }}
                >
                  {t('accountSecureLogin')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    disabled={locked}
                    onClick={() => void run(refreshCloudHistory)}
                  >
                    {t('accountRefresh')}
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={locked}
                    onClick={() => {
                      setOpen(false)
                      openSettings('data')
                    }}
                  >
                    {t('accountBackup')}
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={locked}
                    onClick={() => void run(prepareLocalMigration)}
                  >
                    {t('accountImportLocal')}
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={locked}
                    onClick={() => {
                      try {
                        openLegacyMigration()
                        setOpen(false)
                      } catch (cause) {
                        setError((cause as Error).message)
                      }
                    }}
                  >
                    {t('accountImportHttp')}
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={locked}
                    onClick={() => {
                      setOpen(false)
                      openAccountDialog('password')
                    }}
                  >
                    {t('accountPassword')}
                  </Button>
                  {user.admin ? (
                    <a
                      className={styles.adminLink}
                      href={`${publicOrigin}/admin/`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('accountAdmin')}
                    </a>
                  ) : null}
                  <Button
                    variant="dangerOutlined"
                    disabled={locked}
                    onClick={() => void run(signOut)}
                  >
                    {t('accountLogout')}
                  </Button>
                </>
              )}
            </div>
            {locked ? <p className={styles.explanation}>{t('accountBusy')}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

export const AccountDialogs = () => {
  const { dialog, ready, publicOrigin, user } = useAccount()
  useEffect(() => {
    if (!ready || !publicOrigin) {
      return
    }
    return bindBrowserMigration()
  }, [ready, publicOrigin])
  useEffect(() => {
    if (ready && user) {
      requestOriginalBrowserData()
    }
  }, [ready, user])
  return (
    <>
      {dialog ? <AccountForm key={dialog} /> : null}
      <MigrationDialogs />
    </>
  )
}

const AccountForm = () => {
  const t = useTranslate()
  const dialog = useAccount((state) => state.dialog)
  const registering = dialog === 'register'
  const changing = dialog === 'password'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [invite, setInvite] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const locked = useAccountBusy()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (working || locked) {
      return
    }
    setWorking(true)
    setError('')
    try {
      if ((changing || registering) && (changing ? newPassword : password) !== confirmation) {
        throw new Error(t('accountPasswordMismatch'))
      }
      if (changing) {
        await changeAccountPassword(password, newPassword)
      } else if (registering) {
        await signUp(username, password, nickname, invite)
      } else {
        await signIn(username, password)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }
  return (
    <Modal
      title={t(changing ? 'accountPassword' : registering ? 'accountRegister' : 'accountLogin')}
      closable
      className={styles.dialog}
      onClose={() => !working && closeAccountDialog()}
    >
      <form className={styles.form} onSubmit={submit}>
        <p className={styles.explanation}>
          {t(changing ? 'accountPasswordHint' : 'accountLoginHint')}
        </p>
        {!changing ? (
          <label>
            {t('accountUsername')}
            <input
              value={username}
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
        ) : null}
        {registering ? (
          <label>
            {t('accountNickname')}
            <input
              value={nickname}
              maxLength={40}
              autoComplete="nickname"
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          {t(changing ? 'accountOldPassword' : 'accountPasswordLabel')}
          <input
            type="password"
            value={password}
            required
            minLength={registering ? 8 : undefined}
            maxLength={72}
            autoComplete={registering ? 'new-password' : 'current-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {changing ? (
          <label>
            {t('accountNewPassword')}
            <input
              type="password"
              required
              value={newPassword}
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
        ) : null}
        {changing || registering ? (
          <label>
            {t('accountConfirmPassword')}
            <input
              type="password"
              required
              value={confirmation}
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {registering ? (
          <label>
            {t('accountInvite')}
            <input
              value={invite}
              required
              autoComplete="off"
              onChange={(event) => setInvite(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {locked ? <p className={styles.explanation}>{t('accountBusy')}</p> : null}
        <Button type="submit" size="m" disabled={working || locked}>
          {t(
            working
              ? 'accountWorking'
              : changing
                ? 'confirm'
                : registering
                  ? 'accountRegister'
                  : 'accountLogin'
          )}
        </Button>
        {!changing ? (
          <button
            type="button"
            className={styles.switch}
            disabled={working}
            onClick={() => openAccountDialog(registering ? 'login' : 'register')}
          >
            {t(registering ? 'accountBackLogin' : 'accountRegisterInvite')}
          </button>
        ) : null}
      </form>
    </Modal>
  )
}

const MigrationDialogs = () => {
  const t = useTranslate()
  const { outgoing, incoming, waiting } = useMigration()
  const [includeChannels, setIncludeChannels] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const locked = useAccountBusy()
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }
  useEffect(() => {
    setError('')
  }, [incoming, outgoing, waiting])
  if (!incoming && !outgoing && !waiting) {
    return null
  }
  return (
    <Modal
      title={t('accountMigrationTitle')}
      className={styles.dialog}
      closable
      onClose={() => !working && closeMigration()}
    >
      <div className={styles.panel}>
        <p className={styles.explanation}>
          {t(
            outgoing
              ? 'accountTransferHint'
              : waiting
                ? 'accountMigrationWaiting'
                : 'accountMigrationHint'
          )}
        </p>
        {incoming ? (
          <>
            <p>
              {t('accountMigrationCount', {
                count: incoming.sessions.length,
                files: incoming.files.length,
              })}
            </p>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={includeChannels}
                onChange={(event) => setIncludeChannels(event.target.checked)}
              />
              {t('accountMigrationChannels')}
            </label>
          </>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button variant="outlined" disabled={working} onClick={closeMigration}>
            {t('cancel')}
          </Button>
          {outgoing ? (
            <Button disabled={working || locked} onClick={() => void run(confirmBrowserTransfer)}>
              {t('accountTransferConfirm')}
            </Button>
          ) : null}
          {incoming ? (
            <Button
              disabled={working || locked}
              onClick={() => void run(() => importBrowserSnapshot(incoming, includeChannels))}
            >
              {t(working ? 'accountWorking' : 'accountMigrationConfirm')}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
