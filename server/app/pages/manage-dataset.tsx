import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle } from '../../config.js'
import Style from '../components/style.js'
import { DynamicContext, WsContext, getContextFormBody } from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { id, object, boolean, string, optional, array } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, makeThrows, Title } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { EarlyTerminate } from '../../exception.js'
import { IonButton } from '../components/ion-button.js'
import { nodeToVNode } from '../jsx/vnode.js'
import AdmZip from 'adm-zip'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { join, basename } from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'

let imagePlugin = loadClientPlugin({
  entryFile: 'dist/client/image.js',
})

let pageTitle = (
  <Locale en="Manage Dataset" zh_hk="管理數據集" zh_cn="管理数据集" />
)

let style = Style(/* css */ `
#ManageDataset {
  display: flex;
  flex-direction: column;
  height: 100%;
}
#ManageDataset .section {
  margin: 2rem;
}
#ManageDataset .section-title {
  font-size: 1.5rem;
  font-weight: bold;
  text-align: center;
  margin: 1rem 0;
}
#ManageDataset .image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  padding: 1rem;
  z-index: 1;
}
#ManageDataset .image-item {
  text-align: center;
  position: relative;
}
#ManageDataset .image-item img {
  width: 100%;
  height: 150px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s ease;
}
#ManageDataset .image-item.selected img {
  transform: scale(0.9);
}
#ManageDataset .image-item.selected::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 150px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  z-index: -1;
  pointer-events: none;
}
#ManageDataset .no-images-message {
  text-align: center;
  padding: 2rem;
  z-index: 1;
}
#imageModal {
  --width: 80%;
  --height: 80%;
}
#imageModal .modal-content {
  display: flex;
  height: 100%;
}
#imageModal .sidebar {
  width: 200px;
  background-color: #f8f8f8;
  padding: 1rem;
  overflow-y: auto;
  border-right: 1px solid #ccc;
}
#imageModal .sidebar h3 {
  text-align: center;
}
#imageModal .sidebar .label-item {
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.3rem;
}
#imageModal .sidebar .label-item .label-title {
  font-weight: bold;
  flex: 1;
}
#imageModal .sidebar .label-item .control-buttons {
  display: flex;
  gap: 0.2rem;
}
#imageModal .sidebar .label-item .control-buttons ion-button {
  flex-grow: 1;
  margin: 0;
  height: 2rem;
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
}
#imageModal .sidebar .label-item .control-buttons ion-button ion-icon {
  font-size: 1.5rem;
}
#imageModal .sidebar .label-item .control-buttons ion-button.half-transparent {
  --background: #999;
  --color: #fff;
}
#imageModal .image-container {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
}
#imageModal .image-container img {
  max-width: 100%;
  max-height: calc(100% - 60px);
  object-fit: contain;
}
#imageModal .nav-buttons {
  position: absolute;
  bottom: 10px;
  display: flex;
  gap: 1rem;
}
#imageModal .nav-buttons ion-button {
  --padding-start: 1rem;
  --padding-end: 1rem;
}
#labelStatus.loading {
  text-align: center;
  padding: 1rem;
  color: #555;
}
#ManageDataset .label-container {
  background-color: #fff9;
  padding: 0.2rem;
  border-radius: 0.2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
#ManageDataset .label-container .class-label {
  font-size: 0.1rem;
  display: flex;
  justify-content: center;
  flex: 1;
}
#ManageDataset .label-container progress {
  width: 4rem;
}
#ManageDataset .label-toggle-button {
  position: absolute;
  right: 0;
  top: -2.5rem;
  width: 5rem;
  font-size: 0.5rem;
  padding: 0rem;
  background-color: #e4e4e4b0;
  border-radius: 0.1rem;
  text-align: center;
  --background: #e4e4e4b0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  z-index: 10;
}
#ManageDataset .label-toggle-button ion-icon {
  font-size: 0.5rem;
  color: #ffffffe4;
}
#ManageDataset .label-toggle-button span {
  color: #ffffffe4;
  font-size: 0.1rem;
}
#ManageDataset .label-state-button {
  --padding-start: 0;
  --padding-end: 0;
  --padding-top: 0;
  --padding-bottom: 0;
  --border-radius: 50%;
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
}
#ManageDataset .label-state-button ion-icon {
  font-size: 1rem;
  --ionicon-stroke-width: 32px;
  color: #999;
}
#ManageDataset .select-toggle-button {
  position: absolute;
  left: 0;
  top: -2.5rem;
  width: 5rem;
  font-size: 0.5rem;
  padding: 0rem;
  background-color: #e4e4e4b0;
  border-radius: 0.1rem;
  text-align: center;
  --background: #e4e4e4b0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  z-index: 10;
}
#ManageDataset .select-toggle-button span {
  color: #ffffffe4;
  font-size: 0.1rem;
}
#ManageDataset .select-all-button {
  position: absolute;
  left: 5.5rem;
  top: -2.5rem;
  width: 8rem;
  height: 1.2rem;
  font-size: 0.1rem;
  padding: 0rem;
  background-color: #e4e4e4b0;
  border-radius: 0.1rem;
  text-align: center;
  --background: #e4e4e4b0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  z-index: 10;
}
#ManageDataset .select-all-button span {
  color: #ffffffe4;
  font-size: 0.1rem;
}
#ManageDataset .image-checkbox {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 10;
}
#label-toggle-container {
  z-index: 10;
}
#selection-toolbar {
  background-color: #fff;
  border-top: 1px solid #ccc;
}
#selection-toolbar div {
  padding: 0.5rem;
}
#selection-toolbar ion-button {
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
  font-size: 0.9rem;
}
#selection-toolbar ion-icon {
  font-size: 1.2rem;
}
.half-transparent {
  opacity: 0.25;
}
#deleteConfirmModal, #unlabelConfirmModal, #exportConfirmModal {
  display: none;
  position: fixed;
  left: 0; top: 0;
  width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.3);
  z-index: 9999;
  justify-content: center;
  align-items: center;
  transition: opacity 0.2s;
}
#deleteConfirmModal[style*="display: flex"], #unlabelConfirmModal[style*="display: flex"], #exportConfirmModal[style*="display: flex"] {
  opacity: 1;
}
#exportConfirmModal .modal-content {
  background: #fff;
  border-radius: 8px;
  padding: 2rem;
  min-width: 300px;
  max-width: 500px;
  box-shadow: 0 2px 16px #0002;
  text-align: center;
}
#exportConfirmModal .modal-button {
  width: 150px;
  height: 40px;
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
}
#exportConfirmModal .cancel-button-container {
  display: flex;
  justify-content: center;
}
#exportConfirmModal .checkbox-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}
#exportConfirmModal .checkbox-container label {
  font-size: 0.9rem;
}
#exportConfirmModal .label-selection-container {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 1rem;
}
#exportConfirmModal .label-selection-container label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  margin: 0.5rem 0;
}
#ManageDataset .import-button {
  width: 12rem;
  height: 3rem;
  font-size: 0.5rem;
  --background: #e4e4e4b0;
  border-radius: 0.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
#ManageDataset .import-button span {
  color: #ffffffe4;
  font-size: 0.1rem;
}
`)

