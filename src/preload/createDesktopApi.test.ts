import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './createDesktopApi'

describe('createDesktopApi', () => {
  it('exposes only approved application, auth, onboarding, Circle, Vault, and Private AI capabilities', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'app:get-version') return '0.1.0'
      if (channel === 'app:get-platform') return 'win32'
      if (channel === 'auth:check-invitation') return { hasPendingInvite: false, groupName: null, role: null }
      if (channel === 'auth:sign-out' || channel === 'auth:reset-password') return { success: true }
      if (channel === 'auth:request-password-reset') return {
        success: true,
        message: 'If an account exists for that email, a recovery code has been sent.',
        expiresInMinutes: 10,
      }
      if (channel === 'circle:get-overview') return {
        status: 'empty',
        reason: 'no-circles',
        circles: [],
        activeCircleId: null,
        viewerPersonId: null,
        tree: null,
        notifications: [],
      }
      if (channel === 'circle:get-my-circles') return []
      if (channel === 'circle:get-details') return null
      if (channel === 'circle:select') return { success: true }
      if (channel === 'circle:create') return { circleId: 'g-2' }
      if (channel === 'circle:invite-member' || channel === 'circle:resend-invitation') return { outcome: 'sent' }
      if (channel === 'circle:cancel-invitation' || channel === 'circle:remove-member' || channel === 'circle:leave') return { success: true }
      if (channel === 'vault:list') return [{
        id: 5, fileName: 'Family History.pdf', fileType: 'pdf', sizeBytes: 1234,
        extractionStatus: 'ready', indexStatus: 'waiting_for_ai', wordCount: 88,
        preview: 'Family history preview', issue: null, uploadedAt: 99,
        localUserId: 7, sha256: 'private-hash', storedRelativePath: 'vault/users/7/documents/private.pdf',
        sourcePath: 'C:/secret/source.pdf', absolutePath: 'C:/secret/vault/private.pdf', extractedText: 'full private text',
      }]
      if (channel === 'vault:choose-and-upload') return {
        canceled: false,
        items: [{ fileName: 'Family History.pdf', outcome: 'uploaded', documentId: 5, sourcePath: 'C:/secret/source.pdf', sha256: 'private-hash' }],
      }
      if (channel === 'vault:retry-extraction') return {
        id: 5, fileName: 'Family History.pdf', fileType: 'pdf', sizeBytes: 1234,
        extractionStatus: 'ready', indexStatus: 'waiting_for_ai', wordCount: 88,
        preview: 'Family history preview', issue: null, uploadedAt: 99,
        extractedText: 'full private text', storedRelativePath: 'vault/users/7/documents/private.pdf',
      }
      if (channel === 'vault:open' || channel === 'vault:retry-indexing' || channel === 'vault:delete') return { success: true }
      if (channel.startsWith('private-ai:')) return {
        state: 'not_installed', ready: false, repairRequired: false, totalSizeBytes: 123,
        version: '1.0.0', message: 'Private AI is optional',
      }
      return { status: 'unauthenticated' }
    })
    const subscribe = vi.fn(() => () => undefined)
    const api = createDesktopApi(invoke, subscribe)

    expect(Object.keys(api)).toEqual(['app', 'auth', 'onboarding', 'circle', 'vault', 'privateAi'])
    expect(Object.keys(api.app)).toEqual(['getVersion', 'getPlatform'])
    expect(Object.keys(api.auth)).toEqual(['restore', 'signIn', 'checkInvitation', 'register', 'signOut', 'requestPasswordReset', 'resetPassword'])
    expect(Object.keys(api.onboarding)).toEqual(['getState', 'setInitialPassword', 'updateProfile', 'getCircleContext', 'complete'])
    expect(Object.keys(api.circle)).toEqual(['getOverview', 'getMyCircles', 'getCircleDetails', 'selectCircle', 'createCircle', 'inviteMember', 'resendInvitation', 'cancelInvitation', 'removeMember', 'leaveCircle'])
    expect(Object.keys(api.vault)).toEqual(['listDocuments', 'chooseAndUploadDocuments', 'openDocument', 'retryExtraction', 'retryIndexing', 'deleteDocument', 'onUploadProgress'])
    expect(Object.keys(api.privateAi)).toEqual(['getStatus', 'startSetup', 'pauseSetup', 'repair', 'onProgress'])

    const serialized = JSON.stringify(api).toLowerCase()
    expect(serialized).not.toContain('api_key')
    expect(serialized).not.toContain('gettoken')
    expect(serialized).not.toContain('decodetoken')
    expect(serialized).not.toContain('rawfetch')
    expect(serialized).not.toContain('serveruserid')
    expect(serialized).not.toContain('fromuserid')

    await expect(api.app.getVersion()).resolves.toBe('0.1.0')
    await expect(api.app.getPlatform()).resolves.toBe('win32')
    await api.auth.restore()
    expect(invoke).toHaveBeenCalledWith('auth:restore')
    await api.auth.signIn({ email: 'a@example.com', password: '123456789012' })
    expect(invoke).toHaveBeenCalledWith('auth:sign-in', { email: 'a@example.com', password: '123456789012' })
    await api.onboarding.complete('home')
    expect(invoke).toHaveBeenCalledWith('onboarding:complete', 'home')

    await api.circle.getOverview()
    expect(invoke).toHaveBeenCalledWith('circle:get-overview')
    await api.circle.getMyCircles()
    expect(invoke).toHaveBeenCalledWith('circle:get-my-circles')
    await api.circle.getCircleDetails()
    expect(invoke).toHaveBeenCalledWith('circle:get-details')
    await api.circle.selectCircle('g-1')
    expect(invoke).toHaveBeenCalledWith('circle:select', 'g-1')
    await api.circle.createCircle({ name: 'Kasule Family' })
    expect(invoke).toHaveBeenCalledWith('circle:create', { name: 'Kasule Family' })
    await api.circle.inviteMember({ circleId: 'g-1', email: 'relative@example.test', role: 'Sibling' })
    expect(invoke).toHaveBeenCalledWith('circle:invite-member', { circleId: 'g-1', email: 'relative@example.test', role: 'Sibling' })
    await api.circle.resendInvitation({ personId: 'invite:1' })
    expect(invoke).toHaveBeenCalledWith('circle:resend-invitation', { personId: 'invite:1' })
    await api.circle.cancelInvitation({ personId: 'invite:1' })
    expect(invoke).toHaveBeenCalledWith('circle:cancel-invitation', { personId: 'invite:1' })
    await api.circle.removeMember({ personId: 'user:2' })
    expect(invoke).toHaveBeenCalledWith('circle:remove-member', { personId: 'user:2' })
    await api.circle.leaveCircle()
    expect(invoke).toHaveBeenCalledWith('circle:leave')

    const documents = await api.vault.listDocuments()
    expect(invoke).toHaveBeenCalledWith('vault:list')
    expect(documents).toEqual([{
      id: 5, fileName: 'Family History.pdf', fileType: 'pdf', sizeBytes: 1234,
      extractionStatus: 'ready', indexStatus: 'waiting_for_ai', wordCount: 88,
      preview: 'Family history preview', issue: null, uploadedAt: 99,
    }])
    const upload = await api.vault.chooseAndUploadDocuments()
    expect(invoke).toHaveBeenCalledWith('vault:choose-and-upload')
    expect(upload).toEqual({ canceled: false, items: [{ fileName: 'Family History.pdf', outcome: 'uploaded', documentId: 5 }] })
    expect(JSON.stringify(upload)).not.toMatch(/sourcePath|absolutePath|storedRelativePath|sha256|extractedText|localUserId/)
    await api.vault.openDocument({ documentId: 5 })
    expect(invoke).toHaveBeenCalledWith('vault:open', { documentId: 5 })
    const retried = await api.vault.retryExtraction({ documentId: 5 })
    expect(invoke).toHaveBeenCalledWith('vault:retry-extraction', { documentId: 5 })
    expect(JSON.stringify(retried)).not.toMatch(/sourcePath|absolutePath|storedRelativePath|sha256|extractedText|localUserId/)
    await api.vault.retryIndexing({ documentId: 5 })
    expect(invoke).toHaveBeenCalledWith('vault:retry-indexing', { documentId: 5 })
    await api.vault.deleteDocument({ documentId: 5 })
    expect(invoke).toHaveBeenCalledWith('vault:delete', { documentId: 5 })
    await api.privateAi.getStatus()
    expect(invoke).toHaveBeenCalledWith('private-ai:get-status')
  })

  it('subscribes to safe Vault progress and returns the exact unsubscribe function', () => {
    let bridgeListener: ((payload: unknown) => void) | null = null
    const unsubscribe = vi.fn()
    const subscribe = vi.fn((_channel: string, listener: (payload: unknown) => void) => {
      bridgeListener = listener
      return unsubscribe
    })
    const api = createDesktopApi(vi.fn(async () => undefined), subscribe)
    const listener = vi.fn()

    const returned = api.vault.onUploadProgress(listener)
    expect(subscribe).toHaveBeenCalledWith('vault:upload-progress', expect.any(Function))
    expect(returned).toBe(unsubscribe)
    ;(bridgeListener as ((payload: unknown) => void) | null)?.({
      fileIndex: 1, fileCount: 2, fileName: 'Family History.pdf', stage: 'extracting', percent: 70,
      sourcePath: 'C:/secret/source.pdf', absolutePath: 'C:/secret/vault/file.pdf', sha256: 'secret',
      extractedText: 'private full text', localUserId: 7,
    })
    expect(listener).toHaveBeenCalledWith({ fileIndex: 1, fileCount: 2, fileName: 'Family History.pdf', stage: 'extracting', percent: 70 })
  })
})
