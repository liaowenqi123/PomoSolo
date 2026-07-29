/**
 * 窗口操作 + 迷你模式 + 系统托盘 IPC
 */
const { BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const state = require('./state')
const dataManager = require('../src/modules/dataManager')

// ============ 迷你模式位置管理 ============

function loadMiniModePosition() {
  const data = dataManager.readData()
  if (data.miniModePosition) {
    state.miniModePosition = data.miniModePosition
  }
}

function saveMiniModePosition() {
  const data = dataManager.readData()
  data.miniModePosition = state.miniModePosition
  dataManager.writeData(data)
}

const NORMAL_WIDTH = 520
const NORMAL_HEIGHT = 560
const MINI_WIDTH = 180
const MINI_HEIGHT = 220

function register(ipcMain) {
  // ============ 基础窗口操作 ============
  ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url)
  })

  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.hide()
      const { app } = require('electron')
      app.quit()
    }
  })

  ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.minimize()
    }
  })

  ipcMain.on('show-notification', (event, data) => {
    const { Notification } = require('electron')
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: data.title || '番茄钟',
        body: data.body || '',
        silent: false
      })
      notification.show()
    }
  })

  // ============ 窗口置顶 ============
  ipcMain.on('set-always-on-top', (event, onTop) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setAlwaysOnTop(onTop)
      win.setMinimizable(!onTop)
    }
  })

  ipcMain.on('bring-to-front', () => {
    const windows = BrowserWindow.getAllWindows()
    const mainWin = windows.find(w => !w.isDestroyed())
    if (mainWin) {
      mainWin.setAlwaysOnTop(true)
      if (mainWin.isMinimized()) {
        mainWin.restore()
      }
      mainWin.focus()
      mainWin.moveTop()
    }
  })

  ipcMain.on('cancel-always-on-top', () => {
    const windows = BrowserWindow.getAllWindows()
    const mainWin = windows.find(w => !w.isDestroyed())
    if (mainWin) {
      mainWin.setAlwaysOnTop(false)
    }
  })

  // ============ 迷你模式 ============
  ipcMain.on('enter-mini-mode', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    state.normalModePosition = win.getPosition()
    win.setSize(MINI_WIDTH, MINI_HEIGHT)
    win.setAlwaysOnTop(true)
    win.setMinimizable(false)
    win.setSkipTaskbar(true)

    if (!state.tray) {
      const iconPath = path.join(__dirname, '..', 'src/tomato-page-1.ico')
      const icon = nativeImage.createFromPath(iconPath)
      state.tray = new Tray(icon)
      state.tray.setToolTip('番茄钟 - 迷你模式')

      const contextMenu = Menu.buildFromTemplate([
        {
          label: '展开窗口',
          click: () => {
            win.webContents.send('exit-mini-mode-from-tray')
          }
        },
        { type: 'separator' },
        {
          label: '退出应用',
          click: () => {
            win.webContents.send('quit-app-from-tray')
          }
        }
      ])
      state.tray.setContextMenu(contextMenu)

      state.tray.on('click', () => {
        if (win.isMinimized()) win.restore()
        win.focus()
      })
    }

    if (state.miniModePosition) {
      win.setPosition(state.miniModePosition[0], state.miniModePosition[1])
    }
  })

  ipcMain.on('exit-mini-mode', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    state.miniModePosition = win.getPosition()
    saveMiniModePosition()

    win.setSize(NORMAL_WIDTH, NORMAL_HEIGHT)
    win.setAlwaysOnTop(false)
    win.setMinimizable(true)
    win.setSkipTaskbar(false)

    if (state.tray) {
      state.tray.destroy()
      state.tray = null
    }

    if (state.normalModePosition) {
      win.setPosition(state.normalModePosition[0], state.normalModePosition[1])
    }
  })

  ipcMain.on('update-mini-position', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      state.miniModePosition = win.getPosition()
      saveMiniModePosition()
    }
  })
}

module.exports = { register, loadMiniModePosition }
