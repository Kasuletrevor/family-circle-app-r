import { useEffect, useState } from 'react'

const OVERLAY = '[role="menu"], [role="dialog"]'

/**
 * True while a menu or dialog is open anywhere in the app. Partner web views are drawn
 * above the page, so they hide while one is open.
 */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => document.querySelector(OVERLAY) !== null)
  useEffect(() => {
    const check = () => setOpen(document.querySelector(OVERLAY) !== null)
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] })
    check()
    return () => observer.disconnect()
  }, [])
  return open
}
