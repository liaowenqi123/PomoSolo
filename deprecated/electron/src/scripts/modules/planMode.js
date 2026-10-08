/**
 * 番茄计划模式模块
 */
;(function() {
  'use strict'

  let elements = {}
  let callbacks = {}
  let planList = []  // { id, minutes, type: 'work' | 'break' }
  let currentIndex = -1
  let isRunning = false
  let draggedItem = null
  
  // 弹窗实例
  let noteModal = null

  // 生成唯一 ID
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  // 渲染计划列表
  function render() {
    const isLastItem = planList.length === 1  // 是否只剩一个项目
    
    elements.planList.innerHTML = ''
    
    planList.forEach((item, index) => {
      const div = document.createElement('div')
      div.className = `plan-item ${item.type}`
      div.dataset.index = index
      div.dataset.id = item.id
      div.draggable = true
      
      if (currentIndex === index && isRunning) {
        div.classList.add('active')
      }
      
      if (isRunning) {
        div.classList.add('disabled')
        div.draggable = false
      }
      
      // 构建左侧内容（拖拽手柄 + 时间 + 备注图标）
      let leftContent = `
        <span class="plan-item-drag-handle">⋮⋮</span>
        <span class="plan-item-time">${item.minutes}分钟</span>
      `
      
      if (item.note && (item.note.title || item.note.detail)) {
        const tooltipText = item.note.title || '查看备注'
        leftContent += `
          <span class="preset-note-icon" data-index="${index}" title="${tooltipText}">
            📒
          </span>
        `
      }
      
      // 只剩一个项目时不显示删除按钮
      const deleteBtnHtml = isLastItem ? '' : '<button class="plan-item-delete">×</button>'
      
      div.innerHTML = `
        <div class="plan-item-left">
          ${leftContent}
        </div>
        ${deleteBtnHtml}
      `
      
      // 点击备注图标
      const noteIcon = div.querySelector('.preset-note-icon')
      if (noteIcon) {
        noteIcon.addEventListener('click', (e) => {
          e.stopPropagation()
          if (!isRunning) {
            const idx = parseInt(e.target.dataset.index)
            editNoteForPlan(idx, item.note)
          }
        })
      }
      
      // 删除按钮
      const deleteBtn = div.querySelector('.plan-item-delete')
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          if (!isRunning) {
            deleteItem(index)
          }
        })
      }
      
      // 拖拽事件
      div.addEventListener('dragstart', handleDragStart)
      div.addEventListener('dragend', handleDragEnd)
      div.addEventListener('dragover', handleDragOver)
      div.addEventListener('drop', handleDrop)
      div.addEventListener('dragleave', handleDragLeave)
      
      elements.planList.appendChild(div)
    })
    
    // 触发回调，更新右侧颜色
    updateMainColor()
  }

  // 编辑计划的备注
  function editNoteForPlan(index, currentNote) {
    const modal = document.getElementById('note-view-modal')
    const contentDiv = modal.querySelector('.note-view')
    const titleEl = modal.querySelector('h3')
    
    // 创建弹窗实例（如果还没有）
    if (!noteModal) {
      noteModal = new BaseModal({
        element: modal,
        showClass: 'show',
        closeOnBackground: true
      })
    }
    
    // 改为可编辑的输入框
    contentDiv.innerHTML = `
      <input type="text" id="editNoteTitleInput" class="edit-note-input" placeholder="标题（可选）" value="${currentNote?.title || ''}" maxlength="50">
      <textarea id="editNoteDetailInput" class="edit-note-textarea" placeholder="详细内容（可选）" rows="4">${currentNote?.detail || ''}</textarea>
    `
    
    titleEl.textContent = '编辑备注'
    
    // 添加关闭按钮
    let closeX = modal.querySelector('.note-modal-close')
    if (!closeX) {
      closeX = document.createElement('button')
      closeX.className = 'note-modal-close'
      closeX.innerHTML = '×'
      modal.querySelector('.note-modal-content').insertBefore(closeX, titleEl)
    }
    
    // 修改按钮容器
    const buttonsContainer = modal.querySelector('.note-modal-buttons')
    buttonsContainer.innerHTML = `
      <button class="btn-note-delete" id="noteDeleteBtn" style="display: ${(currentNote && (currentNote.title || currentNote.detail)) ? 'inline-block' : 'none'}">删除备注</button>
      <button class="btn-note-save" id="noteSaveBtn">保存</button>
    `

    const saveBtn = document.getElementById('noteSaveBtn')
    const deleteBtn = document.getElementById('noteDeleteBtn')
    
    const saveHandler = async () => {
      const titleInput = document.getElementById('editNoteTitleInput')
      const detailInput = document.getElementById('editNoteDetailInput')
      const newTitle = titleInput.value.trim()
      const newDetail = detailInput.value.trim()
      
      const newNote = (newTitle || newDetail) ? { title: newTitle, detail: newDetail } : null
      
      await updatePlanNote(index, newNote)
      
      noteModal.hide()
      cleanup()
    }
    
    const deleteNoteHandler = async () => {
      await updatePlanNote(index, null)
      noteModal.hide()
      cleanup()
    }
    
    const closeHandler = () => {
      noteModal.hide()
      cleanup()
    }
    
    const cleanup = () => {
      saveBtn.removeEventListener('click', saveHandler)
      deleteBtn.removeEventListener('click', deleteNoteHandler)
      closeX.removeEventListener('click', closeHandler)
      titleEl.textContent = '备注详情'
      closeX.remove()
      buttonsContainer.innerHTML = '<button class="btn-note-close" id="noteViewCloseBtn">关闭</button>'
    }
    
    saveBtn.addEventListener('click', saveHandler)
    deleteBtn.addEventListener('click', deleteNoteHandler)
    closeX.addEventListener('click', closeHandler)
    
    // 显示弹窗
    noteModal.show()
  }

  // 更新计划的备注
  async function updatePlanNote(index, newNote) {
    if (index >= 0 && index < planList.length) {
      planList[index].note = newNote
      await savePlan()
      render()
    }
  }

  // 更新右侧主区域的颜色（根据列表第一项）
  function updateMainColor() {
    if (callbacks.onFirstItemChange && planList.length > 0) {
      callbacks.onFirstItemChange(planList[0])
    }
    
    // 更新显示时间
    if (callbacks.onTimeUpdate) {
      const time = planList.length > 0 ? planList[0].minutes : 25
      callbacks.onTimeUpdate(time)
    }
  }

  // 拖拽开始
  function handleDragStart(e) {
    if (isRunning) return
    draggedItem = this
    this.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  }

  // 拖拽结束
  function handleDragEnd() {
    this.classList.remove('dragging')
    document.querySelectorAll('.plan-item').forEach(item => {
      item.classList.remove('drag-over')
    })
    draggedItem = null
  }

  // 拖拽经过
  function handleDragOver(e) {
    if (isRunning) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    if (this !== draggedItem) {
      this.classList.add('drag-over')
    }
  }

  // 拖拽离开
  function handleDragLeave() {
    this.classList.remove('drag-over')
  }

  // 放置
  function handleDrop(e) {
    if (isRunning) return
    e.preventDefault()
    
    if (this !== draggedItem) {
      const fromIndex = parseInt(draggedItem.dataset.index)
      const toIndex = parseInt(this.dataset.index)
      
      // 重新排序
      const item = planList.splice(fromIndex, 1)[0]
      planList.splice(toIndex, 0, item)
      
      savePlan()
      render()
    }
    
    this.classList.remove('drag-over')
  }

  // 添加项目
  async function addItem(minutes, type, note) {
    const item = {
      id: generateId(),
      minutes: parseInt(minutes),
      type: type,
      note: note || null
    }
    
    planList.push(item)
    await savePlan()
    render()
    
    return item
  }

  // 删除项目
  async function deleteItem(index) {
    planList.splice(index, 1)
    
    // 如果删除的是当前执行的，重置索引
    if (currentIndex >= planList.length) {
      currentIndex = planList.length - 1
    }
    
    await savePlan()
    render()
  }

  // 保存计划到数据存储
  async function savePlan() {
    await DataStore.updatePlanList(planList)
  }

  // 加载计划
  function loadPlan() {
    const data = DataStore.getData()
    if (data.planList && Array.isArray(data.planList)) {
      planList = data.planList
    }
  }

  // 获取当前项
  function getCurrentItem() {
    if (currentIndex >= 0 && currentIndex < planList.length) {
      return planList[currentIndex]
    }
    return null
  }

  // 获取列表第一项
  function getFirstItem() {
    return planList.length > 0 ? planList[0] : null
  }

  // 开始执行计划
  function startPlan() {
    if (planList.length === 0) return false
    isRunning = true
    currentIndex = 0
    render()
    return planList[0]
  }

  // 进入下一个任务
  function nextItem() {
    currentIndex++
    if (currentIndex < planList.length) {
      render()
      return planList[currentIndex]
    } else {
      // 计划完成
      isRunning = false
      currentIndex = -1
      render()
      return null
    }
  }

  // 停止计划
  function stopPlan() {
    isRunning = false
    currentIndex = -1
    render()
  }

  // 获取计划状态
  function getPlanStatus() {
    return {
      isRunning,
      currentIndex,
      totalItems: planList.length,
      currentItem: getCurrentItem(),
      remainingItems: planList.length - currentIndex - 1
    }
  }

  // 检查是否有计划
  function hasPlan() {
    return planList.length > 0
  }

  // 清空所有计划
  async function clearAll() {
    planList = []
    currentIndex = -1
    isRunning = false
    await savePlan()
    render()
  }

  // 初始化
  function init(els, cbs) {
    elements = els
    callbacks = cbs || {}
    loadPlan()
    render()
  }

  // 导出到全局
  window.PlanMode = {
    init: init,
    render: render,
    addItem: addItem,
    deleteItem: deleteItem,
    startPlan: startPlan,
    nextItem: nextItem,
    stopPlan: stopPlan,
    getCurrentItem: getCurrentItem,
    getFirstItem: getFirstItem,
    getPlanStatus: getPlanStatus,
    hasPlan: hasPlan,
    loadPlan: loadPlan,
    clearAll: clearAll
  }
})()
