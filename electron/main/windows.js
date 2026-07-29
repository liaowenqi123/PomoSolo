/**
 * 窗口创建函数
 */
const { BrowserWindow } = require('electron')
const path = require('path')
const state = require('./state')

/**
 * 显示"实例已存在"警告弹窗
 */
function showInstanceExistsDialog() {
  // 聚焦到主窗口
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
  }

  const warningWindow = new BrowserWindow({
    width: 360,
    height: 180,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    parent: state.mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  })

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(145deg, #c24a4a 0%, #8a3030 100%);
          border-radius: 16px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        .icon { font-size: 48px; margin-bottom: 16px; animation: shake 0.5s ease-in-out; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .message { color: white; font-size: 16px; font-weight: 500; text-align: center; margin-bottom: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .btn { background: white; color: #a04040; border: none; padding: 10px 32px; border-radius: 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.2); }
        .btn:active { transform: translateY(0); }
      </style>
    </head>
    <body>
      <div class="icon">🍅</div>
      <div class="message">同一路径下只能启动一个实例！</div>
      <button class="btn" id="closeBtn">知道了</button>
      <script>document.getElementById('closeBtn').addEventListener('click', () => window.close());</script>
    </body>
    </html>
  `
  warningWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
}

/**
 * 创建菜园子窗口
 */
function createGardenWindow() {
  if (state.gardenWindow) {
    state.gardenWindow.focus()
    return
  }

  const iconPath = path.join(__dirname, '..', 'src/tomato-page-1.ico')

  state.gardenWindow = new BrowserWindow({
    width: 400,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    icon: iconPath,
    parent: BrowserWindow.getFocusedWindow(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  })

  state.gardenWindow.loadFile(path.join(__dirname, '..', 'src/garden.html'))

  state.gardenWindow.on('closed', () => {
    state.gardenWindow = null
  })
}

module.exports = { showInstanceExistsDialog, createGardenWindow }
