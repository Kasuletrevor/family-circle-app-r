import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  BrainCircuit,
  CheckCircle2,
  DatabaseBackup,
  Info,
  KeyRound,
  Pause,
  Save,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { AuthState, AuthUser, DesktopApi } from '../../../shared/desktopApi'
import type { AuthClient } from '../../services/auth/AuthClient'
import { DesktopPrivateAiClient } from '../../services/ai/DesktopPrivateAiClient'
import type { PrivateAiClient, PrivateAiProgress, PrivateAiStatus } from '../../services/ai/PrivateAiClient'
import './SettingsPage.css'

type SettingsDesktopApi = Pick<DesktopApi, 'app' | 'settings'>

interface SettingsPageProps {
  user: AuthUser
  auth: AuthClient
  onAuthStateChange(state: AuthState): void
  privateAi?: PrivateAiClient
  desktop?: SettingsDesktopApi
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function privateAiLabel(status: PrivateAiStatus | null): string {
  switch (status?.state) {
    case 'ready': return 'Ready (Offline)'
    case 'not_installed': return 'Not set up'
    case 'downloading': return 'Downloading'
    case 'paused': return 'Paused'
    case 'verifying': return 'Verifying'
    case 'repair_required': return 'Needs repair'
    case 'failed': return 'Unavailable'
    default: return 'Checking'
  }
}

function platformLabel(platform: NodeJS.Platform | null): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform ?? 'Unknown'
}

