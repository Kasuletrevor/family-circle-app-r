import { describe, expect, it } from 'vitest'
import { clampBounds, decideNavigation, partitionFor, targetUrl } from './partnerServices'

describe('decideNavigation', () => {
  it('allows only the service hosts over HTTPS', () => {
    expect(decideNavigation('guardian-angel', 'https://kin-keepers.ai/templates/7')).toBe('allow')
    expect(decideNavigation('marketplace', 'https://www.kin-keepers.ai/')).toBe('allow')
    expect(decideNavigation('ubercare', 'https://remotecarers.net/worker/login')).toBe('allow')
  })

  it('sends other HTTPS sites to the browser', () => {
    expect(decideNavigation('ubercare', 'https://kin-keepers.ai/')).toBe('external')
    expect(decideNavigation('guardian-angel', 'https://kin-keepers.ai.evil.test/')).toBe('external')
    expect(decideNavigation('guardian-angel', 'https://evil.test/?kin-keepers.ai')).toBe('external')
  })

  it('blocks everything that is not HTTPS', () => {
    for (const url of ['http://kin-keepers.ai/', 'file:///C:/Windows', 'javascript:alert(1)', 'mailto:a@b.c', 'not a url', 'https://user:pw@kin-keepers.ai/']) {
      expect(decideNavigation('guardian-angel', url)).toBe('block')
    }
  })
})

describe('targetUrl', () => {
  it('builds the template, Care Builder and start pages', () => {
    expect(targetUrl('guardian-angel', { kind: 'template', templateId: '7' })).toBe('https://kin-keepers.ai/templates/7')
    expect(targetUrl('guardian-angel', { kind: 'care-builder' })).toBe('https://kin-keepers.ai/care-builder')
    expect(targetUrl('ubercare', { kind: 'start' })).toBe('https://remotecarers.net/worker/')
  })

  it('refuses bad template ids and templates outside Guardian Angel', () => {
    expect(() => targetUrl('guardian-angel', { kind: 'template', templateId: '../admin' })).toThrow()
    expect(() => targetUrl('ubercare', { kind: 'template', templateId: '7' })).toThrow()
    expect(() => targetUrl('ubercare', { kind: 'care-builder' })).toThrow()
  })

  it('builds the settings and test pages of an own angel', () => {
    expect(targetUrl('guardian-angel', { kind: 'angel', angelId: '12', page: 'edit' })).toBe('https://kin-keepers.ai/agents/12/edit')
    expect(targetUrl('guardian-angel', { kind: 'angel', angelId: '12', page: 'run' })).toBe('https://kin-keepers.ai/agents/12/run')
    expect(() => targetUrl('guardian-angel', { kind: 'angel', angelId: '1/../2', page: 'edit' })).toThrow()
    expect(() => targetUrl('guardian-angel', { kind: 'angel', angelId: '12', page: 'delete' as never })).toThrow()
    expect(() => targetUrl('ubercare', { kind: 'angel', angelId: '12', page: 'edit' })).toThrow()
  })
})

describe('clampBounds', () => {
  const content = { width: 1200, height: 800 }
  it('rounds and keeps the view inside the window', () => {
    expect(clampBounds({ x: 10.4, y: 20.6, width: 2000, height: 900 }, content)).toEqual({ x: 10, y: 21, width: 1190, height: 779 })
    expect(clampBounds({ x: -5, y: -5, width: 100, height: 100 }, content)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('refuses missing or non-numeric values', () => {
    expect(() => clampBounds({ x: 'a', y: 0, width: 1, height: 1 }, content)).toThrow()
    expect(() => clampBounds({ x: Number.NaN, y: 0, width: 1, height: 1 }, content)).toThrow()
    expect(() => clampBounds(null, content)).toThrow()
  })
})

describe('partitionFor', () => {
  it('shares one Kin-Keepers session per account and keeps UberCare apart', () => {
    expect(partitionFor('guardian-angel', 'abc')).toBe('persist:agentic-kin-keepers-abc')
    expect(partitionFor('marketplace', 'abc')).toBe('persist:agentic-kin-keepers-abc')
    expect(partitionFor('ubercare', 'abc')).toBe('persist:agentic-ubercare-abc')
  })
})
