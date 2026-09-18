import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const workflow = readFileSync(resolve(root, '.github/workflows/windows-package.yml'), 'utf8')
const publisher = readFileSync(resolve(root, 'scripts/publish-demo-release.sh'), 'utf8')

describe('demo server publish contract', () => {
  it('publishes verified main builds to the existing demo release root', () => {
    expect(workflow).toContain("github.ref == 'refs/heads/main'")
    expect(workflow).toContain('needs: package')
    expect(workflow).toContain('actions/download-artifact@v8')
    expect(workflow).toContain('DEV_SSH_HOST')
    expect(workflow).toContain('DEV_SSH_USER')
    expect(workflow).toContain('DEV_SSH_PASSWORD')
    expect(workflow).toContain('/var/www/family-circle-prod/electron-releases/demo')
    expect(workflow).toContain('scripts/publish-demo-release.sh')
    expect(workflow).toContain('https://familycircle.o2gventures.com')
    expect(workflow).toContain('/electron-releases/demo/latest/')
  })

  it('checks the staged installer and updates the stable release atomically', () => {
    expect(publisher).toContain('sha256sum "$SOURCE"')
    expect(publisher).toContain('Staged installer checksum mismatch')
    expect(publisher).toContain('mv -Tf "$NEXT_LINK" "$ROOT/latest"')
    expect(publisher).toContain('"sha256": "$EXPECTED_SHA"')
    expect(publisher).toContain('versions.json')
  })
})
