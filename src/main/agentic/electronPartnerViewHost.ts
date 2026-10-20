import { type BrowserWindow, session, shell, WebContentsView } from 'electron'
import type { PartnerServiceKey } from '../../shared/agentic'
import { decideNavigation } from './partnerServices'
import type { PartnerViewsHost } from './PartnerViews'

const ABORTED = -3
const lockedPartitions = new Set<string>()

/** Partner sites get no camera, microphone, notifications, location or downloads. */
function lockDownSession(partition: string) {
  if (lockedPartitions.has(partition)) return
  lockedPartitions.add(partition)
  const partnerSession = session.fromPartition(partition)
  partnerSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  partnerSession.setPermissionCheckHandler(() => false)
  partnerSession.on('will-download', (event) => event.preventDefault())
}

function openHttpsExternally(url: string) {
  if (url.startsWith('https://')) void shell.openExternal(url)
}

/** Embeds sandboxed partner pages in the main window, with no bridge to Family Circle. */
export function createElectronPartnerViewHost(window: BrowserWindow): PartnerViewsHost {
  return {
    createView(service: PartnerServiceKey, partition, onStatus, intercept) {
      lockDownSession(partition)
      const view = new WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      })
      const contents = view.webContents
      const canGoBack = () => contents.navigationHistory.canGoBack()
      let failed = false

      const guard = (event: { preventDefault(): void }, url: string) => {
        if (intercept(url)) {
          event.preventDefault()
          return
        }
        const decision = decideNavigation(service, url)
        if (decision === 'allow') return
        event.preventDefault()
        if (decision === 'external') openHttpsExternally(url)
      }
      contents.on('will-navigate', (event) => guard(event, event.url))
      contents.on('will-redirect', (event) => guard(event, event.url))
      contents.setWindowOpenHandler(({ url }) => {
        if (intercept(url)) return { action: 'deny' }
        const decision = decideNavigation(service, url)
        if (decision === 'allow') void contents.loadURL(url).catch(() => undefined)
        else if (decision === 'external') openHttpsExternally(url)
        return { action: 'deny' }
      })
      contents.on('did-start-loading', () => {
        failed = false
        onStatus('loading', canGoBack())
      })
      contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === ABORTED) return
        failed = true
        onStatus('failed', canGoBack())
      })
      contents.on('did-stop-loading', () => { if (!failed) onStatus('ready', canGoBack()) })
      contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        // A client-side route change cannot be stopped, but its address is still handled.
        if (isMainFrame) intercept(url)
        onStatus('ready', canGoBack())
      })
      contents.on('render-process-gone', () => onStatus('failed', false))

      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      view.setVisible(false)
      window.contentView.addChildView(view)

      return {
        load: (url) => { void contents.loadURL(url).catch(() => undefined) },
        setBounds: (bounds) => view.setBounds(bounds),
        setVisible: (visible) => view.setVisible(visible),
        goBack: () => { if (canGoBack()) contents.navigationHistory.goBack() },
        currentUrl: () => contents.getURL(),
        destroy: () => {
          if (!window.isDestroyed()) window.contentView.removeChildView(view)
          if (!contents.isDestroyed()) contents.close()
        },
      }
    },
    openExternal: openHttpsExternally,
    contentSize() {
      const [width = 0, height = 0] = window.getContentSize()
      return { width, height }
    },
  }
}
