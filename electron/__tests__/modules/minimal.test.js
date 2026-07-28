import { describe, it, expect } from 'vitest'

describe('mock test', () => {
  it('should mock electron via alias', () => {
    const e = require('electron')
    console.log('electron type:', typeof e, 'app:', typeof e.app)
    const { app } = require('electron')
    expect(app.getPath('userData')).toBe('/tmp/pomodoro-test/userData')
  })
})
