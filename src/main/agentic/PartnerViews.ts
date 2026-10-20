import type {
  PartnerServiceKey,
  PartnerViewBounds,
  PartnerViewCommand,
  PartnerViewState,
  PartnerViewStatus,
  PartnerViewTarget,
} from '../../shared/agentic'
import { clampBounds, decideNavigation, partitionFor, PARTNER_SERVICES, targetUrl } from './partnerServices'

export interface PartnerViewHandle {
  load(url: string): void
  setBounds(bounds: PartnerViewBounds): void
  setVisible(visible: boolean): void
  goBack(): void
  currentUrl(): string
  destroy(): void
}

export interface PartnerViewsHost {
  createView(
    service: PartnerServiceKey,
    partition: string,
    onStatus: (state: PartnerViewState, canGoBack: boolean) => void,
    /** Asked about every main-frame navigation; true means it was handled and must not go ahead. */
    intercept: (url: string) => boolean,
  ): PartnerViewHandle
  openExternal(url: string): void
  contentSize(): { width: number; height: number }
}

interface OpenView { handle: PartnerViewHandle; requestedUrl: string }

/** One isolated partner web view per service, for the signed-in Family Circle account. */
export class PartnerViews {
  private readonly views = new Map<PartnerServiceKey, OpenView>()
  private account: string | null = null
  /** Bumped by destroyAll(), so opens that started earlier are dropped. */
  private generation = 0

  constructor(private readonly deps: {
    host: PartnerViewsHost
    accountKey(): Promise<string | null>
    emit(status: PartnerViewStatus): void
    /** Takes navigations Family Circle handles itself, such as the end of a Kin-Keepers.ai connection. */
    interceptNavigation?(service: PartnerServiceKey, url: string): boolean
  }) {}

  async open(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void> {
    await this.show(service, target ? targetUrl(service, target) : undefined)
  }

  /** Opens an address built in the main process, such as the connect page; only the service's own hosts. */
  async openPage(service: PartnerServiceKey, url: string): Promise<void> {
    if (decideNavigation(service, url) !== 'allow') throw new Error('Not a partner page')
    await this.show(service, url)
  }

  private async show(service: PartnerServiceKey, url: string | undefined): Promise<void> {
    const generation = this.generation
    const account = await this.deps.accountKey()
    // Sign-out closed everything while the account was being checked; this open belongs to the old session.
    if (generation !== this.generation) return
    if (!account) throw new Error('Sign in to Family Circle first')
    if (account !== this.account) {
      // Partner sign-ins belong to one Family Circle account; never show them to another.
      this.destroyAll()
      this.account = account
    }
    let view = this.views.get(service)
    if (!view) {
      const handle = this.deps.host.createView(
        service,
        partitionFor(service, account),
        (state, canGoBack) => this.deps.emit({ service, state, canGoBack }),
        (address) => this.intercept(service, address),
      )
      view = { handle, requestedUrl: '' }
      this.views.set(service, view)
      url ??= PARTNER_SERVICES[service].startUrl
    }
    if (url) {
      view.requestedUrl = url
      view.handle.load(url)
    }
    for (const [key, other] of this.views) other.handle.setVisible(key === service)
  }

  setBounds(service: PartnerServiceKey, bounds: unknown): void {
    const clamped = clampBounds(bounds, this.deps.host.contentSize())
    this.views.get(service)?.handle.setBounds(clamped)
  }

  hide(service: PartnerServiceKey): void {
    this.views.get(service)?.handle.setVisible(false)
  }

  command(service: PartnerServiceKey, command: PartnerViewCommand): void {
    const view = this.views.get(service)
    if (!view) return
    const current = view.handle.currentUrl()
    // A failed load leaves an error page as the current URL; fall back to the page that was asked for.
    const page = decideNavigation(service, current) === 'allow'
      ? current
      : view.requestedUrl || PARTNER_SERVICES[service].startUrl
    if (command === 'back') view.handle.goBack()
    else if (command === 'reload') view.handle.load(page)
    else this.deps.host.openExternal(page)
  }

  private intercept(service: PartnerServiceKey, url: string): boolean {
    if (!this.deps.interceptNavigation?.(service, url)) return false
    // Leave the handled page once the navigation event is over.
    queueMicrotask(() => {
      const view = this.views.get(service)
      if (!view) return
      view.requestedUrl = PARTNER_SERVICES[service].startUrl
      view.handle.load(view.requestedUrl)
    })
    return true
  }

  destroyAll(): void {
    this.generation += 1
    for (const view of this.views.values()) view.handle.destroy()
    this.views.clear()
  }
}
