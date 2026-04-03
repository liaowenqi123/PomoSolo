/**
 * 备注管理模块
 */
;(function() {
  'use strict'

  let elements = {}
  let currentNote = { title: '', detail: '' } // 内存存储
  let noteModal = null // 弹窗实例

  // 获取当前模式的输入框
  function getCurrentInputs() {
    // 检查当前是单次模式还是计划模式
    const appMode = window.AppState?.appMode || 'single'
    
    if (appMode === 'plan') {
      return {
        titleInput: document.getElementById('plan-note-title-input'),
        detailInput: document.getElementById('plan-note-detail-input')
      }
    } else {
      return {
        titleInput: document.getElementById('noteTitleInput'),
        detailInput: document.getElementById('noteDetailInput')
      }
    }
  }

  // 显示查看模态框
  function showViewModal() {
    if (!currentNote.title) return
    
    document.getElementById('note-view-title').textContent = currentNote.title
    document.getElementById('note-view-detail').textContent = currentNote.detail || '（无详细备注）'
    const modal = document.getElementById('note-view-modal')
    
    // 创建弹窗实例（如果还没有）
    if (!noteModal && typeof BaseModal !== 'undefined') {
      noteModal = new BaseModal({
        element: modal,
        showClass: 'show',
        closeOnBackground: true
      })
    }

    const closeBtn = document.getElementById('note-view-close-btn')
    const closeHandler = () => {
      if (noteModal) {
        noteModal.hide()
      } else {
        modal.classList.remove('show')
      }
      cleanup()
    }
    const cleanup = () => {
      closeBtn.removeEventListener('click', closeHandler)
    }
    closeBtn.addEventListener('click', closeHandler)
    
    // 显示弹窗
    if (noteModal) {
      noteModal.show()
    } else if (modal) {
      modal.classList.add('show')
    }
  }

  // 清除当前备注
  function clearNote() {
    currentNote = { title: '', detail: '' }
    // 清空当前模式的输入框
    const inputs = getCurrentInputs()
    if (inputs.titleInput) inputs.titleInput.value = ''
    if (inputs.detailInput) inputs.detailInput.value = ''
  }

  // 获取当前备注（用于外部）
  function getNote() {
    // 从当前模式的输入框读取最新值
    const inputs = getCurrentInputs()
    return {
      title: inputs.titleInput ? inputs.titleInput.value.trim() : '',
      detail: inputs.detailInput ? inputs.detailInput.value.trim() : ''
    }
  }

  // 设置备注（用于恢复等）
  function setNote(note) {
    currentNote = { title: note.title || '', detail: note.detail || '' }
    // 更新当前模式的输入框
    const inputs = getCurrentInputs()
    if (inputs.titleInput) inputs.titleInput.value = currentNote.title
    if (inputs.detailInput) inputs.detailInput.value = currentNote.detail
  }

  // 初始化
  function init() {
    // 不再需要绑定编辑模态框相关事件
  }

  // 导出
  window.NoteManager = {
    init,
    showViewModal,
    clearNote,
    getNote,
    setNote
  }
})()