let script = Script(/* js */ `
let imagesData = []
let filteredImagesData = []
let isLabelVisible = true
let labelStates = []
let isToggling = false
let isSelectionMode = false
let selectedImages = []
let isUpdatingAnnotation = false
let organizeByLabel = false
let selectedLabels = []

function initLabelStates(labels) {
  labels.forEach(label => {
    if (!labelStates.some(item => item.id === label.id)) {
      labelStates.push({ id: label.id, state: 'empty' })
    }
  })
}

function setImagesData(images) {
  imagesData = images || []
}

function setFilteredImagesData(images) {
  filteredImagesData = images || []
}

function toggleLabels() {
  isLabelVisible = !isLabelVisible
  const container = document.getElementById('label-toggle-container')
  if (container) {
    container.style.display = isLabelVisible ? 'flex' : 'none'
  }
  emit('/manage-dataset/toggle-labels', { isLabelVisible })
}

function toggleLabelState(label_id) {
  if (isToggling) return
  isToggling = true
  const currentItem = labelStates.find(item => item.id === label_id) || { id: label_id, state: 'empty' }
  const currentState = currentItem.state
  const nextState = currentState === 'empty' ? 'correct' : currentState === 'correct' ? 'incorrect' : 'empty'
  labelStates = labelStates.filter(item => item.id !== label_id).concat([{ id: label_id, state: nextState }])
  const payload = {
    label_id,
    state: nextState,
    labelStates: JSON.parse(JSON.stringify(labelStates)),
    isSelectionMode,
    selectedImages
  }
  emit('/manage-dataset/toggle-label-state', payload)
  setTimeout(() => { isToggling = false; }, 200)
}

function updateAnnotation(label_id, image_id, answer) {
  if (isUpdatingAnnotation) return
  isUpdatingAnnotation = true
  emit('/manage-dataset/update-annotation', { label_id, image_id, answer })
  setTimeout(() => {
    emit('/manage-dataset/load-label-status', { image_id })
    isUpdatingAnnotation = false
  }, 200)
}

function showUnlabelConfirmModal() {
  const modal = document.getElementById('unlabelConfirmModal')
  if (modal) modal.style.display = 'flex'
}

function closeUnlabelConfirmModal() {
  const modal = document.getElementById('unlabelConfirmModal')
  if (modal) modal.style.display = 'none'
}

function confirmUnlabelImages() {
  closeUnlabelConfirmModal()
  if (selectedImages.length === 0) return
  emit('/manage-dataset/batch-unlabel', { image_ids: selectedImages })
  selectedImages = []
  toggleSelectionMode()
}

function handleUnlabel() {
  if (selectedImages.length === 0) return
  showUnlabelConfirmModal()
}

function handleDelete() {
  if (selectedImages.length === 0) return
  showDeleteConfirmModal()
}

function showDeleteConfirmModal() {
  const modal = document.getElementById('deleteConfirmModal')
  if (modal) modal.style.display = 'flex'
}

function closeDeleteConfirmModal() {
  const modal = document.getElementById('deleteConfirmModal')
  if (modal) modal.style.display = 'none'
}

function confirmDeleteImages() {
  closeDeleteConfirmModal()
  emit('/manage-dataset/batch-delete', { image_ids: selectedImages })
  selectedImages = []
  toggleSelectionMode()
}

function showExportConfirmModal() {
  const modal = document.getElementById('exportConfirmModal')
  if (modal) {
    modal.style.display = 'flex'
    const checkbox = document.getElementById('organizeByLabelCheckbox')
    if (checkbox) {
      checkbox.checked = selectedLabels.length > 0
      organizeByLabel = checkbox.checked
    }
    document.querySelectorAll('.label-checkbox').forEach(cb => {
      cb.checked = selectedLabels.includes(parseInt(cb.dataset.labelId))
    })
    updateSelectAllLabelsButton()
  }
}

function closeExportConfirmModal() {
  const modal = document.getElementById('exportConfirmModal')
  if (modal) modal.style.display = 'none'
}

function updateOrganizeByLabel() {
  const checkbox = document.getElementById('organizeByLabelCheckbox')
  if (checkbox) {
    const anyLabelChecked = document.querySelectorAll('.label-checkbox:checked').length > 0
    checkbox.checked = anyLabelChecked
    organizeByLabel = anyLabelChecked
  }
}

function selectAllLabels() {
  const checkboxes = document.querySelectorAll('.label-checkbox')
  const anyChecked = document.querySelectorAll('.label-checkbox:checked').length > 0
  checkboxes.forEach(cb => {
    cb.checked = !anyChecked
  })
  selectedLabels = anyChecked ? [] : Array.from(checkboxes).map(cb => parseInt(cb.dataset.labelId))
  updateOrganizeByLabel()
  updateSelectAllLabelsButton()
}

function updateSelectAllLabelsButton() {
  emit('/manage-dataset/update-select-all-labels-button', { anyLabelChecked: document.querySelectorAll('.label-checkbox:checked').length > 0 })
}

function exportImages() {
  closeExportConfirmModal()
  const checkbox = document.getElementById('organizeByLabelCheckbox')
  organizeByLabel = checkbox ? checkbox.checked : false
  selectedLabels = Array.from(document.querySelectorAll('.label-checkbox:checked'))
    .map(cb => parseInt(cb.dataset.labelId))
  const payload = isSelectionMode && selectedImages.length > 0
    ? { image_ids: selectedImages, label_ids: selectedLabels, organizeByLabel }
    : { image_ids: imagesData.map(img => img.image_id), label_ids: selectedLabels, organizeByLabel }
  emit('/manage-dataset/batch-export', payload)
  selectedImages = []
  toggleSelectionMode()
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  let bytes = new Uint8Array(buffer);
  let len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function handleImport() {
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = function(e) {
    let file = e.target.files[0];
    if (file) {
      let reader = new FileReader();
      reader.onload = function(e) {
        let arrayBuffer = e.target.result;
        let base64 = arrayBufferToBase64(arrayBuffer);
        emit('/manage-dataset/import-zip', { zipData: base64 });
      };
      reader.readAsArrayBuffer(file);
    }
  };
  input.click();
}

function updateButtonStates() {
  const img = document.getElementById('enlargedImage')
  const prevButton = document.getElementById('btn_previous')
  const nextButton = document.getElementById('btn_next')
  const currentImageId = parseInt(img.dataset.image_id)
  if (!currentImageId || filteredImagesData.length === 0) {
    prevButton.disabled = true
    nextButton.disabled = true
    return
  }
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId)
  prevButton.disabled = currentIndex <= 0 || currentIndex === -1
  nextButton.disabled = currentIndex >= filteredImagesData.length - 1 || currentIndex === -1
}

function showEnlargedImage(src, rotation, image_id) {
  if (isSelectionMode) return
  const modal = document.getElementById('imageModal')
  const img = document.getElementById('enlargedImage')
  const labelStatus = modal.shadowRoot ? modal.shadowRoot.querySelector('#labelStatus') : document.querySelector('#labelStatus')
  img.src = src
  img.dataset.rotation = rotation || 0
  img.dataset.image_id = image_id
  if (labelStatus) {
    labelStatus.classList.add('loading')
    labelStatus.innerHTML = 'Loading...'
  }
  if (typeof initAnnotationImage === 'function') {
    initAnnotationImage(img)
    if (img.src !== src) {
      img.src = src
    }
  }
  if (!modal.isOpen) {
    modal.present()
    modal.addEventListener('ionModalDidPresent', () => {
      updateButtonStates()
    })
  } else {
    updateButtonStates()
  }
  emit('/manage-dataset/load-label-status', { image_id })

  modal.addEventListener('didDismiss', () => {
    img.src = ''
    img.dataset.image_id = ''
    if (labelStatus) {
      labelStatus.classList.remove('loading')
      labelStatus.innerHTML = ''
    }
  }, { once: true })
}

function showPreviousImage() {
  const img = document.getElementById('enlargedImage')
  const currentImageId = parseInt(img.dataset.image_id)
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId)
  if (currentIndex > 0) {
    const prevImage = filteredImagesData[currentIndex - 1]
    if (prevImage.filename && !prevImage.filename.startsWith('data:image')) {
      showEnlargedImage('/uploads/' + prevImage.filename, prevImage.rotation || 0, prevImage.image_id)
    }
  }
  updateButtonStates()
}

function showNextImage() {
  const img = document.getElementById('enlargedImage')
  const currentImageId = parseInt(img.dataset.image_id)
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId)
  if (currentIndex < filteredImagesData.length - 1) {
    const nextImage = filteredImagesData[currentIndex + 1]
    if (nextImage.filename && !nextImage.filename.startsWith('data:image')) {
      showEnlargedImage('/uploads/' + nextImage.filename, nextImage.rotation || 0, nextImage.image_id)
    }
  }
  updateButtonStates()
}

function handleImageClick(filename, rotation, image_id) {
  if (isSelectionMode) {
    toggleImageSelection(image_id)
  } else {
    showEnlargedImage('/uploads/' + filename, rotation || 0, image_id)
  }
}

function toggleSelectionMode() {
  isSelectionMode = !isSelectionMode
  selectedImages = []
  emit('/manage-dataset/toggle-selection-mode', { isSelectionMode })
  const selectAllButton = document.getElementById('select-all-button')
  if (selectAllButton) {
    selectAllButton.style.display = isSelectionMode ? 'flex' : 'none'
  }
  const selectionToolbar = document.getElementById('selection-toolbar')
  if (selectionToolbar) {
    selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none'
  }
  const checkboxes = document.querySelectorAll('.image-checkbox')
  checkboxes.forEach(checkbox => {
    checkbox.style.display = isSelectionMode ? 'block' : 'none'
    checkbox.checked = false
    const imageItem = checkbox.closest('.image-item')
    if (imageItem) {
      imageItem.classList.remove('selected')
    }
  })
  updateSelectAllButton()
}

function toggleImageSelection(image_id) {
  if (isSelectionMode) {
    const checkbox = document.querySelector('input.image-checkbox[data-image-id="' + image_id + '"]')
    const imageItem = checkbox ? checkbox.closest('.image-item') : null
    if (selectedImages.includes(image_id)) {
      selectedImages = selectedImages.filter(id => id !== image_id)
      if (checkbox) checkbox.checked = false
      if (imageItem) imageItem.classList.remove('selected')
    } else {
      selectedImages.push(image_id)
      if (checkbox) checkbox.checked = true
      if (imageItem) imageItem.classList.add('selected')
    }
    const selectionToolbar = document.getElementById('selection-toolbar')
    if (selectionToolbar) {
      selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none'
    }
    updateSelectAllButton()
  }
}

function toggleSelectAllImages() {
  if (!isSelectionMode) return
  if (selectedImages.length > 0) {
    selectedImages = []
    document.querySelectorAll('.image-checkbox').forEach(checkbox => {
      checkbox.checked = false
      const imageItem = checkbox.closest('.image-item')
      if (imageItem) {
        imageItem.classList.remove('selected')
      }
    })
  } else {
    selectedImages = filteredImagesData.map(item => item.image_id)
    document.querySelectorAll('.image-checkbox').forEach(checkbox => {
      checkbox.checked = true
      const imageItem = checkbox.closest('.image-item')
      if (imageItem) {
        imageItem.classList.add('selected')
      }
    })
  }
  const selectionToolbar = document.getElementById('selection-toolbar')
  if (selectionToolbar) {
    selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none'
  }
  updateSelectAllButton()
}

function updateSelectAllButton() {
  emit('/manage-dataset/update-select-all-button', { hasSelectedImages: selectedImages.length > 0 })
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/app/home" backText="Home" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="ManageDataset" class="ion-no-padding">
      <Main />
    </ion-content>
    {imagePlugin.node}
    {script}
  </>
)

// SQL to fetch annotated images for a label
let select_annotated_images = db.prepare<
  { label_id: number },
  {
    id: number
    image_id: number
    filename: string
    answer: number
    rotation: number | null
    user_id: number
    label_id: number
  }
>(/* sql */ `
select il.id, il.image_id, i.filename, il.answer, i.rotation, il.user_id, il.label_id
from image_label il
join image i on il.image_id = i.id
where il.label_id = :label_id
and il.id = (
  select max(il2.id)
  from image_label il2
  where il2.image_id = il.image_id
  and il2.label_id = il.label_id
)
order by il.image_id
`)

// SQL to fetch the latest label status for an image
let select_image_label_status = db.prepare<
  { image_id: number },
  {
    label_id: number
    label_title: string
    answer: number | null
  }
>(/* sql */ `
select l.id as label_id, l.title as label_title,
  (select il.answer from image_label il
   where il.label_id = l.id and il.image_id = :image_id
   order by il.id desc limit 1) as answer
from label l
order by l.id
`)

let toggleLabelParser = object({
  isLabelVisible: boolean(),
})

function ToggleLabels(
  attrs: {
    labelStates?: Record<number, 'empty' | 'correct' | 'incorrect'>
  },
  context: WsContext,
) {
  try {
    let body = getContextFormBody(context)
    let input = toggleLabelParser.parse(body)
    context.ws.send([
      'batch',
      [
        [
          'update-in',
          '#label-toggle-container',
          nodeToVNode(
            <div
              id="label-toggle-container"
              style={`position: absolute; right: 0; top: 0; display: ${input.isLabelVisible ? 'flex' : 'none'}; flex-direction: column; gap: 0.25rem; z-index: 10;`}
            >
              {mapArray(proxy.label, label => {
                let annotated_count = db
                  .prepare<{ label_id: number }, number>(
                    /* sql */ `
                    SELECT COUNT(DISTINCT il.image_id)
                    FROM image_label il
                    WHERE il.label_id = :label_id
                  `,
                  )
                  .pluck()
                  .get({ label_id: label.id! })
                let state = (attrs.labelStates?.[label.id!] || 'empty') as
                  | 'empty'
                  | 'correct'
                  | 'incorrect'
                return (
                  <div class="label-container">
                    <div class="class-label">{label.title}</div>
                    <ion-button
                      id={`label-state-button-${label.id}`}
                      class={`label-state-button ${state}`}
                      fill="clear"
                      onclick={`toggleLabelState(${label.id})`}
                    >
                      <ion-icon
                        name={
                          state === 'correct'
                            ? 'checkmark-circle'
                            : state === 'incorrect'
                              ? 'close-circle'
                              : 'ellipse-outline'
                        }
                        style={{
                          '--ionicon-stroke-width':
                            state === 'correct' || state === 'incorrect'
                              ? '64px'
                              : '32px',
                          'color':
                            state === 'correct'
                              ? '#4caf50'
                              : state === 'incorrect'
                                ? '#f44336'
                                : '#999',
                        }}
                      ></ion-icon>
                    </ion-button>
                    <progress
                      value={annotated_count}
                      max={proxy.image.length || 1}
                    ></progress>
                  </div>
                )
              })}
            </div>,
            context,
          ),
        ],
        [
          'update-in',
          '#toggle-labels-button > span',
          nodeToVNode(
            <span>
              <Locale
                en={input.isLabelVisible ? 'Hide' : 'Show'}
                zh_hk={input.isLabelVisible ? '隱藏' : '顯示'}
                zh_cn={input.isLabelVisible ? '隐藏' : '显示'}
              />
            </span>,
            context,
          ),
        ],
        [
          'eval',
          `
          isLabelVisible = ${JSON.stringify(input.isLabelVisible)};
          const container = document.getElementById('label-toggle-container');
          if (container) {
            container.style.display = ${JSON.stringify(input.isLabelVisible ? 'flex' : 'none')};
          }
          `,
        ],
      ],
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let toggleLabelStateParser = object({
  label_id: id(),
  state: string(),
  labelStates: array(
    object({
      id: id(),
      state: string(),
    }),
  ),
  isSelectionMode: boolean(),
  selectedImages: array(id()),
})

function ToggleLabelState(
  attrs: { labelStates?: Record<number, 'empty' | 'correct' | 'incorrect'> },
  context: WsContext,
) {
  try {
    let body = getContextFormBody(context)
    let input = toggleLabelStateParser.parse(body)

    const validStates = ['empty', 'correct', 'incorrect']
    if (!validStates.includes(input.state)) {
      throw new Error(
        `Invalid state: ${input.state}. Must be one of ${validStates.join(', ')}`,
      )
    }
    const state = input.state as 'empty' | 'correct' | 'incorrect'
    const frontendLabelStates: Record<
      number,
      'empty' | 'correct' | 'incorrect'
    > = {}
    input.labelStates.forEach(item => {
      if (validStates.includes(item.state)) {
        frontendLabelStates[item.id] = item.state as
          | 'empty'
          | 'correct'
          | 'incorrect'
      } else {
        console.warn(
          `ToggleLabelState: Skipping invalid state for label ${item.id}: ${item.state}`,
        )
      }
    })

    let updatedLabelStates: Record<number, 'empty' | 'correct' | 'incorrect'> =
      {}
    proxy.label.forEach(label => {
      updatedLabelStates[label.id!] = 'empty'
    })
    Object.assign(updatedLabelStates, frontendLabelStates)
    updatedLabelStates[input.label_id] = state

    const filteredImages = filterImagesByLabelStates(
      proxy.image
        .filter(
          item => item.filename && !item.filename.startsWith('data:image'),
        )
        .map(item => ({
          image_id: item.id!,
          filename: item.filename,
          rotation: item.rotation || 0,
        })),
      updatedLabelStates,
    )

    context.ws.send([
      'batch',
      [
        [
          'update-in',
          `#label-state-button-${input.label_id}`,
          nodeToVNode(
            <ion-button
              id={`label-state-button-${input.label_id}`}
              class={`label-state-button ${state}`}
              fill="clear"
              onclick={`toggleLabelState(${input.label_id})`}
            >
              <ion-icon
                name={
                  state === 'correct'
                    ? 'checkmark-circle'
                    : state === 'incorrect'
                      ? 'close-circle'
                      : 'ellipse-outline'
                }
                style={{
                  '--ionicon-stroke-width':
                    state === 'correct' || state === 'incorrect'
                      ? '64px'
                      : '32px',
                  'color':
                    state === 'correct'
                      ? '#4caf50'
                      : state === 'incorrect'
                        ? '#f44336'
                        : '#999',
                }}
              ></ion-icon>
            </ion-button>,
            context,
          ),
        ],
        [
          'update-in',
          '.image-grid',
          nodeToVNode(
            <>
              {mapArray(filteredImages, item => (
                <div class="image-item" key={`image-${item.image_id}`}>
                  <input
                    type="checkbox"
                    class="image-checkbox"
                    style={`display: ${input.isSelectionMode ? 'block' : 'none'};`}
                    data-image-id={item.image_id}
                    checked={input.selectedImages.includes(item.image_id)}
                  />
                  <img
                    src={`/Uploads/${item.filename}`}
                    alt="Image"
                    data-rotation={item.rotation}
                    onload="initAnnotationImage(this)"
                    onclick={`handleImageClick('${item.filename}', ${item.rotation}, ${item.image_id})`}
                  />
                </div>
              ))}
            </>,
            context,
          ),
        ],
        [
          'update-in',
          '.no-images-message',
          nodeToVNode(
            <div class="no-images-message" hidden={filteredImages.length > 0}>
              <p>
                <Locale
                  en="No images in dataset."
                  zh_hk="數據集中沒有圖片。"
                  zh_cn="数据集中没有图像。"
                />
              </p>
            </div>,
            context,
          ),
        ],
        [
          'update-in',
          '#toggle-selection-button > span',
          nodeToVNode(
            <span>
              <Locale
                en={input.isSelectionMode ? 'View' : 'Select'}
                zh_hk={input.isSelectionMode ? '查看' : '選擇'}
                zh_cn={input.isSelectionMode ? '查看' : '选择'}
              />
            </span>,
            context,
          ),
        ],
        [
          'update-in',
          '#select-all-button > span',
          nodeToVNode(
            <span>
              <Locale
                en={input.selectedImages.length > 0 ? 'Deselect' : 'Select All'}
                zh_hk={input.selectedImages.length > 0 ? '取消選擇' : '全選'}
                zh_cn={input.selectedImages.length > 0 ? '取消选择' : '全选'}
              />
            </span>,
            context,
          ),
        ],
        [
          'eval',
          `
          labelStates = ${JSON.stringify(
            Object.entries(updatedLabelStates).map(([id, state]) => ({
              id: Number(id),
              state,
            })),
          )};
          setImagesData(${JSON.stringify(filteredImages)});
          setFilteredImagesData(${JSON.stringify(filteredImages)});
          isSelectionMode = ${JSON.stringify(input.isSelectionMode)};
          selectedImages = ${JSON.stringify(input.selectedImages)};
          updateButtonStates();
          const toggleButton = document.getElementById('toggle-selection-button');
          if (toggleButton && !toggleButton.onclick) {
            toggleButton.onclick = toggleSelectionMode;
          }
          const selectAllButton = document.getElementById('select-all-button');
          if (selectAllButton) {
            selectAllButton.style.display = ${JSON.stringify(input.isSelectionMode ? 'flex' : 'none')};
            if (!selectAllButton.onclick) {
              selectAllButton.onclick = toggleSelectAllImages;
            }
          }
          document.querySelectorAll('.image-item').forEach(item => {
            const checkbox = item.querySelector('.image-checkbox');
            if (checkbox && checkbox.checked) {
              item.classList.add('selected');
            } else {
              item.classList.remove('selected');
            }
          });
          const selectionToolbar = document.getElementById('selection-toolbar');
          if (selectionToolbar) {
            selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none';
          }
          `,
        ],
      ],
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('ToggleLabelState Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let toggleSelectionModeParser = object({
  isSelectionMode: boolean(),
})

