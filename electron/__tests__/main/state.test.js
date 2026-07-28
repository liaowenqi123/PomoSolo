/**
 * main/state.js 测试
 *
 * 验证共享状态对象导出了预期的字段和初始值。
 */
import { describe, expect, it } from 'vitest'

const state = require('../../main/state')

describe('main/state', () => {
  it('应导出所有预期字段', () => {
    expect(state).toHaveProperty('mainWindow')
    expect(state).toHaveProperty('gardenWindow')
    expect(state).toHaveProperty('tray')
    expect(state).toHaveProperty('focusModeEnabled')
    expect(state).toHaveProperty('timerRunning')
    expect(state).toHaveProperty('timerPaused')
    expect(state).toHaveProperty('foregroundInspectionReady')
    expect(state).toHaveProperty('normalModePosition')
    expect(state).toHaveProperty('miniModePosition')
    expect(state).toHaveProperty('isQuitting')
  })

  it('初始值应为 null 或 false', () => {
    expect(state.mainWindow).toBeNull()
    expect(state.gardenWindow).toBeNull()
    expect(state.tray).toBeNull()
    expect(state.focusModeEnabled).toBe(false)
    expect(state.timerRunning).toBe(false)
    expect(state.timerPaused).toBe(false)
    expect(state.foregroundInspectionReady).toBe(false)
    expect(state.normalModePosition).toBeNull()
    expect(state.miniModePosition).toBeNull()
    expect(state.isQuitting).toBe(false)
  })

  it('应允许修改字段值（共享可变对象）', () => {
    const original = state.timerRunning
    state.timerRunning = true
    expect(state.timerRunning).toBe(true)
    state.timerRunning = original
    expect(state.timerRunning).toBe(original)
  })
})