export function SettingsPage({
  user,
  auth,
  onAuthStateChange,
  privateAi,
  desktop = window.familyCircle,
}: SettingsPageProps) {
  const privateAiClient = useMemo(() => privateAi ?? new DesktopPrivateAiClient(), [privateAi])
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
  const [aiProgress, setAiProgress] = useState<PrivateAiProgress | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  const [appVersion, setAppVersion] = useState<string>('…')
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)

  useEffect(() => {
    setName(user.name ?? '')
  }, [user.name])

  useEffect(() => {
    let active = true
    void privateAiClient.getStatus()
      .then((status) => {
        if (active) setAiStatus(status)
      })
      .catch((error: unknown) => {
        if (active) setAiError(error instanceof Error ? error.message : 'Could not read Private AI status.')
      })

    let unsubscribe = () => {}
    try {
      unsubscribe = privateAiClient.onProgress((progress) => {
        if (!active) return
        setAiProgress(progress)
        setAiStatus((current) => current ? {
          ...current,
          state: progress.state,
          ready: progress.state === 'ready',
          repairRequired: progress.state === 'repair_required',
          message: progress.message,
        } : current)
      })
    } catch {
      // The status request above remains the authoritative fallback.
    }

    return () => {
      active = false
      unsubscribe()
    }
  }, [privateAiClient])

  useEffect(() => {
    let active = true
    void Promise.all([desktop.app.getVersion(), desktop.app.getPlatform()])
      .then(([version, nextPlatform]) => {
        if (!active) return
        setAppVersion(version)
        setPlatform(nextPlatform)
      })
      .catch(() => {
        if (active) setAppVersion('Unknown')
      })
    return () => { active = false }
  }, [desktop])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileBusy(true)
    setProfileError(null)
    setProfileMessage(null)
    try {
      const state = await auth.updateProfile(name)
      onAuthStateChange(state)
      setProfileMessage('Profile updated.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not update your profile.')
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordMessage(null)
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword.length < 12) {
      setPasswordError('Use at least 12 characters for your new password.')
      return
    }

    setPasswordBusy(true)
    try {
      const state = await auth.changePassword({ currentPassword, newPassword })
      onAuthStateChange(state)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed. This protected session has been refreshed.')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Could not change your password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  async function startOrResumePrivateAi() {
    setAiBusy(true)
    setAiError(null)
    try {
      const status = await privateAiClient.startSetup()
      setAiStatus(status)
      setAiProgress(null)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Private AI setup failed.')
    } finally {
      setAiBusy(false)
    }
  }

  async function pausePrivateAi() {
    setAiBusy(true)
    setAiError(null)
    try {
      setAiStatus(await privateAiClient.pauseSetup())
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Could not pause Private AI setup.')
    } finally {
      setAiBusy(false)
    }
  }

  async function repairPrivateAi() {
    setAiBusy(true)
    setAiError(null)
    try {
      const status = await privateAiClient.repair()
      setAiStatus(status)
      setAiProgress(null)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Could not repair Private AI.')
    } finally {
      setAiBusy(false)
    }
  }

  async function createBackup() {
    setBackupBusy(true)
    setBackupMessage(null)
    setBackupError(null)
    try {
      const result = await desktop.settings.createBackup()
      if (!result.canceled && result.folderName) {
        setBackupMessage(`Backup created: ${result.folderName}`)
      }
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Could not create the backup.')
    } finally {
      setBackupBusy(false)
    }
  }

  const aiPercent = aiProgress ? Math.max(0, Math.min(100, aiProgress.percent)) : null

  return (
    <section className="settings-page">
      <header className="settings-header">
        <span className="settings-eyebrow">This device</span>
        <h1>Settings</h1>
        <p>Manage your account, local privacy, Private AI and Family Circle on this computer.</p>
      </header>

      <div className="settings-grid">
        <article className="settings-card">
          <div className="settings-card__heading">
            <span className="settings-card__icon"><UserRound size={20} /></span>
            <div><h2>Profile</h2><p>The name your family sees in this app.</p></div>
          </div>
          <form className="settings-form" onSubmit={(event) => void saveProfile(event)}>
            <label>
              <span>Name</span>
              <input value={name} minLength={2} onChange={(event) => setName(event.currentTarget.value)} required />
            </label>
            <label>
              <span>Email</span>
              <input value={user.email} readOnly aria-readonly="true" />
              <small>Email is tied to your Family Circle identity and cannot be changed here.</small>
            </label>
            <div className="settings-actions">
              <button className="settings-button settings-button--primary" type="submit" disabled={profileBusy || name.trim() === (user.name ?? '').trim()}>
                <Save size={15} /> {profileBusy ? 'Saving…' : 'Save profile'}
              </button>
            </div>
            {profileMessage ? <p className="settings-notice" role="status"><CheckCircle2 size={15} /> {profileMessage}</p> : null}
            {profileError ? <p className="settings-error" role="alert">{profileError}</p> : null}
          </form>
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <span className="settings-card__icon"><ShieldCheck size={20} /></span>
            <div><h2>Password & security</h2><p>Changing your password invalidates older protected sessions.</p></div>
          </div>
          <form className="settings-form" onSubmit={(event) => void changePassword(event)}>
            <label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} required /></label>
            <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} required /></label>
            <label><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} required /></label>
            <div className="settings-actions">
              <button className="settings-button settings-button--secondary" type="submit" disabled={passwordBusy}>
                <KeyRound size={15} /> {passwordBusy ? 'Changing…' : 'Change password'}
              </button>
            </div>
            {passwordMessage ? <p className="settings-notice" role="status"><CheckCircle2 size={15} /> {passwordMessage}</p> : null}
            {passwordError ? <p className="settings-error" role="alert">{passwordError}</p> : null}
          </form>
        </article>

        <article className="settings-card settings-card--wide">
          <div className="settings-card__heading">
            <span className="settings-card__icon"><BrainCircuit size={20} /></span>
            <div><h2>Private AI</h2><p>Optional local AI assets run on this computer after setup.</p></div>
            <span className={`settings-status settings-status--${aiStatus?.state ?? 'checking'}`}>{privateAiLabel(aiStatus)}</span>
          </div>
          <div className="settings-ai-meta">
            <span><strong>Asset version</strong>{aiStatus?.version || 'Checking…'}</span>
            <span><strong>Download size</strong>{aiStatus ? formatBytes(aiStatus.totalSizeBytes) : 'Checking…'}</span>
            <span><strong>Privacy</strong>Runs locally after setup</span>
          </div>
          {aiPercent != null && (aiStatus?.state === 'downloading' || aiStatus?.state === 'verifying') ? (
            <div className="settings-progress" role="status" aria-live="polite">
              <div><span>{aiProgress?.message ?? 'Preparing Private AI'}</span><strong>{Math.round(aiPercent)}%</strong></div>
              <div className="settings-progress__meter"><span style={{ width: `${aiPercent}%` }} /></div>
              {aiProgress?.totalSizeBytes ? <small>{formatBytes(aiProgress.bytesDownloaded)} of {formatBytes(aiProgress.totalSizeBytes)}</small> : null}
            </div>
          ) : null}
          <div className="settings-actions">
            {aiStatus?.state === 'not_installed' || aiStatus?.state === 'paused' || aiStatus?.state === 'failed' ? (
              <button className="settings-button settings-button--primary" type="button" disabled={aiBusy} onClick={() => void startOrResumePrivateAi()}>
                <BrainCircuit size={15} /> {aiStatus?.state === 'paused' ? 'Continue setup' : 'Set up Private AI'}
              </button>
            ) : null}
            {aiStatus?.state === 'downloading' ? (
              <button className="settings-button settings-button--secondary" type="button" disabled={aiBusy} onClick={() => void pausePrivateAi()}>
                <Pause size={15} /> Pause download
              </button>
            ) : null}
            {aiStatus?.state === 'repair_required' ? (
              <button className="settings-button settings-button--secondary" type="button" disabled={aiBusy} onClick={() => void repairPrivateAi()}>
                <Wrench size={15} /> Repair Private AI
              </button>
            ) : null}
          </div>
          {aiStatus?.message ? <p className="settings-detail">{aiStatus.message}</p> : null}
          {aiError ? <p className="settings-error" role="alert">{aiError}</p> : null}
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <span className="settings-card__icon"><DatabaseBackup size={20} /></span>
            <div><h2>Local data backup</h2><p>Create a portable copy of your local Family Circle data.</p></div>
          </div>
          <div className="settings-copy">
            <p>The backup includes your Family Circle database, Vault documents and Story media.</p>
            <p>Private AI model files and your protected session credential are deliberately excluded.</p>
          </div>
          <div className="settings-actions">
            <button className="settings-button settings-button--secondary" type="button" disabled={backupBusy} onClick={() => void createBackup()}>
              <DatabaseBackup size={15} /> {backupBusy ? 'Creating backup…' : 'Create backup'}
            </button>
          </div>
          {backupMessage ? <p className="settings-notice" role="status"><CheckCircle2 size={15} /> {backupMessage}</p> : null}
          {backupError ? <p className="settings-error" role="alert">{backupError}</p> : null}
        </article>

        <article className="settings-card">
          <div className="settings-card__heading">
            <span className="settings-card__icon"><Info size={20} /></span>
            <div><h2>About Family Circle</h2><p>Installed application information.</p></div>
          </div>
          <dl className="settings-about">
            <div><dt>Version</dt><dd>{appVersion === '…' ? appVersion : `v${appVersion}`}</dd></div>
            <div><dt>Platform</dt><dd>{platformLabel(platform)}</dd></div>
            <div><dt>Privacy model</dt><dd>Private by design</dd></div>
          </dl>
        </article>
      </div>
    </section>
  )
}
