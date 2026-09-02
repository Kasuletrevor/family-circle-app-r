import { describe, expect, it } from 'vitest'
import { createWindowOptions } from './windowOptions'

describe('createWindowOptions', () => {
  it('keeps renderer privileges disabled', () => {
    const options = createWindowOptions('C:/app/preload.js')
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
    expect(options.webPreferences?.sandbox).toBe(true)
    expect(options.webPreferences?.preload).toBe('C:/app/preload.js')
  })
})