function ToggleSelectionMode(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = toggleSelectionModeParser.parse(body)
    context.ws.send([
      'batch',
      [
        [
          'update-in',
          '#toggle-selection-button > span',
          nodeToVNode(
            <span>
              <Locale
                en={input.isSelectionMode ? 'View' : 'Select'}
                zh_hk={input.isSelectionMode ? '查看' : '選擇'}
                zh_cn={input.isSelectionMode ? '查看' : '选择'}
              />
            </span>,
            context,
          ),
        ],
        [
          'update-in',
          '#select-all-button > span',
          nodeToVNode(
            <span>
              <Locale en="Select All" zh_hk="全選" zh_cn="全选" />
            </span>,
            context,
          ),
        ],
        [
          'eval',
          `
          isSelectionMode = ${JSON.stringify(input.isSelectionMode)};
          selectedImages = [];
          const selectAllButton = document.getElementById('select-all-button');
          if (selectAllButton) {
            selectAllButton.style.display = ${JSON.stringify(input.isSelectionMode ? 'flex' : 'none')};
          }
          const selectionToolbar = document.getElementById('selection-toolbar');
          if (selectionToolbar) {
            selectionToolbar.style.display = 'none';
          }
          document.querySelectorAll('.image-checkbox').forEach(checkbox => {
            checkbox.style.display = ${JSON.stringify(input.isSelectionMode ? 'block' : 'none')};
            checkbox.checked = false;
            const imageItem = checkbox.closest('.image-item');
            if (imageItem) {
              imageItem.classList.remove('selected');
            }
          });
          `,
        ],
      ],
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let updateSelectAllButtonParser = object({
  hasSelectedImages: boolean(),
})

function UpdateSelectAllButton(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = updateSelectAllButtonParser.parse(body)
    context.ws.send([
      'update-in',
      '#select-all-button > span',
      nodeToVNode(
        <span>
          <Locale
            en={input.hasSelectedImages ? 'Deselect' : 'Select All'}
            zh_hk={input.hasSelectedImages ? '取消選擇' : '全選'}
            zh_cn={input.hasSelectedImages ? '取消选择' : '全选'}
          />
        </span>,
        context,
      ),
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let updateSelectAllLabelsButtonParser = object({
  anyLabelChecked: boolean(),
})

function UpdateSelectAllLabelsButton(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = updateSelectAllLabelsButtonParser.parse(body)
    context.ws.send([
      'update-in',
      '#select-all-labels-button > span',
      nodeToVNode(
        <span>
          <Locale
            en={input.anyLabelChecked ? 'Deselect' : 'Select All'}
            zh_hk={input.anyLabelChecked ? '取消選擇' : '全選'}
            zh_cn={input.anyLabelChecked ? '取消选择' : '全选'}
          />
        </span>,
        context,
      ),
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

function Main(
  attrs: {
    isLabelVisible?: boolean
    labelStates?: Record<number, 'empty' | 'correct' | 'incorrect'>
    isSelectionMode?: boolean
    selectedImages?: number[]
  },
  context: DynamicContext,
) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to manage dataset"
              zh_hk="您必須登入才能管理數據集"
              zh_cn="您必须登录才能管理数据集"
            />
          </p>
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }
  let isLabelVisible = attrs.isLabelVisible !== false
  let isSelectionMode = attrs.isSelectionMode || false
  let selectedImages = attrs.selectedImages || []
  let labelStates = proxy.label.reduce(
    (acc, label) => {
      acc[label.id!] = attrs.labelStates?.[label.id!] || 'empty'
      return acc
    },
    {} as Record<number, 'empty' | 'correct' | 'incorrect'>,
  )

  let images = proxy.image
    .filter(item => item.filename && !item.filename.startsWith('data:image'))
    .map(item => ({
      image_id: item.id!,
      filename: item.filename,
      rotation: item.rotation || 0,
    }))
  images = filterImagesByLabelStates(images, labelStates)
  let totalImages = proxy.image.length

  let labelStatesArray = Object.entries(labelStates).map(([id, state]) => ({
    id: Number(id),
    state,
  }))

  return (
    <>
      <div
        id="deleteConfirmModal"
        style="display:none; position:fixed; left:0; top:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); z-index:9999; justify-content:center; align-items:center;"
      >
        <div style="background:#fff; border-radius:8px; padding:2rem; min-width:300px; box-shadow:0 2px 16px #0002; text-align:center;">
          <div style="margin-bottom:1rem;">
            <Locale
              en="Are you sure you want to delete the selected images?"
              zh_hk="確定要刪除所選圖片嗎？"
              zh_cn="确定要删除所选图片吗？"
            />
          </div>
          <div style="display:flex; justify-content:center; gap:1rem;">
            <ion-button color="danger" onclick="confirmDeleteImages()">
              <Locale en="Delete" zh_hk="刪除" zh_cn="删除" />
            </ion-button>
            <ion-button fill="outline" onclick="closeDeleteConfirmModal()">
              <Locale en="Cancel" zh_hk="取消" zh_cn="取消" />
            </ion-button>
          </div>
        </div>
      </div>
      <div
        id="unlabelConfirmModal"
        style="display:none; position:fixed; left:0; top:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); z-index:9999; justify-content:center; align-items:center;"
      >
        <div style="background:#fff; border-radius:8px; padding:2rem; min-width:300px; box-shadow:0 2px 16px #0002; text-align:center;">
          <div style="margin-bottom:1rem;">
            <Locale
              en="Are you sure you want to unlabel the selected images?"
              zh_hk="確定要取消所選圖片的標籤嗎？"
              zh_cn="确定要取消所选图片的标签吗？"
            />
          </div>
          <div style="display:flex; justify-content:center; gap:1rem;">
            <ion-button color="warning" onclick="confirmUnlabelImages()">
              <Locale en="Unlabel" zh_hk="取消標籤" zh_cn="取消标签" />
            </ion-button>
            <ion-button fill="outline" onclick="closeUnlabelConfirmModal()">
              <Locale en="Cancel" zh_hk="取消" zh_cn="取消" />
            </ion-button>
          </div>
        </div>
      </div>
      <div
        id="exportConfirmModal"
        style="display:none; position:fixed; left:0; top:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); z-index:9999; justify-content:center; align-items:center;"
      >
        <div class="modal-content">
          <div style="margin-bottom:1rem;">
            <Locale
              en="Select labels to export"
              zh_hk="選擇要匯出的標籤"
              zh_cn="选择要导出的标签"
            />
          </div>
          <div class="label-selection-container">
            {mapArray(proxy.label, label => (
              <label>
                <input
                  type="checkbox"
                  class="label-checkbox"
                  data-label-id={label.id}
                  onclick="updateOrganizeByLabel()"
                />
                {label.title}
              </label>
            ))}
          </div>
          <div class="checkbox-container">
            <input type="checkbox" id="organizeByLabelCheckbox" disabled />
            <label for="organizeByLabelCheckbox">
              <Locale
                en="Organize images by labels into folders"
                zh_hk="按標籤將圖片分到資料夾"
                zh_cn="按标签将图片分到文件夹"
              />
            </label>
          </div>
          <div style="display:flex; flex-direction:column; gap:1rem; margin-top:1rem;">
            <div style="display:flex; justify-content:center; gap:1rem;">
              <ion-button
                id="select-all-labels-button"
                class="modal-button"
                color="primary"
                onclick="selectAllLabels()"
              >
                <Locale en="Select All" zh_hk="全選" zh_cn="全选" />
              </ion-button>
              <ion-button
                class="modal-button"
                color="primary"
                onclick="exportImages()"
              >
                <Locale en="Export" zh_hk="匯出" zh_cn="导出" />
              </ion-button>
            </div>
            <div class="cancel-button-container">
              <ion-button
                class="modal-button"
                fill="outline"
                onclick="closeExportConfirmModal()"
              >
                <Locale en="Cancel" zh_hk="取消" zh_cn="取消" />
              </ion-button>
            </div>
          </div>
        </div>
      </div>
      <div id="MainContent">
        <div style="position: relative; z-index: 5;">
          <ion-button
            id="toggle-selection-button"
            class="select-toggle-button"
            onclick="toggleSelectionMode()"
          >
            <span>
              <Locale
                en={isSelectionMode ? 'View' : 'Select'}
                zh_hk={isSelectionMode ? '查看' : '選擇'}
                zh_cn={isSelectionMode ? '查看' : '选择'}
              />
            </span>
          </ion-button>
          <ion-button
            id="select-all-button"
            class="select-all-button"
            style={`display: ${isSelectionMode ? 'flex' : 'none'};`}
            onclick="toggleSelectAllImages()"
          >
            <span>
              <Locale
                en={selectedImages.length > 0 ? 'Deselect' : 'Select All'}
                zh_hk={isSelectionMode ? '取消選擇' : '全選'}
                zh_cn={isSelectionMode ? '取消选择' : '全选'}
              />
            </span>
          </ion-button>
          <ion-button
            id="toggle-labels-button"
            class="label-toggle-button"
            onclick="toggleLabels()"
          >
            <span>
              <Locale
                en={isLabelVisible ? 'Hide' : 'Show'}
                zh_hk={isLabelVisible ? '隱藏' : '顯示'}
                zh_cn={isLabelVisible ? '隐藏' : '显示'}
              />
            </span>
          </ion-button>
          <div
            id="label-toggle-container"
            style={`position: absolute; right: 0; top: 0; display: ${isLabelVisible ? 'flex' : 'none'}; flex-direction: column; gap: 0.25rem; z-index: 10;`}
          >
            {mapArray(proxy.label, label => {
              let annotated_count = db
                .prepare<{ label_id: number }, number>(
                  /* sql */ `
                  SELECT COUNT(DISTINCT il.image_id)
                  FROM image_label il
                  WHERE il.label_id = :label_id
                `,
                )
                .pluck()
                .get({ label_id: label.id! })
              let state = labelStates[label.id!] || 'empty'
              return (
                <div class="label-container">
                  <div class="class-label">{label.title}</div>
                  <ion-button
                    id={`label-state-button-${label.id}`}
                    class={`label-state-button ${state}`}
                    fill="clear"
                    onclick={`toggleLabelState(${label.id})`}
                  >
                    <ion-icon
                      name={
                        state === 'correct'
                          ? 'checkmark-circle'
                          : state === 'incorrect'
                            ? 'close-circle'
                            : 'ellipse-outline'
                      }
                      style={{
                        '--ionicon-stroke-width':
                          state === 'correct' || state === 'incorrect'
                            ? '64px'
                            : '32px',
                        'color':
                          state === 'correct'
                            ? '#4caf50'
                            : state === 'incorrect'
                              ? '#f44336'
                              : '#999',
                      }}
                    ></ion-icon>
                  </ion-button>
                  <progress
                    value={annotated_count}
                    max={totalImages || 1}
                  ></progress>
                </div>
              )
            })}
          </div>
          <div class="section all-images-section">
            <div class="image-grid">
              {mapArray(images, item => (
                <div class="image-item" key={`image-${item.image_id}`}>
                  <input
                    type="checkbox"
                    class="image-checkbox"
                    style={`display: ${isSelectionMode ? 'block' : 'none'};`}
                    data-image-id={item.image_id}
                    checked={selectedImages.includes(item.image_id)}
                  />
                  <img
                    src={`/uploads/${item.filename}`}
                    alt="Image"
                    data-rotation={item.rotation}
                    onload="initAnnotationImage(this)"
                    onclick={`handleImageClick('${item.filename}', ${item.rotation}, ${item.image_id})`}
                  />
                </div>
              ))}
            </div>
            <div class="no-images-message" hidden={images.length > 0}>
              <p>
                <Locale
                  en="No images in dataset."
                  zh_hk="數據集中沒有圖片。"
                  zh_cn="数据集中没有图像。"
                />
              </p>
            </div>
            <div style="display: flex; justify-content: center; margin: 1rem 0;">
              <ion-button
                id="import-button"
                class="import-button"
                color="primary"
                onclick="handleImport()"
              >
                <span>
                  <Locale en="Import" zh_hk="匯入" zh_cn="导入" />
                </span>
              </ion-button>
            </div>
          </div>
        </div>
        <ion-toolbar
          id="selection-toolbar"
          style={`position: fixed; bottom: 0; width: 100%; display: ${isSelectionMode && selectedImages.length > 0 ? 'block' : 'none'}; z-index: 10;`}
        >
          <div style="display: flex; justify-content: space-around; padding: 0.5rem;">
            <ion-button fill="clear" color="warning" onclick="handleUnlabel()">
              <ion-icon name="close-circle" slot="start"></ion-icon>
              <Locale en="Unlabel" zh_hk="取消標籤" zh_cn="取消标签" />
            </ion-button>
            <ion-button fill="clear" color="danger" onclick="handleDelete()">
              <ion-icon name="trash" slot="start"></ion-icon>
              <Locale en="Delete" zh_hk="刪除" zh_cn="删除" />
            </ion-button>
            <ion-button
              fill="clear"
              color="primary"
              onclick="showExportConfirmModal()"
            >
              <ion-icon name="download" slot="start"></ion-icon>
              <Locale en="Export" zh_hk="匯出" zh_cn="导出" />
            </ion-button>
          </div>
        </ion-toolbar>
      </div>
      <ion-modal id="imageModal" backdropDismiss={true}>
        <ion-content>
          <div class="modal-content">
            <div class="sidebar">
              <h3>
                <Locale en="Label Status" zh_hk="標籤狀態" zh_cn="标签状态" />
              </h3>
              <div id="labelStatus" class="loading">
                Loading...
              </div>
            </div>
            <div class="image-container">
              <img id="enlargedImage" src="" alt="Enlarged image" />
              <div class="nav-buttons">
                <ion-button id="btn_previous" onclick="showPreviousImage()">
                  <Locale en="Previous" zh_hk="上一張" zh_cn="上一张" />
                </ion-button>
                <ion-button id="btn_next" onclick="showNextImage()">
                  <Locale en="Next" zh_hk="下一張" zh_cn="下一张" />
                </ion-button>
              </div>
            </div>
          </div>
        </ion-content>
      </ion-modal>
      {Script(`
        setTimeout(() => {
          setImagesData(${JSON.stringify(images)});
          setFilteredImagesData(${JSON.stringify(images)});
          initLabelStates(${JSON.stringify(proxy.label)});
          labelStates = ${JSON.stringify(labelStatesArray)};
          isLabelVisible = ${JSON.stringify(isLabelVisible)};
          const container = document.getElementById('label-toggle-container');
          if (container) {
            container.style.display = ${JSON.stringify(isLabelVisible ? 'flex' : 'none')};
          }
          isSelectionMode = ${JSON.stringify(isSelectionMode)};
          selectedImages = ${JSON.stringify(selectedImages)};
          const modal = document.getElementById('imageModal');
          if (modal) {
            updateButtonStates();
          }
          const selectAllButton = document.getElementById('select-all-button');
          if (selectAllButton) {
            selectAllButton.style.display = ${JSON.stringify(isSelectionMode ? 'flex' : 'none')};
          }
          const selectionToolbar = document.getElementById('selection-toolbar');
          if (selectionToolbar) {
            selectionToolbar.style.display = ${JSON.stringify(isSelectionMode && selectedImages.length > 0 ? 'block' : 'none')};
          }
          updateSelectAllButton();
        }, 0)
      `)}
    </>
  )
}

function filterImagesByLabelStates(
  images: { image_id: number; filename: string; rotation: number }[],
  labelStates: Record<number, 'empty' | 'correct' | 'incorrect' | 'unlabeled'>,
) {
  const filterLabels = Object.entries(labelStates)
    .filter(([_, state]) => state !== 'empty')
    .map(([labelId, state]) => ({ labelId: Number(labelId), state }))

  if (filterLabels.length === 0) return images

  return images.filter(img => {
    return filterLabels.every(({ labelId, state }) => {
      const row = db
        .prepare<
          { image_id: number; label_id: number },
          { answer: number | null }
        >(`SELECT answer FROM image_label WHERE image_id = :image_id AND label_id = :label_id ORDER BY id DESC LIMIT 1`)
        .get({ image_id: img.image_id, label_id: labelId })

      if (state === 'correct') return row && row.answer === 1
      if (state === 'incorrect') return row && row.answer === 0
      if (state === 'unlabeled') return !row
      return true
    })
  })
}

let loadLabelStatusParser = object({
  image_id: id(),
})

function LoadLabelStatus(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = loadLabelStatusParser.parse(body)
    let image_id = input.image_id
    let labels = select_image_label_status.all({ image_id })

    if (!labels || labels.length === 0) {
      context.ws.send([
        'update-in',
        '#labelStatus',
        <div class="no-labels-message">
          <p>
            {Locale(
              {
                en: 'No labels found for this image.',
                zh_hk: '此圖片沒有找到任何標籤。',
                zh_cn: '此图片没有找到任何标签。',
              },
              context,
            )}
          </p>
        </div>,
      ])
    } else {
      context.ws.send([
        'update-in',
        '#labelStatus',
        <div>
          {mapArray(labels, status => (
            <div class="label-item">
              <div class="label-title">{status.label_title}</div>
              <div class="control-buttons">
                <ion-button
                  size="small"
                  color="success"
                  class={status.answer === 0 ? 'half-transparent' : ''}
                  onclick={`updateAnnotation(${status.label_id}, ${image_id}, true)`}
                  title={
                    <Locale
                      en="Annotate as having the label"
                      zh_hk="標註為有標籤"
                      zh_cn="标注为有标签"
                    />
                  }
                >
                  <ion-icon name="checkmark" slot="icon-only"></ion-icon>
                </ion-button>
                <ion-button
                  size="small"
                  color="danger"
                  class={status.answer === 1 ? 'half-transparent' : ''}
                  onclick={`updateAnnotation(${status.label_id}, ${image_id}, false)`}
                  title={
                    <Locale
                      en="Annotate as not having the label"
                      zh_hk="標註為沒有標籤"
                      zh_cn="标注为没有标签"
                    />
                  }
                >
                  <ion-icon name="close" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
            </div>
          ))}
        </div>,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('LoadLabelStatus Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let updateAnnotationParser = object({
  label_id: id(),
  image_id: id(),
  answer: boolean(),
})

function UpdateAnnotation(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = updateAnnotationParser.parse(body)
    let user_id = getAuthUserId(context)!
    if (!user_id) {
      throw new Error('Login required')
    }

    db.prepare(
      /* sql */ `
      DELETE FROM image_label
      WHERE image_id = :image_id AND label_id = :label_id
    `,
    ).run({
      image_id: input.image_id,
      label_id: input.label_id,
    })

    db.prepare(
      /* sql */ `
      INSERT INTO image_label (image_id, label_id, answer, user_id)
      VALUES (:image_id, :label_id, :answer, :user_id)
    `,
    ).run({
      image_id: input.image_id,
      label_id: input.label_id,
      answer: input.answer ? 1 : 0,
      user_id,
    })

    for (const label of proxy.label) {
      const annotated_count = db
        .prepare(
          `SELECT COUNT(DISTINCT il.image_id) FROM image_label il WHERE il.label_id = ?`,
        )
        .pluck()
        .get(label.id)

      context.ws.send([
        'eval',
        `
        var btn = document.getElementById('label-state-button-${label.id}');
        if(btn) {
          var progress = btn.parentElement.querySelector('progress');
          if(progress) progress.value = ${annotated_count};
        }
        `,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('UpdateAnnotation Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let batchUnlabelParser = object({
  image_ids: array(id()),
})

function BatchUnlabel(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = batchUnlabelParser.parse(body)
    let user_id = getAuthUserId(context)!
    if (!user_id) {
      throw new Error('Login required')
    }

    input.image_ids.forEach(image_id => {
      db.prepare(
        /* sql */ `
        DELETE FROM image_label
        WHERE image_id = :image_id
      `,
      ).run({ image_id })
    })

    context.ws.send([
      'eval',
      `
      const unlabelIds = ${JSON.stringify(input.image_ids)};
      imagesData = imagesData.filter(img => !unlabelIds.includes(img.image_id));
      filteredImagesData = filteredImagesData.filter(img => !unlabelIds.includes(img.image_id));
      selectedImages = [];
      isSelectionMode = false;
      updateSelectAllButton && updateSelectAllButton();
      `,
    ])

    for (const label of proxy.label) {
      const annotated_count = db
        .prepare(
          `SELECT COUNT(DISTINCT il.image_id) FROM image_label il WHERE il.label_id = ?`,
        )
        .pluck()
        .get(label.id)

      context.ws.send([
        'eval',
        `
        var btn = document.getElementById('label-state-button-${label.id}');
        if(btn) {
          var progress = btn.parentElement.querySelector('progress');
          if(progress) progress.value = ${annotated_count};
        }
        `,
      ])
    }

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('BatchUnlabel Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let batchDeleteParser = object({
  image_ids: array(id()),
})

function BatchDelete(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = batchDeleteParser.parse(body)
    let user_id = getAuthUserId(context)!
    if (!user_id) {
      throw new Error('Login required')
    }

    let deletedCount = 0
    let errors: string[] = []

    db.transaction(() => {
      input.image_ids.forEach(image_id => {
        const image = db
          .prepare<{ image_id: number }, { filename: string }>(
            /* sql */ `
            SELECT filename
            FROM image
            WHERE id = :image_id
          `,
          )
          .get({ image_id })

        if (!image) {
          errors.push(`Image ID ${image_id}: Not found in database`)
          return
        }

        db.prepare(
          /* sql */ `
          DELETE FROM image_label
          WHERE image_id = :image_id
        `,
        ).run({ image_id })

        db.prepare(
          /* sql */ `
          DELETE FROM image
          WHERE id = :image_id
        `,
        ).run({ image_id })

        try {
          const filePath = join(process.cwd(), 'uploads', image.filename)
          fsPromises.rm(filePath, { force: true })
          deletedCount++
          console.log(`Deleted file: ${filePath}`)
        } catch (err) {
          errors.push(
            `Image ID ${image_id} (${image.filename}): Failed to delete file: ${err}`,
          )
          console.error(`Failed to delete file ${image.filename}:`, err)
        }
      })
    })()

    context.ws.send([
      'eval',
      `
          const deletedIds = ${JSON.stringify(input.image_ids)};
          imagesData = imagesData.filter(img => !deletedIds.includes(img.image_id));
          filteredImagesData = filteredImagesData.filter(img => !deletedIds.includes(img.image_id));
          selectedImages = [];
          isSelectionMode = false;
          const imageGrid = document.querySelector('.image-grid');
          if (imageGrid) {
            imageGrid.innerHTML = '';
            imagesData.forEach(item => {
              const div = document.createElement('div');
              div.className = 'image-item';
              div.innerHTML = \`
                <input type="checkbox" class="image-checkbox" style="display: none;" data-image-id="\${item.image_id}" />
                <img src="/uploads/\${item.filename}" alt="Image" data-rotation="\${item.rotation}" onload="initAnnotationImage(this)" onclick="handleImageClick('\${item.filename}', \${item.rotation}, \${item.image_id})" />
              \`;
              imageGrid.appendChild(div);
            });
          }
          const selectionToolbar = document.getElementById('selection-toolbar');
          if (selectionToolbar) selectionToolbar.style.display = 'none';
          const noImagesMsg = document.querySelector('.no-images-message');
          if (noImagesMsg) noImagesMsg.hidden = imagesData.length > 0;
          updateSelectAllButton && updateSelectAllButton();
          `,
    ])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('BatchDelete Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let batchExportParser = object({
  image_ids: array(id()),
  label_ids: array(id()),
  organizeByLabel: boolean(),
})

function BatchExport(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = batchExportParser.parse(body)
    let user_id = getAuthUserId(context)!
    if (!user_id) {
      throw new Error('Login required')
    }

    const images = db
      .prepare<
        { image_ids: number[] },
        {
          image_id: number
          filename: string
          original_filename: string | null
          rotation: number | null
        }
      >(
        /* sql */ `
        SELECT id AS image_id, filename, original_filename, rotation
        FROM image
        WHERE id IN (${input.image_ids.join(',')})
      `,
      )
      .all({ image_ids: input.image_ids })
      .filter(item => item.filename && !item.filename.startsWith('data:image'))

    const imageMap = new Map(
      images.map(img => [
        img.image_id,
        { filename: img.filename, original_filename: img.original_filename },
      ]),
    )

    const labels =
      input.label_ids.length > 0
        ? db
            .prepare<
              { image_ids: number[]; label_ids: number[] },
              {
                image_id: number
                label_id: number
                label_title: string
                answer: number
              }
            >(
              /* sql */ `
            SELECT il.image_id, il.label_id, l.title AS label_title, il.answer
            FROM image_label il
            JOIN label l ON il.label_id = l.id
            WHERE il.image_id IN (${input.image_ids.join(',')})
            AND il.label_id IN (${input.label_ids.join(',')})
            AND il.id = (
              SELECT MAX(il2.id)
              FROM image_label il2
              WHERE il2.image_id = il.image_id
              AND il2.label_id = il.label_id
            )
          `,
            )
            .all({ image_ids: input.image_ids, label_ids: input.label_ids })
        : []

    const exportData = images.map(image => ({
      image_id: image.image_id,
      filename: image.original_filename
        ? `${image.image_id}_${image.original_filename}`
        : `${image.image_id}_${image.filename}`,
      rotation: image.rotation || 0,
      labels: labels
        .filter(label => label.image_id === image.image_id)
        .map(label => ({
          label_id: label.label_id,
          label_title: label.label_title,
          answer: label.answer,
        })),
    }))

    // use adm-zip to generate ZIP
    const zip = new AdmZip()
    if (input.organizeByLabel) {
      exportData.forEach(data => {
        const imageInfo = imageMap.get(data.image_id)
        if (!imageInfo) {
          console.warn(`Skipping image ${data.image_id}: Image info not found`)
          return
        }
        const originalFilename = imageInfo.filename
        const exportFilename = data.filename
        const filePath = path.join(process.cwd(), 'uploads', originalFilename)
        data.labels.forEach(label => {
          const folder = `${label.label_title}/${label.answer === 1 ? 'correct' : 'incorrect'}`
          zip.addLocalFile(filePath, folder, exportFilename)
        })
        if (data.labels.length === 0 && input.label_ids.length === 0) {
          zip.addLocalFile(filePath, '', exportFilename)
        }
      })
    } else {
      exportData.forEach(data => {
        const imageInfo = imageMap.get(data.image_id)
        if (!imageInfo) {
          console.warn(`Skipping image ${data.image_id}: Image info not found`)
          return
        }
        const originalFilename = imageInfo.filename
        const exportFilename = data.filename
        const filePath = path.join(process.cwd(), 'uploads', originalFilename)
        if (data.labels.length > 0 || input.label_ids.length === 0) {
          zip.addLocalFile(filePath, '', exportFilename)
        }
      })
    }
    // add metadata JSON
    zip.addFile(
      'metadata.json',
      Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8'),
    )

    const zipBuffer = zip.toBuffer()
    const base64Zip = zipBuffer.toString('base64')

    context.ws.send([
      'eval',
      `
      const byteCharacters = atob('${base64Zip}');
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'exported_images_${new Date().toISOString()}.zip';
      a.click();
      URL.revokeObjectURL(url);
      const toast = document.createElement('ion-toast');
      toast.message = 'Exported ${exportData.length} images.';
      toast.duration = 5000;
      document.body.appendChild(toast);
      toast.present();
      `,
    ])

    context.ws.send(['update', <Main />])

    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('BatchExport Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

let importZipParser = object({
  zipData: string(),
})

async function ImportZip(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = importZipParser.parse(body)
    let user_id = getAuthUserId(context)!
    if (!user_id) {
      throw new Error('User not authenticated')
    }

    const uploadDir = join(process.cwd(), 'uploads')
    await fsPromises.mkdir(uploadDir, { recursive: true })

    let buffer = Buffer.from(input.zipData, 'base64')
    let zip = new AdmZip(buffer)
    let entries = zip.getEntries()

    let processedImages: {
      filename: string
      image_id: number
      original_filename: string
    }[] = []
    let errors: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory) continue

      let name = entry.entryName
      let ext = basename(name).toLowerCase().split('.').pop()

      if (['jpg', 'png', 'webp', 'heic', 'gif', 'jpeg'].includes(ext!)) {
        try {
          let filename = `${uuid()}.${ext}`
          let filepath = join(uploadDir, filename)
          let original_filename = basename(name)

          let existingImage = db
            .prepare(
              /* sql */ `
              SELECT id FROM image WHERE filename = :filename OR original_filename = :original_filename
            `,
            )
            .get({ filename, original_filename })

          if (existingImage) {
            console.log(`Skipped existing image: ${name}`)
            continue
          }

          await fsPromises.writeFile(filepath, entry.getData())
          console.log(`Imported file: ${filepath}`)

          let image_id: number | undefined
          db.transaction(() => {
            let result = db
              .prepare(
                /* sql */ `
                INSERT INTO image (filename, user_id, original_filename)
                VALUES (:filename, :user_id, :original_filename)
              `,
              )
              .run({ filename, user_id, original_filename })
            image_id = Number(result.lastInsertRowid)
          })()

          if (image_id === undefined) {
            throw new Error(`Cannot assign image_id for ${name}`)
          }

          processedImages.push({ filename, image_id, original_filename })
        } catch (err) {
          errors.push(`Failed to process ${name}: ${err}`)
          console.error(`Failed to process ${name}:`, err)
        }
      }
    }

    context.ws.send([
      'batch',
      [
        [
          'update-in',
          '.image-grid',
          nodeToVNode(
            <>
              {processedImages.length > 0
                ? mapArray(processedImages, item => (
                    <div class="image-item" key={`image-${item.image_id}`}>
                      <input
                        type="checkbox"
                        class="image-checkbox"
                        style="display: none;"
                        data-image-id={item.image_id}
                      />
                      <img
                        src={`/uploads/${item.filename}`}
                        alt="image"
                        data-rotation="0"
                        onload="initAnnotationImage(this)"
                        onclick={`handleImageClick('${item.filename}', 0, ${item.image_id})`}
                      />
                    </div>
                  ))
                : null}
            </>,
            context,
          ),
        ],
        [
          'update-in',
          '.no-images-message',
          nodeToVNode(
            <div class="no-images-message" hidden={processedImages.length > 0}>
              <p>
                <Locale
                  en="No images in dataset."
                  zh_hk="數據集中沒有圖片。"
                  zh_cn="数据集中没有图像。"
                />
              </p>
            </div>,
            context,
          ),
        ],
        [
          'eval',
          `
          imagesData = imagesData.concat(${JSON.stringify(
            processedImages.map(item => ({
              image_id: item.image_id,
              filename: item.filename,
              rotation: 0,
            })),
          )});
          filteredImagesData = filteredImagesData.concat(${JSON.stringify(
            processedImages.map(item => ({
              image_id: item.image_id,
              filename: item.filename,
              rotation: 0,
            })),
          )});
          const noImagesMsg = document.querySelector('.no-images-message');
          if (noImagesMsg) noImagesMsg.hidden = imagesData.length > 0;
          const toast = document.createElement('ion-toast');
          toast.message = 'Successfully imported ${processedImages.length} images.${errors.length > 0 ? ' Errors: ' + errors.length : ''}';
          toast.duration = 5000;
          document.body.appendChild(toast);
          toast.present();
          `,
        ],
      ],
    ])

    if (errors.length > 0) {
      console.warn('ImportZip errors:', errors)
      context.ws.send([
        'eval',
        `
        const toast = document.createElement('ion-toast');
        toast.message = 'Import errors: ${errors.join('; ')}';
        toast.duration = 7000;
        toast.color = 'warning';
        document.body.appendChild(toast);
        toast.present();
        `,
      ])
    }

    return
  } catch (error) {
    console.error('ImportZip errors:', error)
    context.ws.send(showError(error))
    return
  }
}

let routes = {
  '/manage-dataset': {
    title: <Title t={pageTitle} />,
    description: 'Manage images in the dataset',
    node: page,
  },
  '/manage-dataset/load-label-status': {
    title: apiEndpointTitle,
    description: 'Load label status for an image in the modal',
    node: <LoadLabelStatus />,
  },
  '/manage-dataset/toggle-labels': {
    title: apiEndpointTitle,
    description: 'Toggle label container visibility',
    node: <ToggleLabels />,
  },
  '/manage-dataset/toggle-label-state': {
    title: apiEndpointTitle,
    description: 'Toggle label state (empty, correct, incorrect)',
    node: <ToggleLabelState />,
  },
  '/manage-dataset/toggle-selection-mode': {
    title: apiEndpointTitle,
    description: 'Toggle selection mode',
    node: <ToggleSelectionMode />,
  },
  '/manage-dataset/update-select-all-button': {
    title: apiEndpointTitle,
    description: 'Update select all button text',
    node: <UpdateSelectAllButton />,
  },
  '/manage-dataset/update-select-all-labels-button': {
    title: apiEndpointTitle,
    description: 'Update select all labels button text in export modal',
    node: <UpdateSelectAllLabelsButton />,
  },
  '/manage-dataset/update-annotation': {
    title: apiEndpointTitle,
    description: 'Update annotation for a label on an image',
    node: <UpdateAnnotation />,
  },
  '/manage-dataset/batch-unlabel': {
    title: apiEndpointTitle,
    description: 'Batch unlabel selected images',
    node: <BatchUnlabel />,
  },
  '/manage-dataset/batch-delete': {
    title: apiEndpointTitle,
    description: 'Batch delete selected images',
    node: <BatchDelete />,
  },
  '/manage-dataset/batch-export': {
    title: apiEndpointTitle,
    description: 'Batch export selected images as ZIP',
    node: <BatchExport />,
  },
  '/manage-dataset/import-zip': {
    title: apiEndpointTitle,
    description: 'Import ZIP file and add images to dataset',
    node: <ImportZip />,
  },
} satisfies Routes

export default { routes }
