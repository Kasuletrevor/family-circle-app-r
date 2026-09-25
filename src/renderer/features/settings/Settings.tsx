import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Bot,
  DatabaseBackup,
  FolderOpen,
  Info,
  KeyRound,
  Pause,
  Play,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { AuthState, AuthUser, DesktopApi } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'
import { DesktopAuthClient } from '../../services/auth/DesktopAuthClient'
import { DesktopPrivateAiClient } from '../../services/ai/DesktopPrivateAiClient'
import type { PrivateAiClient, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import './Settings.css'

type AppSettingsClient = Pick<DesktopApi['app'], 'getVersion' | 'getPlatform' | 'createDatabaseBackup' | 'openDataFolder'>

interface SettingsProps {
  user: AuthUser
  authClient?: AuthClient
  privateAiClient?: PrivateAiClient
  appClient?: AppSettingsClient
  onAuthStateChange?: (state: AuthState) => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function aiStateLabel(status: PrivateAiStatus | null): string {
  if (!status) return 'Checking…'
  switch (status.state) {
    case 'ready': return 'Ready (Offline)'
    case 'not_installed': return 'Not set up'
    case 'downloading': return 'Downloading…'
    case 'paused': return 'Paused'
    case 'verifying': return 'Verifying…'
    case 'repair_required': return 'Needs repair'
    case 'failed': return 'Unavailable'
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function Settings({
  user,
  authClient,
  privateAiClient,
  appClient,
  onAuthStateChange,
}: SettingsProps) {
  const auth = useMemo(() => authClient ?? new DesktopAuthClient(window.familyCircle), [authClient])
  const privateAi = useMemo(() => privateAiClient ?? new DesktopPrivateAiClient(), [privateAiClient])
  const app = appClient ?? window.familyCircle.app

  const [name, setName] = useState(user.name ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [aiStatus, setAiStatus] = useState<PrivateAiStatus | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [confirmRemoveAi, setConfirmRemoveAi] = useState(false)

  const [version, setVersion] = useState('…')
  const [platform, setPlatform] = useState('…')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  useEffect(() => {
    setName(user.name ?? '')
  }, [user.name])

  useEffect(() => {
    let active = true
    void privateAi.getStatus()
      .then((status) => { if (active) setAiStatus(status) })
      .catch(() => { if (active) setAiError('Could not read Private AI status.') })

    let unsubscribe = () => undefined
    try {
      unsubscribe = privateAi.onProgress((progress) => {
        if (!active) return
        setAiStatus((current) => ({
          state: progress.state,
          ready: progress.state === 'ready',
          repairRequired: progress.state === 'repair_required',
          totalSizeBytes: progress.totalSizeBytes || current?.totalSizeBytes || 0,
          version: current?.version ?? '',
          message: progress.message,
        }))
      })
    } catch {
      // The status request still provides a useful fallback if progress events are unavailable.
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [privateAi])

  useEffect(() => {
    let active = true
    void Promise.all([app.getVersion(), app.getPlatform()])
      .then(([appVersion, appPlatform]) => {
        if (!active) return
        setVersion(appVersion)
        setPlatform(appPlatform)
      })
      .catch(() => {
        if (!active) return
        setVersion('Unavailable')
        setPlatform('Unavailable')
      })
    return () => { active = false }
  }, [app])

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setProfileBusy(true)
    setProfileError(null)
    setProfileMessage(null)
    try {
      const state = await auth.updateProfile(name)
      onAuthStateChange?.(state)
      if (state.status !== 'unauthenticated') setName(state.user.name ?? '')
      setProfileMessage('Profile updated.')
    } catch (error) {
      setProfileError(messageOf(error, 'Could not update your profile.'))
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPasswordError(null)
    setPasswordMessage(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword.length < 12 || newPassword.length > 72) {
      setPasswordError('Password must be between 12 and 72 characters.')
      return
    }

    setPasswordBusy(true)
    try {
      const state = await auth.changePassword({ currentPassword, newPassword })
      onAuthStateChange?.(state)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed. This device now uses a fresh protected session.')
    } catch (error) {
      setPasswordError(messageOf(error, 'Could not change your password.'))
    } finally {
      setPasswordBusy(false)
    }
  }

  async function runAiAction(action: 'setup' | 'pause' | 'repair' | 'remove') {
    setAiBusy(true)
    setAiError(null)
    try {
      const status = action === 'setup'
        ? await privateAi.startSetup()
        : action === 'pause'
          ? await privateAi.pauseSetup()
          : action === 'repair'
            ? await privateAi.repair()
            : await privateAi.remove()
      setAiStatus(status)
      if (action === 'remove') setConfirmRemoveAi(false)
    } catch (error) {
      setAiError(messageOf(error, 'Private AI action failed.'))
    } finally {
      setAiBusy(false)
    }
  }

  async function createBackup() {
    setBackupBusy(true)
    setBackupError(null)
    setBackupMessage(null)
    try {
      const result = await app.createDatabaseBackup()
      if (!result.canceled) {
        setBackupMessage(`Database backup saved as ${result.fileName}.`)
      }
    } catch (error) {
      setBackupError(messageOf(error, 'Could not create a database backup.'))
    } finally {
      setBackupBusy(false)
    }
  }

  async function openDataFolder() {
    setBackupError(null)
    try {
      await app.openDataFolder()
    } catch (error) {
      setBackupError(messageOf(error, 'Could not open the Family Circle data folder.'))
    }
  }

  const aiState = aiStatus?.state ?? null
  const canPauseAi = aiState === 'downloading' || aiState === 'verifying'
  const canSetupAi = aiState === 'not_installed' || aiState === 'paused' || aiState === 'failed'
  const canRepairAi = aiState === 'repair_required' || aiState === 'failed'
  const canRemoveAi = aiState !== null && aiState !== 'not_installed' && !canPauseAi

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <header className="settings-page__header">
        <div>
          <span className="settings-page__eyebrow">This device & your account</span>
          <h1 id="settings-title">Settings</h1>
          <p>Manage your identity, security, Private AI, and local Family Circle data.</p>
        </div>
      </header>

      <div className="settings-grid">
        <article className="settings-card">
          <div className="settings-card__heading">
            <UserRound size={19} aria-hidden="true" />
            <div><h2>Profile</h2><p>How you appear inside Family Circle.</p></div>
          </div>
          <form onSubmit={saveProfile} className="settings-form">
            <label>
              <span>Display name</span>
              <input value={name} minLength={2} maxLength={100} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              <span>Email</span>
              <input value={user.email} readOnly aria-readonly="true" />
              <small>Your sign-in email is tied to your Family Circle identity.</small>
            </label>
            <button className="settings-button settings-button--primary" type="submit" disabled={profileBusy || name.trim() === (user.name ?? '').trim()}>
              <Save size={16} aria-hidden="true" /> {profileBusy ? 'Saving…' : 'Save profile'}
            </button>
            {profileMessage ? <p className="settings-feedback settings-feedback--success" role="status">{profileMessage}</p> : null}
            {profileError ? <p className="settings-feedback settings-feedback--error" role="alert">{profileError}</p> : null}
          </form>
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div><h2>Password & security</h2><p>Change the password protecting this account.</p></div>
          </div>
          <form onSubmit={changePassword} className="settings-form">
            <label>
              <span>Current password</span>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </label>
            <label>
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </label>
            <button className="settings-button settings-button--primary" type="submit" disabled={passwordBusy}>
              <KeyRound size={16} aria-hidden="true" /> {passwordBusy ? 'Changing…' : 'Change password'}
            </button>
            {passwordMessage ? <p className="settings-feedback settings-feedback--success" role="status">{passwordMessage}</p> : null}
            {passwordError ? <p className="settings-feedback settings-feedback--error" role="alert">{passwordError}</p> : null}
          </form>
        </article>

        <article className="settings-card settings-card--wide">
          <div className="settings-card__heading">
            <Bot size={19} aria-hidden="true" />
            <div><h2>Private AI</h2><p>Manage the local AI runtime and models stored on this computer.</p></div>
          </div>
          <div className="settings-ai">
            <div className="settings-ai__status">
              <div>
                <span className={`settings-status-dot${aiStatus?.ready ? ' settings-status-dot--ready' : ''}`} aria-hidden="true" />
                <strong>{aiStateLabel(aiStatus)}</strong>
              </div>
              <dl>
                <div><dt>AI pack</dt><dd>{aiStatus?.version || '—'}</dd></div>
                <div><dt>Download size</dt><dd>{formatBytes(aiStatus?.totalSizeBytes ?? 0)}</dd></div>
              </dl>
              {aiStatus?.message ? <p>{aiStatus.message}</p> : null}
            </div>
            <div className="settings-actions">
              {canSetupAi ? (
                <button className="settings-button settings-button--primary" type="button" disabled={aiBusy} onClick={() => void runAiAction('setup')}>
                  <Play size={16} aria-hidden="true" /> {aiState === 'paused' ? 'Continue setup' : 'Set up Private AI'}
                </button>
              ) : null}
              {canPauseAi ? (
                <button className="settings-button" type="button" disabled={aiBusy} onClick={() => void runAiAction('pause')}>
                  <Pause size={16} aria-hidden="true" /> Pause download
                </button>
              ) : null}
              {canRepairAi ? (
                <button className="settings-button" type="button" disabled={aiBusy} onClick={() => void runAiAction('repair')}>
                  <Wrench size={16} aria-hidden="true" /> Repair
                </button>
              ) : null}
              {canRemoveAi && !confirmRemoveAi ? (
                <button className="settings-button settings-button--danger-quiet" type="button" disabled={aiBusy} onClick={() => setConfirmRemoveAi(true)}>
                  <Trash2 size={16} aria-hidden="true" /> Remove Private AI
                </button>
              ) : null}
              {confirmRemoveAi ? (
                <>
                  <button className="settings-button settings-button--danger" type="button" disabled={aiBusy} onClick={() => void runAiAction('remove')}>
                    Remove downloaded AI files
                  </button>
                  <button className="settings-button" type="button" disabled={aiBusy} onClick={() => setConfirmRemoveAi(false)}>Cancel</button>
                </>
              ) : null}
            </div>
          </div>
          {aiError ? <p className="settings-feedback settings-feedback--error" role="alert">{aiError}</p> : null}
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <DatabaseBackup size={19} aria-hidden="true" />
            <div><h2>Local data</h2><p>Back up the local Family Circle database on this computer.</p></div>
          </div>
          <p className="settings-card__note">The database backup includes local account and structured Family Circle data. Vault documents and Story media remain in the app data folder and are not included in this database file.</p>
          <div className="settings-actions settings-actions--stack">
            <button className="settings-button settings-button--primary" type="button" disabled={backupBusy} onClick={() => void createBackup()}>
              <DatabaseBackup size={16} aria-hidden="true" /> {backupBusy ? 'Creating backup…' : 'Create database backup'}
            </button>
            <button className="settings-button" type="button" onClick={() => void openDataFolder()}>
              <FolderOpen size={16} aria-hidden="true" /> Open app data folder
            </button>
          </div>
          {backupMessage ? <p className="settings-feedback settings-feedback--success" role="status">{backupMessage}</p> : null}
          {backupError ? <p className="settings-feedback settings-feedback--error" role="alert">{backupError}</p> : null}
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <Info size={19} aria-hidden="true" />
            <div><h2>About Family Circle</h2><p>Installed application information.</p></div>
          </div>
          <dl className="settings-about">
            <div><dt>Version</dt><dd>{version}</dd></div>
            <div><dt>Platform</dt><dd>{platform}</dd></div>
            <div><dt>Privacy</dt><dd>Private by design</dd></div>
          </dl>
          <p className="settings-card__note">Private AI runs locally after setup. Heavy AI model files are downloaded separately and are not bundled into the installer.</p>
        </article>
      </div>
    </section>
  )
}
