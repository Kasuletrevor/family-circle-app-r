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
  }) {}

  async open(service: PartnerServiceKey, target?: PartnerViewTarget): Promise<void> {
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
      const handle = this.deps.host.createView(service, partitionFor(service, account), (state, canGoBack) => {
        this.deps.emit({ service, state, canGoBack })
      })
      view = { handle, requestedUrl: '' }
      this.views.set(service, view)
      target ??= { kind: 'start' }
    }
    if (target) {
      view.requestedUrl = targetUrl(service, target)
      view.handle.load(view.requestedUrl)
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

  destroyAll(): void {
    this.generation += 1
    for (const view of this.views.values()) view.handle.destroy()
    this.views.clear()
  }
}
