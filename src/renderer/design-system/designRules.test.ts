import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(__dirname, '..')
const MIN_TEXT_PX = 13

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? cssFiles(full) : name.endsWith('.css') ? [full] : []
  })
}

const sheets = cssFiles(rendererRoot).map((file) => ({ file: relative(rendererRoot, file), css: readFileSync(file, 'utf8') }))

describe('renderer design rules', () => {
  it('uses the accent tokens instead of the old teal colours', () => {
    const teal = /#0e9f9a|#0c6f70|#e9fbf6|#7ce4df|#8ee5dc|#22b8b1|rgba\(\s*14\s*,\s*159\s*,\s*154|--kk-teal|--kk-mint/i
    expect(sheets.filter(({ css }) => teal.test(css)).map(({ file }) => file)).toEqual([])
  })

  it('keeps readable text at 13px or larger', () => {
    const tooSmall: string[] = []
    for (const { file, css } of sheets) {
      for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        // SVG text in the Family Tree drawing scales with zoom; count bubbles hold digits only.
        if (/(^|[;\s])fill\s*:/.test(body!) || /notification-count|__badge/.test(selector!)) continue
        for (const [, value, unit] of body!.matchAll(/font-size:\s*([0-9.]+)(px|rem)/g)) {
          const px = unit === 'rem' ? Number(value) * 16 : Number(value)
          if (px < MIN_TEXT_PX) tooSmall.push(`${file}: ${selector!.trim()} (${value}${unit})`)
        }
      }
    }
    expect(tooSmall).toEqual([])
  })

  it('keeps every sidebar link reachable in the shortest supported window', () => {
    const appCss = sheets.find(({ file }) => file.replace(/\\/g, '/') === 'app/App.css')!.css
    const nav = appCss.match(/\.app-sidebar__nav \{([^}]*)\}/)![1]!
    expect(nav).toMatch(/overflow-y:\s*auto/)
    expect(appCss).toMatch(/\.sidebar-link \{[^}]*flex-shrink:\s*0/)
    expect(appCss).toMatch(/@media \(max-height: 760px\)/)
  })
})
