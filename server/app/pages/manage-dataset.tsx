import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { ajaxRoute } from '../api-route.js'
import { apiEndpointTitle, LayoutType } from '../../config.js'
import Style from '../components/style.js'
import {
  DynamicContext,
  ExpressContext,
  getContextFormBody,
  WsContext,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { array, boolean, id, object, string, values } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle, makeThrows } from '../components/locale.js'
import { del, filter, seedRow } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { EarlyTerminate } from '../../exception.js'
import { nodeToVNode } from '../jsx/vnode.js'
import {
  getContextProject,
  select_project_label,
} from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { IonButton } from '../components/ion-button.js'
import { env } from '../../env.js'
import { basename, join } from 'path'
import { promises as fsPromises, rmSync } from 'fs'
import AdmZip from 'adm-zip'
import { createUploadForm } from '../upload.js'

let pageTitle = (
  <Locale en="Manage Dataset" zh_hk="管理數據集" zh_cn="管理数据集" />
)

let imagePlugin = loadClientPlugin({
  entryFile: 'dist/client/image.js',
})
let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let style = Style(/* css */ `
#ManageDataset {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* mode segment (Browse / Review) */
#ManageDataset .mode-segment {
  margin: 0.5rem 0;
}

/* ---------- shared image grid ---------- */
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
#ManageDataset .image-wrapper {
  position: relative;
  display: block;
  width: 100%;
  line-height: 0;
}
#ManageDataset .image-wrapper img {
  display: block;
  width: 100%;
  height: 150px;
  object-fit: contain;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s ease;
  background: #f0f0f0;
}
#ManageDataset .image-wrapper canvas.bounding-box-canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  border-radius: 8px;
  z-index: 1;
}
#ManageDataset .image-item.selected .image-wrapper img {
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
#ManageDataset .image-checkbox {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 10;
}

/* ---------- review mode (yes/no/unknown) ---------- */
#ManageDataset .review-images img {
  width: 100%;
  height: 100px;
  object-fit: contain;
  padding: 0.5rem;
}
#ManageDataset .image-item-container[data-clash='true'] {
  --background: var(--ion-color-danger);
  --color: #fff;
}
#ManageDataset .image-item-container {
  --ripple-color: transparent;
}
#ManageDataset .segment-yes {
  --background: var(--ion-color-success, #28a745);
  --color: #fff;
}
#ManageDataset .segment-no {
  --background: var(--ion-color-danger, #dc3545);
  --color: #fff;
}
#ManageDataset .segment-unknown {
  --background: var(--ion-color-warning, #ffc107);
  --color: #212529;
}
#ManageDataset #answerSegment ion-segment-button {
  border-radius: 1rem;
  margin: 0 0.5rem;
  padding: 0.5rem 0;
  font-size: 1.2rem;
  background: var(--background);
  color: var(--color);
  --indicator-height: 0;
  --ripple-color: transparent;
  --color-checked: var(--color);
  opacity: 0.5;
  transform: scale(0.8);
  transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
}
#ManageDataset #answerSegment ion-segment-button.segment-button-checked {
  opacity: 1;
  transform: scale(1);
}
#ManageDataset .submit-buttons ion-button {
  min-height: 48px;
  min-width: 48px;
  --padding-start: 1.5em;
  --padding-end: 1.5em;
  font-size: 1.5em;
}
#ManageDataset .submit-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
  width: 100%;
  max-width: 720px;
  margin: 1rem auto 0;
  padding: 0 16px;
  box-sizing: border-box;
}

/* ---------- label filter panel (browse) ---------- */
#ManageDataset .label-container {
  background-color: #fff9;
  padding: 0.2rem;
  border-radius: 0.2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
#ManageDataset .label-container .class-label {
  display: flex;
  justify-content: center;
  flex: 1;
}
#ManageDataset .label-container progress {
  width: 4rem;
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
/* dropdown / label-toggle-container 裡的 label-state-button 需要更大空間才能顯示 icon */
#ManageDataset #bbox-count-dropdown .label-state-button,
#ManageDataset #label-toggle-container .label-state-button {
  width: auto;
  height: auto;
  min-width: 1.5rem;
  min-height: 1.5rem;
}
#ManageDataset #bbox-count-dropdown .label-state-button ion-icon,
#ManageDataset #label-toggle-container .label-state-button ion-icon {
  font-size: 1.2rem;
}
#ManageDataset .browse-toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: transparent;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
}
#ManageDataset .browse-toolbar ion-button {
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
  font-size: 0.9rem;
}
#ManageDataset .browse-toolbar ion-button.icon-only-mobile ion-icon {
  margin-inline-end: 0.35rem;
}
#ManageDataset .browse-toolbar ion-button.icon-only-mobile {
  --padding-start: 0.75rem;
}
#label-toggle-container {
  z-index: 10;
}
#ManageDataset .no-images-message {
  text-align: center;
  padding: 2rem;
  z-index: 1;
}

/* ---------- selection toolbar ---------- */
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

/* ---------- image modal ---------- */
#imageModal {
  --width: 80%;
  --height: 80%;
}
#imageModal .modal-content {
  display: flex;
  height: 100%;
  position: relative;
}
#imageModal .modal-back-button {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 20;
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
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
  min-height: 0;
  overflow: hidden;
}
#imageModal .image-container img {
  max-width: 100%;
  max-height: calc(100% - 60px);
  object-fit: contain;
}
#imageModal .enlarged-image-wrapper {
  position: relative;
  display: inline-block;
  line-height: 0;
  max-height: calc(100% - 60px);
  overflow: hidden;
}
#imageModal .enlarged-image-wrapper img {
  display: block;
}
#imageModal .enlarged-image-wrapper canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
#imageModal .nav-buttons {
  position: absolute;
  bottom: 10px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 1rem;
}
#imageModal .nav-buttons ion-button {
  --padding-start: 1rem;
  --padding-end: 1rem;
}

/* ---------- image modal: mobile responsive ---------- */
@media (max-width: 600px) {
  #imageModal {
    --width: 92vw;
    --height: 92vh;
    --border-radius: 12px;
  }
  #imageModal .modal-content {
    flex-direction: column;
  }
  #imageModal .sidebar {
    width: 100%;
    max-height: 40%;
    border-right: none;
    border-bottom: 1px solid #ccc;
  }
  #imageModal .image-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  #imageModal .image-container img {
    max-height: 100%;
  }
  #imageModal .enlarged-image-wrapper {
    max-height: 100%;
  }

  /* ---------- confirm modals: mobile responsive ---------- */
  #deleteConfirmModal > div,
  #unlabelConfirmModal > div,
  #exportConfirmModal > div {
    min-width: auto !important;
    max-width: 92vw !important;
    width: 92vw !important;
    padding: 1.2rem !important;
    margin: 0 4vw !important;
    box-sizing: border-box !important;
  }
  #exportConfirmModal .label-selection-container {
    max-height: 40vh !important;
  }
  #exportConfirmModal > div > div:last-child > div:first-child {
    flex-direction: column !important;
    gap: 0.5rem !important;
  }
  #exportConfirmModal > div > div:last-child > div:first-child > ion-button {
    width: 100% !important;
  }

  /* ---------- browse toolbar: mobile responsive ---------- */
  #ManageDataset .browse-toolbar {
    gap: 0.25rem;
    padding: 0.25rem;
  }
  #ManageDataset .browse-toolbar ion-button {
    --padding-start: 0.35rem;
    --padding-end: 0.35rem;
    font-size: 0.8rem;
  }
  /* import / export: icon only on phone */
  #ManageDataset .browse-toolbar ion-button.icon-only-mobile span {
    display: none;
  }
  #ManageDataset .browse-toolbar ion-button.icon-only-mobile {
    width: 40px;
    height: 40px;
    --padding-start: 0;
    --padding-end: 0;
  }
  #ManageDataset .browse-toolbar ion-button.icon-only-mobile ion-icon {
    margin: 0;
  }
}
#labelStatus.loading {
  text-align: center;
  padding: 1rem;
  color: #555;
}
`)

let script = Script(/* js */ `
function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get('project') || '0');
}

// ---------- shared state ----------
let imagesData = [];
let filteredImagesData = [];
let isLabelVisible = true;
let isBoundingBoxVisible = false;
let bboxCountFilters = []; // empty = all, [1,2,3...] = specific counts
let labelStates = [];
let isToggling = false;
let isSelectionMode = false;
let selectedImages = [];
let isUpdatingAnnotation = false;
let selectedLabels = [];
let organizeByLabel = false;

function initLabelStates(labels) {
  labels.forEach(label => {
    if (!labelStates.some(item => item.id === label.id)) {
      labelStates.push({ id: label.id, state: 'empty' });
    }
  });
}

function setImagesData(images) {
  imagesData = images || [];
}

function setFilteredImagesData(images) {
  filteredImagesData = images || [];
}

// ---------- mode switching ----------
function switchMode(mode) {
  // mode: 'browse' | 'review'
  document.querySelectorAll('.mode-section').forEach(el => el.style.display = 'none');
  const section = document.getElementById('mode-' + mode);
  if (section) section.style.display = 'block';
}

// ---------- browse: label panel ----------
function toggleLabels() {
  isLabelVisible = !isLabelVisible;
  emit('/manage-dataset/toggle-labels', { isLabelVisible, project_id: getProjectId() });
}

function toggleBoundingBoxes() {
  isBoundingBoxVisible = !isBoundingBoxVisible;
  var btn = document.getElementById('toggle-bbox-button');
  if (btn) {
    var span = btn.querySelector('span');
    if (span) {
      span.textContent = isBoundingBoxVisible ? 'Hide BBox' : 'Show BBox';
    }
  }
  var countBtn = document.getElementById('bbox-count-button');
  if (countBtn) {
    countBtn.style.display = isBoundingBoxVisible ? '' : 'none';
  }
  if (!isBoundingBoxVisible) {
    var dd = document.getElementById('bbox-count-dropdown');
    if (dd) dd.style.display = 'none';
    // reset bbox count filter when turning off bbox
    bboxCountFilters = [];
    var countBtn2 = document.getElementById('bbox-count-button');
    if (countBtn2) {
      var span2 = countBtn2.querySelector('span');
      if (span2) span2.textContent = 'Box Count: All';
    }
    updateBboxCountDropdownIcons();
  }
  // apply bbox count filter (hide/show image items)
  applyBboxCountFilter();
  document.querySelectorAll('.image-item img[data-boxes]').forEach(function(img) {
    if (img.dataset.boxes && img.dataset.boxes !== '[]') {
      if (isBoundingBoxVisible) {
        drawBoundingBoxes(img);
      } else {
        var canvas = img.parentElement.querySelector('canvas.bounding-box-canvas');
        if (canvas) { var ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
      }
    }
  });
  var enlarged = document.getElementById('enlargedImage');
  if (enlarged && enlarged.dataset.boxes && enlarged.dataset.boxes !== '[]') {
    if (isBoundingBoxVisible) {
      drawBoundingBoxes(enlarged);
    } else {
      var canvas = enlarged.parentElement.querySelector('canvas.bounding-box-canvas');
      if (canvas) { var ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }
  }
}
window.toggleBoundingBoxes = toggleBoundingBoxes;

function toggleBboxCountDropdown() {
  var dd = document.getElementById('bbox-count-dropdown');
  if (dd) {
    if (dd.style.display === 'none' || !dd.style.display) {
      dd.style.display = 'flex';
      updateBboxCountDropdownIcons();
    } else {
      dd.style.display = 'none';
    }
  }
}
window.toggleBboxCountDropdown = toggleBboxCountDropdown;

function setBboxCountFilter(count) {
  // toggle individual count in array
  var idx = bboxCountFilters.indexOf(count);
  if (idx >= 0) {
    bboxCountFilters.splice(idx, 1);
  } else {
    bboxCountFilters.push(count);
  }
  // update button text
  var countBtn = document.getElementById('bbox-count-button');
  if (countBtn) {
    var span = countBtn.querySelector('span');
    if (span) {
      span.textContent = bboxCountFilters.length === 0
        ? 'Box Count: All'
        : 'Box Count: ' + bboxCountFilters.slice().sort(function(a,b){return a-b;}).join(', ');
    }
  }
  // update dropdown item icons
  updateBboxCountDropdownIcons();
  // apply filter to image grid (hide/show image items)
  applyBboxCountFilter();
  // redraw boxes on visible images
  document.querySelectorAll('.image-item img[data-boxes]').forEach(function(img) {
    if (img.dataset.boxes && img.dataset.boxes !== '[]') {
      drawBoundingBoxes(img);
    }
  });
  var enlarged = document.getElementById('enlargedImage');
  if (enlarged && enlarged.dataset.boxes && enlarged.dataset.boxes !== '[]') {
    drawBoundingBoxes(enlarged);
  }
}
window.setBboxCountFilter = setBboxCountFilter;

function updateBboxCountDropdownIcons() {
  // individual count buttons
  var dropdown = document.getElementById('bbox-count-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('ion-button[id^="bbox-count-state-"]').forEach(function(btn) {
      var count = parseInt(btn.id.replace('bbox-count-state-', ''), 10);
      if (isNaN(count)) return;
      var icon = btn.querySelector('ion-icon');
      if (icon) {
        var selected = bboxCountFilters.indexOf(count) >= 0;
        icon.setAttribute('name', selected ? 'checkmark-circle' : 'ellipse-outline');
        icon.style.setProperty('--ionicon-stroke-width', selected ? '64px' : '32px');
        icon.style.color = selected ? '#4caf50' : '#999';
      }
    });
  }
}
window.updateBboxCountDropdownIcons = updateBboxCountDropdownIcons;

function applyBboxCountFilter() {
  // if no filter selected, show all
  if (bboxCountFilters.length === 0) {
    document.querySelectorAll('.image-item').forEach(function(item) {
      item.style.display = '';
    });
    return;
  }
  // otherwise hide/show based on box count
  document.querySelectorAll('.image-item').forEach(function(item) {
    var img = item.querySelector('img[data-boxes]');
    if (!img) { item.style.display = ''; return; }
    var boxes = [];
    try { boxes = JSON.parse(img.dataset.boxes || '[]') || []; } catch(e) { boxes = []; }
    item.style.display = bboxCountFilters.indexOf(boxes.length) >= 0 ? '' : 'none';
  });
}
window.applyBboxCountFilter = applyBboxCountFilter;

document.addEventListener('click', function(e) {
  var dd = document.getElementById('bbox-count-dropdown');
  var btn = document.getElementById('bbox-count-button');
  if (dd && dd.style.display !== 'none' && btn && !btn.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

function toggleLabelState(label_id) {
  if (isToggling) return;
  isToggling = true;
  const currentItem = labelStates.find(item => item.id === label_id) || { id: label_id, state: 'empty' };
  const currentState = currentItem.state;
  const nextState = currentState === 'empty' ? 'correct' : currentState === 'correct' ? 'incorrect' : 'empty';
  labelStates = labelStates.filter(item => item.id !== label_id).concat([{ id: label_id, state: nextState }]);
  emit('/manage-dataset/toggle-label-state', {
    label_id,
    state: nextState,
    labelStates: JSON.parse(JSON.stringify(labelStates)),
    isSelectionMode,
    selectedImages,
    project_id: getProjectId(),
  });
  setTimeout(() => { isToggling = false; }, 200);
}

// ---------- browse: selection ----------
function toggleSelectionMode() {
  isSelectionMode = !isSelectionMode;
  selectedImages = [];
  emit('/manage-dataset/toggle-selection-mode', { isSelectionMode });
  const selectAllButton = document.getElementById('select-all-button');
  if (selectAllButton) selectAllButton.style.display = isSelectionMode ? 'flex' : 'none';
  const selectionToolbar = document.getElementById('selection-toolbar');
  if (selectionToolbar) selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none';
  document.querySelectorAll('.image-checkbox').forEach(checkbox => {
    checkbox.style.display = isSelectionMode ? 'block' : 'none';
    checkbox.checked = false;
    const imageItem = checkbox.closest('.image-item');
    if (imageItem) imageItem.classList.remove('selected');
  });
  updateSelectAllButton();
}

function toggleImageSelection(image_id) {
  if (!isSelectionMode) return;
  const checkbox = document.querySelector('input.image-checkbox[data-image-id="' + image_id + '"]');
  const imageItem = checkbox ? checkbox.closest('.image-item') : null;
  if (selectedImages.includes(image_id)) {
    selectedImages = selectedImages.filter(id => id !== image_id);
    if (checkbox) checkbox.checked = false;
    if (imageItem) imageItem.classList.remove('selected');
  } else {
    selectedImages.push(image_id);
    if (checkbox) checkbox.checked = true;
    if (imageItem) imageItem.classList.add('selected');
  }
  const selectionToolbar = document.getElementById('selection-toolbar');
  if (selectionToolbar) selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none';
  updateSelectAllButton();
}

function handleImageClick(filename, rotation, image_id) {
  if (isSelectionMode) {
    toggleImageSelection(image_id);
  } else {
    showEnlargedImage('/uploads/' + filename, rotation || 0, image_id);
  }
}

function toggleSelectAllImages() {
  if (!isSelectionMode) return;
  if (selectedImages.length > 0) {
    selectedImages = [];
    document.querySelectorAll('.image-checkbox').forEach(checkbox => {
      checkbox.checked = false;
      const imageItem = checkbox.closest('.image-item');
      if (imageItem) imageItem.classList.remove('selected');
    });
  } else {
    selectedImages = filteredImagesData.map(item => item.image_id);
    document.querySelectorAll('.image-checkbox').forEach(checkbox => {
      checkbox.checked = true;
      const imageItem = checkbox.closest('.image-item');
      if (imageItem) imageItem.classList.add('selected');
    });
  }
  const selectionToolbar = document.getElementById('selection-toolbar');
  if (selectionToolbar) selectionToolbar.style.display = isSelectionMode && selectedImages.length > 0 ? 'block' : 'none';
  updateSelectAllButton();
}

function updateSelectAllButton() {
  emit('/manage-dataset/update-select-all-button', { hasSelectedImages: selectedImages.length > 0 });
}

// ---------- browse: batch ops ----------
function handleUnlabel() {
  if (selectedImages.length === 0) return;
  showConfirmModal('unlabel');
}
function handleDelete() {
  if (selectedImages.length === 0) return;
  showConfirmModal('delete');
}
function showConfirmModal(type) {
  const modal = document.getElementById(type + 'ConfirmModal');
  if (modal) modal.style.display = 'flex';
}
function closeConfirmModal(type) {
  const modal = document.getElementById(type + 'ConfirmModal');
  if (modal) modal.style.display = 'none';
}
function confirmUnlabelImages() {
  closeConfirmModal('unlabel');
  if (selectedImages.length === 0) return;
  emit('/manage-dataset/batch-unlabel', { image_ids: selectedImages, project_id: getProjectId() });
  selectedImages = [];
  toggleSelectionMode();
}
function confirmDeleteImages() {
  closeConfirmModal('delete');
  if (selectedImages.length === 0) return;
  emit('/manage-dataset/batch-delete', { image_ids: selectedImages, project_id: getProjectId() });
  selectedImages = [];
  toggleSelectionMode();
}

// ---------- browse: export ----------
function showExportConfirmModal() {
  const modal = document.getElementById('exportConfirmModal');
  if (modal) {
    modal.style.display = 'flex';
    const checkbox = document.getElementById('organizeByLabelCheckbox');
    if (checkbox) {
      checkbox.checked = selectedLabels.length > 0;
      organizeByLabel = checkbox.checked;
    }
    document.querySelectorAll('.label-checkbox').forEach(cb => {
      cb.checked = selectedLabels.includes(parseInt(cb.dataset.labelId));
    });
    updateSelectAllLabelsButton();
  }
}
function closeExportConfirmModal() {
  const modal = document.getElementById('exportConfirmModal');
  if (modal) modal.style.display = 'none';
}
function updateOrganizeByLabel() {
  const checkbox = document.getElementById('organizeByLabelCheckbox');
  if (checkbox) {
    const anyLabelChecked = document.querySelectorAll('.label-checkbox:checked').length > 0;
    checkbox.checked = anyLabelChecked;
    organizeByLabel = anyLabelChecked;
  }
}
function selectAllLabels() {
  const checkboxes = document.querySelectorAll('.label-checkbox');
  const anyChecked = document.querySelectorAll('.label-checkbox:checked').length > 0;
  checkboxes.forEach(cb => { cb.checked = !anyChecked; });
  selectedLabels = anyChecked ? [] : Array.from(checkboxes).map(cb => parseInt(cb.dataset.labelId));
  updateOrganizeByLabel();
  updateSelectAllLabelsButton();
}
function updateSelectAllLabelsButton() {
  emit('/manage-dataset/update-select-all-labels-button', { anyLabelChecked: document.querySelectorAll('.label-checkbox:checked').length > 0 });
}
function exportImages() {
  closeExportConfirmModal();
  const checkbox = document.getElementById('organizeByLabelCheckbox');
  organizeByLabel = checkbox ? checkbox.checked : false;
  selectedLabels = Array.from(document.querySelectorAll('.label-checkbox:checked')).map(cb => parseInt(cb.dataset.labelId));
  const payload = isSelectionMode && selectedImages.length > 0
    ? { image_ids: selectedImages, label_ids: selectedLabels, organizeByLabel, project_id: getProjectId() }
    : { image_ids: imagesData.map(img => img.image_id), label_ids: selectedLabels, organizeByLabel, project_id: getProjectId() };
  emit('/manage-dataset/batch-export', payload);
  selectedImages = [];
  toggleSelectionMode();
}

// ---------- browse: dataset export / import ----------
function exportDataset() {
  emit('/manage-dataset/export-dataset', { project_id: getProjectId() });
}
function importDataset(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  fetch('/manage-dataset/import-dataset?project=' + getProjectId(), {
    method: 'POST',
    body: formData,
  })
    .then(res => res.json())
    .then(json => {
      if (json.error) {
        if (typeof showError === 'function') showError(json.error);
        else alert(json.error);
        return;
      }
      if (typeof showToast === 'function') {
        showToast(
          'Imported ' + json.imported_images + ' images, ' +
          json.imported_labels + ' labels, ' +
          json.imported_boxes + ' boxes. ' +
          json.skipped_images + ' skipped, ' +
          json.created_labels + ' labels created.',
          'success'
        );
      }
      // reload the page to reflect imported data
      window.location.reload();
    })
    .catch(err => {
      if (typeof showError === 'function') showError(err);
      else alert(err);
    })
    .finally(() => {
      input.value = '';
    });
}

// ---------- browse: image modal ----------
function initAnnotationImage(image) {
  let degree = +image.dataset.rotation || 0;
  function check() {
    if (!degree) {
      image.onload = null;
      drawBoundingBoxes(image);
      return;
    }
    degree -= 90;
    rotateImageInline(image);
    image.onload = check;
  }
  check();
}

function drawBoundingBoxes(image) {
  if (!isBoundingBoxVisible) return;
  var canvas = image.parentElement.querySelector('canvas.bounding-box-canvas');
  if (!canvas || !image) return;

  var boxes = [];
  try {
    boxes = JSON.parse(image.dataset.boxes || '[]') || [];
  } catch (e) {
    boxes = [];
  }

  if (!image.clientWidth || !image.clientHeight) {
    if (!document.body.contains(image)) return;
    setTimeout(function() { drawBoundingBoxes(image); }, 33);
    return;
  }

  var imgW = image.naturalWidth;
  var imgH = image.naturalHeight;
  if (!imgW || !imgH) {
    setTimeout(function() { drawBoundingBoxes(image); }, 33);
    return;
  }

  var elW = image.clientWidth;
  var elH = image.clientHeight;
  var scale = Math.min(elW / imgW, elH / imgH);
  var renderedW = imgW * scale;
  var renderedH = imgH * scale;
  var offsetX = (elW - renderedW) / 2;
  var offsetY = (elH - renderedH) / 2;

  canvas.width = elW;
  canvas.height = elH;
  canvas.style.width = elW + 'px';
  canvas.style.height = elH + 'px';
  canvas.style.pointerEvents = 'none';

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (boxes.length === 0) return;

  if (bboxCountFilters.length > 0 && bboxCountFilters.indexOf(boxes.length) < 0) return;

  var lineWidth = Math.max(canvas.width, canvas.height) * 0.015;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#00ff00';

  boxes.forEach(function(box) {
    var w = box.width * renderedW;
    var h = box.height * renderedH;
    var left = offsetX + box.x * renderedW - w / 2;
    var top = offsetY + box.y * renderedH - h / 2;

    ctx.save();
    ctx.translate(left + w / 2, top + h / 2);
    var degrees = -box.rotate * 360;
    var radians = degrees / 180 * Math.PI;
    ctx.rotate(radians);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  });
}

function drawBoxesWhenLoaded(image) {
  if (image.complete && image.naturalWidth) {
    drawBoundingBoxes(image);
  } else {
    image.addEventListener('load', function() { drawBoundingBoxes(image); }, { once: true });
  }
}

window.addEventListener('resize', function() {
  document.querySelectorAll('.image-item img[data-boxes]').forEach(function(img) {
    if (img.dataset.boxes && img.dataset.boxes !== '[]') {
      drawBoundingBoxes(img);
    }
  });
  var enlarged = document.getElementById('enlargedImage');
  if (enlarged && enlarged.dataset.boxes && enlarged.dataset.boxes !== '[]') {
    drawBoundingBoxes(enlarged);
  }
});

function updateButtonStates() {
  const img = document.getElementById('enlargedImage');
  const prevButton = document.getElementById('btn_previous');
  const nextButton = document.getElementById('btn_next');
  if (!img || !prevButton || !nextButton) return;
  const currentImageId = parseInt(img.dataset.image_id);
  if (!currentImageId || filteredImagesData.length === 0) {
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId);
  prevButton.disabled = currentIndex <= 0 || currentIndex === -1;
  nextButton.disabled = currentIndex >= filteredImagesData.length - 1 || currentIndex === -1;
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  if (modal) modal.dismiss();
}
window.closeImageModal = closeImageModal;

function showEnlargedImage(src, rotation, image_id) {
  if (isSelectionMode) return;
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('enlargedImage');
  const labelStatus = document.getElementById('labelStatus');
  img.src = src;
  img.dataset.rotation = rotation || 0;
  img.dataset.image_id = image_id;
  var imgData = filteredImagesData.find(function(item) { return item.image_id === image_id; });
  img.dataset.boxes = JSON.stringify(imgData ? (imgData.boxes || []) : []);
  if (labelStatus) { labelStatus.classList.add('loading'); labelStatus.innerHTML = 'Loading...'; }
  if (typeof initAnnotationImage === 'function') {
    initAnnotationImage(img);
    if (img.src !== src) img.src = src;
  }
  drawBoxesWhenLoaded(img);
  if (!modal.isOpen) {
    modal.present();
    modal.addEventListener('ionModalDidPresent', () => updateButtonStates());
  } else {
    updateButtonStates();
  }
  emit('/manage-dataset/load-label-status', { image_id, project_id: getProjectId() });
  modal.addEventListener('didDismiss', () => {
    img.src = '';
    img.dataset.image_id = '';
    img.dataset.boxes = '[]';
    var canvas = img.parentElement.querySelector('canvas.bounding-box-canvas');
    if (canvas) { var ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
    if (labelStatus) { labelStatus.classList.remove('loading'); labelStatus.innerHTML = ''; }
  }, { once: true });
}

function showPreviousImage() {
  const img = document.getElementById('enlargedImage');
  const currentImageId = parseInt(img.dataset.image_id);
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId);
  if (currentIndex > 0) {
    const prevImage = filteredImagesData[currentIndex - 1];
    showEnlargedImage('/uploads/' + prevImage.filename, prevImage.rotation || 0, prevImage.image_id);
  }
}
function showNextImage() {
  const img = document.getElementById('enlargedImage');
  const currentImageId = parseInt(img.dataset.image_id);
  const currentIndex = filteredImagesData.findIndex(item => item.image_id === currentImageId);
  if (currentIndex < filteredImagesData.length - 1) {
    const nextImage = filteredImagesData[currentIndex + 1];
    showEnlargedImage('/uploads/' + nextImage.filename, nextImage.rotation || 0, nextImage.image_id);
  }
}

function updateAnnotation(label_id, image_id, answer) {
  if (isUpdatingAnnotation) return;
  isUpdatingAnnotation = true;
  emit('/manage-dataset/update-annotation', { label_id, image_id, answer });
  setTimeout(() => {
    emit('/manage-dataset/load-label-status', { image_id, project_id: getProjectId() });
    isUpdatingAnnotation = false;
  }, 200);
}

// ---------- review mode ----------
function submitReview(mark_answer) {
  let label_id = +document.querySelector('#review_label_select').value;
  let view_answer = answerSegment.value;
  let selected_image_ids = [];
  document.querySelectorAll('#content-'+view_answer+' ion-checkbox').forEach(checkbox => {
    if (checkbox.checked) selected_image_ids.push(+checkbox.dataset.imageId);
  });
  emit('/manage-dataset/reclassify', {
    label_id,
    mark_answer,
    selected_image_ids,
    project_id: getProjectId(),
  });
}

function reviewLabelSelectChange(event) {
  const labelId = event.detail.value;
  const url = new URL(window.location);
  url.searchParams.set('label', labelId);
  window.history.pushState({}, '', url);
  // reload review content for the new label
  emit('/manage-dataset/reload-review', { label_id: +labelId, project_id: getProjectId() });
}

function ImageItemOnClick(event) {
  if (event.target.closest('ion-checkbox')) return;
  const item = event.currentTarget;
  const checkbox = item.querySelector('ion-checkbox');
  if (checkbox) checkbox.checked = !checkbox.checked;
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="ManageDataset" class="ion-padding">
      <Main />
    </ion-content>
    {imagePlugin.node}
    {sweetAlertPlugin.node}
    {script}
  </>
)

// ---------------------------------------------------------------------------
// shared prepared statements (project-scoped)
// ---------------------------------------------------------------------------

// count distinct images annotated for a label within a project
let count_annotated_images = db
  .prepare<{ label_id: number; project_id: number }, number>(
    /* sql */ `
select count(distinct image_id)
from image_label
inner join image on image.id = image_label.image_id
where label_id = :label_id
and image.project_id = :project_id
`,
  )
  .pluck()

// latest answer for an image+label (1=yes, 0=no, null=none)
let select_latest_answer = db.prepare<
  { image_id: number; label_id: number },
  { answer: number | null }
>(/* sql */ `
select answer
from image_label
where image_id = :image_id and label_id = :label_id
order by id desc
limit 1
`)

// image ids with a *latest* answer of 1 (yes) for a label in a project
let get_yes_image_ids = db
  .prepare<{ label_id: number; project_id: number }, number>(
    /* sql */ `
select distinct il.image_id
from image_label il
inner join image on image.id = il.image_id
where il.label_id = :label_id
  and image.project_id = :project_id
  and il.id = (
    select max(il2.id) from image_label il2
    where il2.image_id = il.image_id and il2.label_id = il.label_id
  )
  and il.answer = 1
`,
  )
  .pluck()

// image ids with a *latest* answer of 0 (no) for a label in a project
let get_no_image_ids = db
  .prepare<{ label_id: number; project_id: number }, number>(
    /* sql */ `
select distinct il.image_id
from image_label il
inner join image on image.id = il.image_id
where il.label_id = :label_id
  and image.project_id = :project_id
  and il.id = (
    select max(il2.id) from image_label il2
    where il2.image_id = il.image_id and il2.label_id = il.label_id
  )
  and il.answer = 0
`,
  )
  .pluck()

// label status (latest answer per label) for an image
let select_image_label_status = db.prepare<
  { image_id: number; project_id: number },
  { label_id: number; label_title: string; answer: number | null }
>(/* sql */ `
select l.id as label_id, l.title as label_title,
  (select il.answer from image_label il
   where il.label_id = l.id and il.image_id = :image_id
   order by il.id desc limit 1) as answer
from label l
where l.project_id = :project_id
order by l.display_order asc
`)

// get all bounding boxes for images in a project
let get_project_bounding_boxes = db.prepare<
  { project_id: number },
  {
    image_id: number
    x: number
    y: number
    width: number
    height: number
    rotate: number
  }
>(/* sql */ `
  SELECT image_bounding_box.image_id, image_bounding_box.x, image_bounding_box.y,
         image_bounding_box.width, image_bounding_box.height, image_bounding_box.rotate
  FROM image_bounding_box
  INNER JOIN image ON image.id = image_bounding_box.image_id
  WHERE image.project_id = :project_id
`)

// ---------------------------------------------------------------------------
// dataset export helpers (labels + bounding boxes with label titles)
// ---------------------------------------------------------------------------

// all labels in a project with dependency title + display order
let select_project_labels_full = db.prepare<
  { project_id: number },
  {
    id: number
    title: string
    dependency_title: string | null
    display_order: number | null
  }
>(/* sql */ `
  SELECT l.id, l.title, dep.title AS dependency_title, l.display_order
  FROM label l
  LEFT JOIN label dep ON dep.id = l.dependency_id
  WHERE l.project_id = :project_id
  ORDER BY l.display_order ASC
`)

// latest answer per image+label in a project (with label title)
let select_project_image_labels = db.prepare<
  { project_id: number },
  {
    image_id: number
    label_title: string
    answer: number
  }
>(/* sql */ `
  SELECT il.image_id, l.title AS label_title, il.answer
  FROM image_label il
  INNER JOIN image ON image.id = il.image_id
  INNER JOIN label l ON l.id = il.label_id
  WHERE image.project_id = :project_id
  AND il.id = (
    SELECT MAX(il2.id) FROM image_label il2
    WHERE il2.image_id = il.image_id AND il2.label_id = il.label_id
  )
`)

// all bounding boxes in a project (with label title)
let select_project_bounding_boxes_full = db.prepare<
  { project_id: number },
  {
    image_id: number
    label_title: string
    x: number
    y: number
    width: number
    height: number
    rotate: number
  }
>(/* sql */ `
  SELECT ibb.image_id, l.title AS label_title, ibb.x, ibb.y, ibb.width, ibb.height, ibb.rotate
  FROM image_bounding_box ibb
  INNER JOIN image ON image.id = ibb.image_id
  INNER JOIN label l ON l.id = ibb.label_id
  WHERE image.project_id = :project_id
`)

// ---------------------------------------------------------------------------
// answer <-> number mapping
// ---------------------------------------------------------------------------
const mapping: { [key: string]: number } = { yes: 1, no: 0 }
function stringToNumber(s: string): number | undefined {
  return mapping[s]
}

// ---------------------------------------------------------------------------
// project-scoped images (excluding data: uris)
// ---------------------------------------------------------------------------
function getProjectImages(project_id: number) {
  return filter(proxy.image, { project_id }).filter(
    item => item.filename && !item.filename.startsWith('data:image'),
  )
}

function getProjectBoundingBoxes(project_id: number) {
  let map = new Map<
    number,
    { x: number; y: number; width: number; height: number; rotate: number }[]
  >()
  for (const box of get_project_bounding_boxes.all({ project_id })) {
    if (!map.has(box.image_id)) map.set(box.image_id, [])
    map.get(box.image_id)!.push({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotate: box.rotate,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// review helpers: classify images into yes / no / unknown / clash
// ---------------------------------------------------------------------------
function getReviewImages(args: { label_id: number; project_id: number }) {
  let { label_id, project_id } = args
  let yes_ids = get_yes_image_ids.all({ label_id, project_id })
  let no_ids = get_no_image_ids.all({ label_id, project_id })

  let images = getProjectImages(project_id)
  let ids = images.map(img => img.id!)

  let unknown = ids.filter(id => !yes_ids.includes(id) && !no_ids.includes(id))
  let clash = ids.filter(id => yes_ids.includes(id) && no_ids.includes(id))
  let total_images = ids.length
  let annotated_images = ids.length - unknown.length

  function renderImage(image: (typeof images)[number]) {
    return (
      <ion-col size="4">
        <ion-item
          class="image-item-container"
          data-clash={clash.includes(image.id!) ? 'true' : 'false'}
          onclick="ImageItemOnClick(event)"
        >
          <ion-checkbox data-image-id={image.id!}></ion-checkbox>
          <div class="review-images">
            <img src={'/uploads/' + image.filename} />
            <div class="image-item--filename" style="text-align: center;">
              {image.original_filename}
            </div>
          </div>
        </ion-item>
      </ion-col>
    )
  }

  let yes_images = mapArray(
    images.filter(image => yes_ids.includes(image.id!)),
    renderImage,
  )
  let no_images = mapArray(
    images.filter(image => no_ids.includes(image.id!)),
    renderImage,
  )
  let unknown_images = mapArray(
    images.filter(image => unknown.includes(image.id!)),
    renderImage,
  )

  return {
    yes_images,
    no_images,
    unknown_images,
    annotated_images,
    total_images,
  }
}

// ---------------------------------------------------------------------------
// reclassify (atomic transaction) - from review-annotation branch
// ---------------------------------------------------------------------------
function reclassify(
  label_id: number,
  mark_answer: number,
  selected_image_ids: number[],
  user_id: number,
) {
  if (selected_image_ids.length === 0) return
  const placeholders = selected_image_ids.map(() => '?').join(', ')
  const trx = db.transaction(() => {
    // delete existing answer records for these images on this label
    db.prepare(
      /* sql */ `
      DELETE FROM image_label
      WHERE label_id = ?
      AND image_id IN (${placeholders})
      `,
    ).run(label_id, ...selected_image_ids)
    // insert new answer records
    const insertStmt = db.prepare(/* sql */ `
      INSERT INTO image_label (label_id, image_id, answer, user_id)
      VALUES (@label_id, @image_id, @answer, @user_id)
      `)
    for (const image_id of selected_image_ids) {
      insertStmt.run({ label_id, image_id, answer: mark_answer, user_id })
    }
  })
  trx()
}

// ---------------------------------------------------------------------------
// browse: filter images by label states
// ---------------------------------------------------------------------------
type LabelState = 'empty' | 'correct' | 'incorrect' | 'unlabeled'

function filterImagesByLabelStates(
  images: {
    image_id: number
    filename: string
    rotation: number
    boxes: {
      x: number
      y: number
      width: number
      height: number
      rotate: number
    }[]
  }[],
  labelStates: Record<number, LabelState>,
) {
  const filterLabels = Object.entries(labelStates)
    .filter(([_, state]) => state !== 'empty')
    .map(([labelId, state]) => ({ labelId: Number(labelId), state }))
  if (filterLabels.length === 0) return images
  return images.filter(img => {
    return filterLabels.every(({ labelId, state }) => {
      const row = select_latest_answer.get({
        image_id: img.image_id,
        label_id: labelId,
      })
      if (state === 'correct') return row && row.answer === 1
      if (state === 'incorrect') return row && row.answer === 0
      if (state === 'unlabeled') return !row
      return true
    })
  })
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
function Main(attrs: {}, context: DynamicContext) {
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
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!

  let labels = select_project_label.all({ project_id })
  let boxesMap = getProjectBoundingBoxes(project_id)
  let images = getProjectImages(project_id).map(item => ({
    image_id: item.id!,
    filename: item.filename,
    rotation: item.rotation || 0,
    boxes: boxesMap.get(item.id!) || [],
  }))
  // start with no label filter
  let labelStates: Record<number, LabelState> = {}
  let filteredImages = filterImagesByLabelStates(images, labelStates)
  let totalImages = getProjectImages(project_id).length

  let labelStatesArray = Object.entries(labelStates).map(([id, state]) => ({
    id: Number(id),
    state,
  }))

  // distinct box counts present in this project's images (exclude 0, All covers it)
  let bboxCounts = [...new Set(images.map(img => img.boxes.length))]
    .filter(n => n > 0)
    .sort((a, b) => a - b)

  // review mode default label
  let params = new URLSearchParams(context.routerMatch?.search ?? '')
  let review_label_id = +params.get('label')! || labels[0]?.id || 0
  let review_answer = params.get('answer')! || 'yes'

  let review = review_label_id
    ? getReviewImages({ label_id: review_label_id, project_id })
    : {
        yes_images: [],
        no_images: [],
        unknown_images: [],
        annotated_images: 0,
        total_images: 0,
      }

  return (
    <>
      {/* ---------- confirm modals ---------- */}
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
            <ion-button fill="outline" onclick="closeConfirmModal('delete')">
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
            <ion-button fill="outline" onclick="closeConfirmModal('unlabel')">
              <Locale en="Cancel" zh_hk="取消" zh_cn="取消" />
            </ion-button>
          </div>
        </div>
      </div>
      <div
        id="exportConfirmModal"
        style="display:none; position:fixed; left:0; top:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); z-index:9999; justify-content:center; align-items:center;"
      >
        <div
          class="modal-content"
          style="background:#fff; border-radius:8px; padding:2rem; min-width:300px; max-width:500px; box-shadow:0 2px 16px #0002; text-align:center;"
        >
          <div style="margin-bottom:1rem;">
            <Locale
              en="Select labels to export"
              zh_hk="選擇要匯出的標籤"
              zh_cn="选择要导出的标签"
            />
          </div>
          <div
            class="label-selection-container"
            style="max-height:200px; overflow-y:auto; margin-bottom:1rem;"
          >
            {mapArray(labels, label => (
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.9rem; margin:0.5rem 0;">
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
          <div
            class="checkbox-container"
            style="display:flex; justify-content:center; align-items:center; gap:0.5rem; margin-top:1rem;"
          >
            <input type="checkbox" id="organizeByLabelCheckbox" disabled />
            <label for="organizeByLabelCheckbox" style="font-size:0.9rem;">
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
                style="width:150px; height:40px;"
                color="primary"
                onclick="selectAllLabels()"
              >
                <Locale en="Select All" zh_hk="全選" zh_cn="全选" />
              </ion-button>
              <ion-button
                style="width:150px; height:40px;"
                color="primary"
                onclick="exportImages()"
              >
                <Locale en="Export" zh_hk="匯出" zh_cn="导出" />
              </ion-button>
            </div>
            <div style="display:flex; justify-content:center;">
              <ion-button
                style="width:150px; height:40px;"
                fill="outline"
                onclick="closeExportConfirmModal()"
              >
                <Locale en="Cancel" zh_hk="取消" zh_cn="取消" />
              </ion-button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- BROWSE MODE ---------- */}
      <div id="mode-browse" class="mode-section" style="position: relative;">
        <div class="browse-toolbar">
          <ion-button
            id="toggle-selection-button"
            onclick="toggleSelectionMode()"
          >
            <span>
              <Locale en="Select" zh_hk="選擇" zh_cn="选择" />
            </span>
          </ion-button>
          <ion-button
            id="select-all-button"
            style="display: none;"
            onclick="toggleSelectAllImages()"
          >
            <span>
              <Locale en="Select All" zh_hk="全選" zh_cn="全选" />
            </span>
          </ion-button>
          <ion-button class="icon-only-mobile" onclick="exportDataset()">
            <ion-icon name="download" slot="start"></ion-icon>
            <span>
              <Locale
                en="Export Dataset"
                zh_hk="匯出數據集"
                zh_cn="导出数据集"
              />
            </span>
          </ion-button>
          <ion-button
            class="icon-only-mobile"
            onclick="document.getElementById('import-dataset-input').click()"
          >
            <ion-icon name="cloud-upload" slot="start"></ion-icon>
            <span>
              <Locale
                en="Import Dataset"
                zh_hk="匯入數據集"
                zh_cn="导入数据集"
              />
            </span>
          </ion-button>
          <input
            type="file"
            id="import-dataset-input"
            accept=".zip,application/zip,application/x-zip-compressed"
            style="display: none;"
            onchange="importDataset(event)"
          />
          <div style="flex: 1;"></div>
          <ion-button
            id="toggle-bbox-button"
            onclick="window.toggleBoundingBoxes()"
          >
            <span>
              <Locale en="Show BBox" zh_hk="顯示框" zh_cn="显示框" />
            </span>
          </ion-button>
          <div style="position: relative;">
            <ion-button
              id="bbox-count-button"
              style="display: none;"
              onclick="window.toggleBboxCountDropdown()"
            >
              <span>
                <Locale en="Box Count" zh_hk="框數量" zh_cn="框数量" />
              </span>
              <ion-icon
                name="chevron-down"
                style="margin-left: 0.25rem; font-size: 0.8rem;"
              ></ion-icon>
            </ion-button>
            <div
              id="bbox-count-dropdown"
              style="position: absolute; top: 100%; right: 0; margin-top: 0.25rem; display: none; flex-direction: column; gap: 0.25rem; z-index: 10;"
            >
              {mapArray(bboxCounts, n => (
                <div class="label-container">
                  <div class="class-label">{n}</div>
                  <ion-button
                    id={`bbox-count-state-${n}`}
                    class="label-state-button"
                    fill="clear"
                    onclick={`window.setBboxCountFilter(${n})`}
                  >
                    <ion-icon
                      name="ellipse-outline"
                      style="--ionicon-stroke-width: 32px; color: #999;"
                    ></ion-icon>
                  </ion-button>
                </div>
              ))}
            </div>
          </div>
          <div style="position: relative;">
            <ion-button id="toggle-labels-button" onclick="toggleLabels()">
              <span>
                <Locale en="Hide" zh_hk="隱藏" zh_cn="隐藏" />
              </span>
            </ion-button>
            <div
              id="label-toggle-container"
              style="position: absolute; top: 100%; right: 0; margin-top: 0.25rem; display: flex; flex-direction: column; gap: 0.25rem; z-index: 10;"
            >
              {mapArray(labels, label => {
                let annotated_count = count_annotated_images.get({
                  label_id: label.id!,
                  project_id,
                })
                return (
                  <div class="label-container">
                    <div class="class-label">{label.title}</div>
                    <ion-button
                      id={`label-state-button-${label.id}`}
                      class="label-state-button empty"
                      fill="clear"
                      onclick={`toggleLabelState(${label.id})`}
                    >
                      <ion-icon
                        name="ellipse-outline"
                        style="--ionicon-stroke-width: 32px; color: #999;"
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
          </div>
        </div>
        <div class="section all-images-section">
          <div class="image-grid">
            {mapArray(filteredImages, item => (
              <div class="image-item" key={`image-${item.image_id}`}>
                <input
                  type="checkbox"
                  class="image-checkbox"
                  style="display: none;"
                  data-image-id={item.image_id}
                />
                <div class="image-wrapper">
                  <img
                    src={`/uploads/${item.filename}`}
                    alt="Image"
                    data-rotation={item.rotation}
                    data-boxes={JSON.stringify(item.boxes)}
                    onload="initAnnotationImage(this)"
                    onclick={`handleImageClick('${item.filename}', ${item.rotation}, ${item.image_id})`}
                  />
                  <canvas class="bounding-box-canvas"></canvas>
                </div>
              </div>
            ))}
          </div>
          <div class="no-images-message" hidden={filteredImages.length > 0}>
            <p>
              <Locale
                en="No images in dataset."
                zh_hk="數據集中沒有圖片。"
                zh_cn="数据集中没有图像。"
              />
            </p>
          </div>
        </div>
        <ion-toolbar
          id="selection-toolbar"
          style="position: fixed; bottom: 0; width: 100%; display: none; z-index: 10;"
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

      {/* ---------- image modal ---------- */}
      <ion-modal id="imageModal" backdropDismiss={true}>
        <ion-content>
          <div class="modal-content">
            <ion-button
              class="modal-back-button"
              fill="clear"
              onclick="closeImageModal()"
            >
              <ion-icon name="arrow-back" slot="start"></ion-icon>
              <Locale en="Back" zh_hk="返回" zh_cn="返回" />
            </ion-button>
            <div class="sidebar">
              <h3>
                <Locale en="Label Status" zh_hk="標籤狀態" zh_cn="标签状态" />
              </h3>
              <div id="labelStatus" class="loading">
                Loading...
              </div>
            </div>
            <div class="image-container">
              <div class="enlarged-image-wrapper">
                <img id="enlargedImage" src="" alt="Enlarged image" />
                <canvas
                  id="enlargedBoundingBoxCanvas"
                  class="bounding-box-canvas"
                ></canvas>
              </div>
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
          setImagesData(${JSON.stringify(filteredImages)});
          setFilteredImagesData(${JSON.stringify(filteredImages)});
          initLabelStates(${JSON.stringify(labels)});
          labelStates = ${JSON.stringify(labelStatesArray)};
          isLabelVisible = true;
          isSelectionMode = false;
          selectedImages = [];
          updateSelectAllButton();
          switchMode('browse');
        }, 0)
      `)}
    </>
  )
}

// ---------------------------------------------------------------------------
// WS handlers
// ---------------------------------------------------------------------------

let toggleLabelParser = object({
  isLabelVisible: boolean(),
  project_id: id(),
})

function ToggleLabels(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = toggleLabelParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!
    let labels = select_project_label.all({ project_id })
    let totalImages = getProjectImages(project_id).length

    context.ws.send([
      'batch',
      [
        [
          'update-in',
          '#label-toggle-container',
          nodeToVNode(
            <div
              id="label-toggle-container"
              style={`position: absolute; top: 100%; right: 0; margin-top: 0.25rem; display: ${input.isLabelVisible ? 'flex' : 'none'}; flex-direction: column; gap: 0.25rem; z-index: 10;`}
            >
              {mapArray(labels, label => {
                let annotated_count = count_annotated_images.get({
                  label_id: label.id!,
                  project_id,
                })
                return (
                  <div class="label-container">
                    <div class="class-label">{label.title}</div>
                    <ion-button
                      id={`label-state-button-${label.id}`}
                      class="label-state-button empty"
                      fill="clear"
                      onclick={`toggleLabelState(${label.id})`}
                    >
                      <ion-icon
                        name="ellipse-outline"
                        style="--ionicon-stroke-width: 32px; color: #999;"
                      ></ion-icon>
                    </ion-button>
                    <progress
                      value={annotated_count}
                      max={totalImages || 1}
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
                en={input.isLabelVisible ? 'Hide Labels' : 'Show Labels'}
                zh_hk={input.isLabelVisible ? '隱藏標籤' : '顯示標籤'}
                zh_cn={input.isLabelVisible ? '隐藏标签' : '显示标签'}
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
          if (container) container.style.display = ${JSON.stringify(input.isLabelVisible ? 'flex' : 'none')};
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
  project_id: id(),
})

function ToggleLabelState(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = toggleLabelStateParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!

    const validStates: LabelState[] = [
      'empty',
      'correct',
      'incorrect',
      'unlabeled',
    ]
    if (!validStates.includes(input.state as LabelState)) {
      throw `Invalid state: ${input.state}`
    }
    const state = input.state as LabelState

    const frontendLabelStates: Record<number, LabelState> = {}
    input.labelStates.forEach(item => {
      if (validStates.includes(item.state as LabelState)) {
        frontendLabelStates[item.id] = item.state as LabelState
      }
    })

    let updatedLabelStates: Record<number, LabelState> = {}
    select_project_label.all({ project_id }).forEach(label => {
      updatedLabelStates[label.id!] = 'empty'
    })
    Object.assign(updatedLabelStates, frontendLabelStates)
    updatedLabelStates[input.label_id] = state

    let boxesMap = getProjectBoundingBoxes(project_id)
    let images = getProjectImages(project_id).map(item => ({
      image_id: item.id!,
      filename: item.filename,
      rotation: item.rotation || 0,
      boxes: boxesMap.get(item.id!) || [],
    }))
    const filteredImages = filterImagesByLabelStates(images, updatedLabelStates)

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
                  <div class="image-wrapper">
                    <img
                      src={`/uploads/${item.filename}`}
                      alt="Image"
                      data-rotation={item.rotation}
                      data-boxes={JSON.stringify(item.boxes)}
                      onload="initAnnotationImage(this)"
                      onclick={`handleImageClick('${item.filename}', ${item.rotation}, ${item.image_id})`}
                    />
                    <canvas class="bounding-box-canvas"></canvas>
                  </div>
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
          applyBboxCountFilter();
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
          if (selectAllButton) selectAllButton.style.display = ${JSON.stringify(input.isSelectionMode ? 'flex' : 'none')};
          const selectionToolbar = document.getElementById('selection-toolbar');
          if (selectionToolbar) selectionToolbar.style.display = 'none';
          document.querySelectorAll('.image-checkbox').forEach(checkbox => {
            checkbox.style.display = ${JSON.stringify(input.isSelectionMode ? 'block' : 'none')};
            checkbox.checked = false;
            const imageItem = checkbox.closest('.image-item');
            if (imageItem) imageItem.classList.remove('selected');
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
      '#select-all-labels-button',
      nodeToVNode(
        <ion-button
          id="select-all-labels-button"
          style="width:150px; height:40px;"
          color="primary"
          onclick="selectAllLabels()"
        >
          <Locale
            en={input.anyLabelChecked ? 'Deselect' : 'Select All'}
            zh_hk={input.anyLabelChecked ? '取消選擇' : '全選'}
            zh_cn={input.anyLabelChecked ? '取消选择' : '全选'}
          />
        </ion-button>,
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

// ---------------------------------------------------------------------------
// load label status (image modal sidebar)
// ---------------------------------------------------------------------------
let loadLabelStatusParser = object({
  image_id: id(),
  project_id: id(),
})

function LoadLabelStatus(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = loadLabelStatusParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!
    let labels = select_image_label_status.all({
      image_id: input.image_id,
      project_id,
    })

    if (!labels || labels.length === 0) {
      context.ws.send([
        'update-in',
        '#labelStatus',
        nodeToVNode(
          <div class="no-labels-message">
            <p>
              <Locale
                en="No labels found for this image."
                zh_hk="此圖片沒有找到任何標籤。"
                zh_cn="此图片没有找到任何标签。"
              />
            </p>
          </div>,
          context,
        ),
      ])
    } else {
      context.ws.send([
        'update-in',
        '#labelStatus',
        nodeToVNode(
          <div>
            {mapArray(labels, status => (
              <div class="label-item">
                <div class="label-title">{status.label_title}</div>
                <div class="control-buttons">
                  <ion-button
                    size="small"
                    color="success"
                    class={status.answer === 0 ? 'half-transparent' : ''}
                    onclick={`updateAnnotation(${status.label_id}, ${input.image_id}, true)`}
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
                    onclick={`updateAnnotation(${status.label_id}, ${input.image_id}, false)`}
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
          context,
        ),
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

// ---------------------------------------------------------------------------
// update annotation (single image, from modal)
// ---------------------------------------------------------------------------
let updateAnnotationParser = object({
  label_id: id(),
  image_id: id(),
  answer: boolean(),
})

function UpdateAnnotation(attrs: {}, context: WsContext) {
  try {
    let throws = makeThrows(context)
    let user_id = getAuthUserId(context)!
    if (!user_id)
      throws({
        en: 'Login required',
        zh_hk: '需要登入',
        zh_cn: '需要登录',
      })

    let body = getContextFormBody(context)
    let input = updateAnnotationParser.parse(body)

    // verify image belongs to a project the user can access
    let image = proxy.image[input.image_id]
    if (!image) throw 'Image not found'
    let project = image.project_id
      ? proxy.project[image.project_id] || null
      : null
    if (!project) throw 'Project not found'

    // delete existing answer records for this image+label, then insert new one
    db.prepare(
      /* sql */ `
      DELETE FROM image_label
      WHERE image_id = :image_id AND label_id = :label_id
    `,
    ).run({ image_id: input.image_id, label_id: input.label_id })

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

    // refresh progress bars in label panel
    if (project) {
      for (const label of select_project_label.all({
        project_id: project.id!,
      })) {
        const annotated_count = count_annotated_images.get({
          label_id: label.id!,
          project_id: project.id!,
        })
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

// ---------------------------------------------------------------------------
// batch unlabel
// ---------------------------------------------------------------------------
let batchUnlabelParser = object({
  image_ids: array(id()),
  project_id: id(),
})

function BatchUnlabel(attrs: {}, context: WsContext) {
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = batchUnlabelParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    input.image_ids.forEach(image_id => {
      del(proxy.image_label, { image_id })
    })

    context.ws.send([
      'eval',
      `
      const unlabelIds = ${JSON.stringify(input.image_ids)};
      imagesData = imagesData.filter(img => !unlabelIds.includes(img.image_id));
      filteredImagesData = filteredImagesData.filter(img => !unlabelIds.includes(img.image_id));
      selectedImages = [];
      isSelectionMode = false;
      if (typeof updateSelectAllButton === 'function') updateSelectAllButton();
      const selectionToolbar = document.getElementById('selection-toolbar');
      if (selectionToolbar) selectionToolbar.style.display = 'none';
      `,
    ])

    // refresh label progress bars
    for (const label of select_project_label.all({
      project_id: input.project_id,
    })) {
      const annotated_count = count_annotated_images.get({
        label_id: label.id!,
        project_id: input.project_id,
      })
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

// ---------------------------------------------------------------------------
// batch delete (project-scoped)
// ---------------------------------------------------------------------------
let batchDeleteParser = object({
  image_ids: array(id()),
  project_id: id(),
})

function BatchDelete(attrs: {}, context: WsContext) {
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = batchDeleteParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    let errors: string[] = []

    db.transaction(() => {
      input.image_ids.forEach(image_id => {
        const image = proxy.image[image_id]
        if (!image || image.project_id !== input.project_id) {
          errors.push(`Image ID ${image_id}: not found in project`)
          return
        }
        // capture filename before deleting the DB row, because the row
        // proxy returns undefined for properties after the row is deleted
        const filename = image.filename
        del(proxy.image_bounding_box_confirmation, { image_id })
        del(proxy.image_bounding_box, { image_id })
        del(proxy.image_label, { image_id })
        del(proxy.image, { id: image_id })
        try {
          const filePath = join(env.UPLOAD_DIR, filename)
          fsPromises.rm(filePath, { force: true })
        } catch (err) {
          errors.push(`Image ID ${image_id}: file delete failed: ${err}`)
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
        imageGrid.querySelectorAll('.image-item').forEach(item => {
          const cb = item.querySelector('.image-checkbox');
          if (cb && deletedIds.includes(parseInt(cb.dataset.imageId))) item.remove();
        });
      }
      const selectionToolbar = document.getElementById('selection-toolbar');
      if (selectionToolbar) selectionToolbar.style.display = 'none';
      const noImagesMsg = document.querySelector('.no-images-message');
      if (noImagesMsg) noImagesMsg.hidden = imagesData.length > 0;
      if (typeof updateSelectAllButton === 'function') updateSelectAllButton();
      `,
    ])

    // refresh label progress bars
    for (const label of select_project_label.all({
      project_id: input.project_id,
    })) {
      const annotated_count = count_annotated_images.get({
        label_id: label.id!,
        project_id: input.project_id,
      })
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

    if (errors.length > 0) {
      context.ws.send([
        'eval',
        `
        const toast = document.createElement('ion-toast');
        toast.message = ${JSON.stringify('Errors: ' + errors.join('; '))};
        toast.duration = 7000;
        toast.color = 'warning';
        document.body.appendChild(toast);
        toast.present();
        `,
      ])
    }
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('BatchDelete Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// batch export (project-scoped)
// ---------------------------------------------------------------------------
let batchExportParser = object({
  image_ids: array(id()),
  label_ids: array(id()),
  organizeByLabel: boolean(),
  project_id: id(),
})

function BatchExport(attrs: {}, context: WsContext) {
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = batchExportParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    const images = db
      .prepare<
        { image_ids: string },
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
        WHERE project_id = ${input.project_id}
        AND id IN (${input.image_ids.join(',')})
      `,
      )
      .all({ image_ids: input.image_ids.join(',') })
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
              { image_ids: string; label_ids: string },
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
            .all({
              image_ids: input.image_ids.join(','),
              label_ids: input.label_ids.join(','),
            })
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

    const zip = new AdmZip()
    if (input.organizeByLabel) {
      exportData.forEach(data => {
        const imageInfo = imageMap.get(data.image_id)
        if (!imageInfo) return
        const filePath = join(env.UPLOAD_DIR, imageInfo.filename)
        data.labels.forEach(label => {
          const folder = `${label.label_title}/${label.answer === 1 ? 'correct' : 'incorrect'}`
          zip.addLocalFile(filePath, folder, data.filename)
        })
        if (data.labels.length === 0 && input.label_ids.length === 0) {
          zip.addLocalFile(filePath, '', data.filename)
        }
      })
    } else {
      exportData.forEach(data => {
        const imageInfo = imageMap.get(data.image_id)
        if (!imageInfo) return
        const filePath = join(env.UPLOAD_DIR, imageInfo.filename)
        if (data.labels.length > 0 || input.label_ids.length === 0) {
          zip.addLocalFile(filePath, '', data.filename)
        }
      })
    }
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
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('BatchExport Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// dataset export (whole project: images + labels + bounding boxes)
// ---------------------------------------------------------------------------
let exportDatasetParser = object({
  project_id: id(),
})

function ExportDataset(attrs: {}, context: WsContext) {
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = exportDatasetParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let images = getProjectImages(project_id)
    let labels = select_project_labels_full.all({ project_id })
    let imageLabels = select_project_image_labels.all({ project_id })
    let boxes = select_project_bounding_boxes_full.all({ project_id })

    // group image_labels by image_id
    let labelsByImage = new Map<
      number,
      { label_title: string; answer: number }[]
    >()
    for (let il of imageLabels) {
      if (!labelsByImage.has(il.image_id)) labelsByImage.set(il.image_id, [])
      labelsByImage.get(il.image_id)!.push({
        label_title: il.label_title,
        answer: il.answer,
      })
    }

    // group bounding boxes by image_id
    let boxesByImage = new Map<
      number,
      {
        label_title: string
        x: number
        y: number
        width: number
        height: number
        rotate: number
      }[]
    >()
    for (let b of boxes) {
      if (!boxesByImage.has(b.image_id)) boxesByImage.set(b.image_id, [])
      boxesByImage.get(b.image_id)!.push({
        label_title: b.label_title,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        rotate: b.rotate,
      })
    }

    let metadata = {
      project_title: project.title,
      labels: labels.map(l => ({
        title: l.title,
        dependency_title: l.dependency_title,
        display_order: l.display_order,
      })),
      images: images.map(img => ({
        filename: img.filename,
        original_filename: img.original_filename,
        rotation: img.rotation || 0,
        content_hash: img.content_hash,
        labels: labelsByImage.get(img.id!) || [],
        bounding_boxes: boxesByImage.get(img.id!) || [],
      })),
    }

    const zip = new AdmZip()
    zip.addFile(
      'metadata.json',
      Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
    )
    for (let img of images) {
      if (!img.filename) continue
      let filePath = join(env.UPLOAD_DIR, img.filename)
      try {
        zip.addLocalFile(filePath, 'images', img.filename)
      } catch (e) {
        console.error('ExportDataset: missing image file', img.filename, e)
      }
    }

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
      a.download = 'dataset_${project_id}_${new Date().toISOString()}.zip';
      a.click();
      URL.revokeObjectURL(url);
      const toast = document.createElement('ion-toast');
      toast.message = 'Exported ${images.length} images.';
      toast.duration = 5000;
      document.body.appendChild(toast);
      toast.present();
      `,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('ExportDataset Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// dataset import (whole project: images + labels + bounding boxes)
// ---------------------------------------------------------------------------
let insert_bounding_box = db.prepare<
  {
    image_id: number
    user_id: number
    label_id: number
    x: number
    y: number
    width: number
    height: number
    rotate: number
  },
  { id: number }
>(/* sql */ `
  INSERT INTO image_bounding_box (image_id, user_id, label_id, x, y, width, height, rotate)
  VALUES (:image_id, :user_id, :label_id, :x, :y, :width, :height, :rotate)
  RETURNING id
`)

async function ImportDataset(context: ExpressContext) {
  let user_id = getAuthUserId(context)
  if (!user_id) throw 'Login required'

  let project_id_str = context.req.query.project
  if (typeof project_id_str !== 'string') throw 'project is required'
  let project_id = +project_id_str
  if (!project_id) throw 'invalid project id'

  let project = proxy.project[project_id]
  if (!project) throw 'Project not found'

  let form = createUploadForm({
    mimeTypeRegex: /^application\/zip$|^application\/x-zip-compressed$/,
    maxFileSize: 1024 * 1024 * 1024,
    maxFiles: 1,
  })

  let [_fields, files] = await form.parse(context.req)
  let uploaded = files.file
  if (!uploaded) throw 'No file uploaded'
  let file = Array.isArray(uploaded) ? uploaded[0] : uploaded
  if (!file) throw 'No file uploaded'

  let zip = new AdmZip(file.filepath)
  let metadataEntry = zip.getEntry('metadata.json')
  if (!metadataEntry) throw 'Invalid dataset zip: missing metadata.json'

  let metadata = JSON.parse(metadataEntry.getData().toString('utf-8')) as {
    project_title?: string
    labels?: Array<{
      title: string
      dependency_title: string | null
      display_order: number | null
    }>
    images?: Array<{
      filename: string
      original_filename: string | null
      rotation: number | null
      content_hash: string | null
      labels?: Array<{ label_title: string; answer: number }>
      bounding_boxes?: Array<{
        label_title: string
        x: number
        y: number
        width: number
        height: number
        rotate: number
      }>
    }>
  }
  if (!metadata.labels || !Array.isArray(metadata.labels)) {
    throw 'Invalid metadata.json: labels array missing'
  }
  if (!metadata.images || !Array.isArray(metadata.images)) {
    throw 'Invalid metadata.json: images array missing'
  }

  // ---- 1. create / match labels by title ----
  let projectLabels = filter(proxy.label, { project_id })
  let titleToLabel = new Map(
    projectLabels.map(label => [label.title, label] as const),
  )
  let created_labels = 0
  let labelTitleToId = new Map<string, number>()

  // first pass: create all labels (without dependency) so titles exist
  for (let metaLabel of metadata.labels) {
    let existing = titleToLabel.get(metaLabel.title)
    if (existing && existing.id != null) {
      labelTitleToId.set(metaLabel.title, existing.id)
      continue
    }
    let newId = proxy.label.push({
      title: metaLabel.title,
      dependency_id: null,
      project_id,
      display_order: metaLabel.display_order ?? null,
    })
    labelTitleToId.set(metaLabel.title, newId)
    created_labels++
  }

  // second pass: resolve dependency titles -> ids
  for (let metaLabel of metadata.labels) {
    if (!metaLabel.dependency_title) continue
    let id = labelTitleToId.get(metaLabel.title)
    let depId = labelTitleToId.get(metaLabel.dependency_title)
    if (id == null || depId == null) continue
    db.prepare(
      /* sql */ `
      UPDATE label SET dependency_id = ? WHERE id = ?
    `,
    ).run(depId, id)
  }

  // ---- 2. import images (dedup by content_hash) ----
  let imported_images = 0
  let skipped_images = 0
  let imageIdByFilename = new Map<string, number>()

  for (let metaImage of metadata.images) {
    if (!metaImage.filename) continue

    // dedup by content_hash within this project
    if (metaImage.content_hash) {
      let existing = filter(proxy.image, {
        project_id,
        content_hash: metaImage.content_hash,
      })
      if (existing.length > 0) {
        skipped_images++
        if (existing[0].id != null) {
          imageIdByFilename.set(metaImage.filename, existing[0].id)
        }
        continue
      }
    }

    // extract image from zip into upload dir
    let entry = zip.getEntry('images/' + metaImage.filename)
    if (!entry) {
      skipped_images++
      continue
    }
    // Guard against path traversal: only allow a plain filename, never a path
    // that could escape the upload dir (e.g. `../../etc/evil`).
    let safeFilename = basename(metaImage.filename)
    if (safeFilename !== metaImage.filename) {
      skipped_images++
      continue
    }
    let destPath = join(env.UPLOAD_DIR, safeFilename)
    let data = entry.getData()
    await fsPromises.writeFile(destPath, data)

    let newId = proxy.image.push({
      original_filename: metaImage.original_filename ?? null,
      filename: safeFilename,
      user_id,
      rotation: metaImage.rotation ?? null,
      project_id,
      content_hash: metaImage.content_hash ?? null,
    })
    imageIdByFilename.set(safeFilename, newId)
    imported_images++
  }

  // ---- 3. restore image_label (latest answer) ----
  let imported_labels = 0
  for (let metaImage of metadata.images) {
    let imageId = imageIdByFilename.get(metaImage.filename)
    if (imageId == null) continue
    for (let il of metaImage.labels || []) {
      let labelId = labelTitleToId.get(il.label_title)
      if (labelId == null) continue
      seedRow(
        proxy.image_label,
        { image_id: imageId, label_id: labelId, user_id },
        { answer: il.answer },
      )
      imported_labels++
    }
  }

  // ---- 4. restore bounding boxes ----
  let imported_boxes = 0
  for (let metaImage of metadata.images) {
    let imageId = imageIdByFilename.get(metaImage.filename)
    if (imageId == null) continue
    for (let b of metaImage.bounding_boxes || []) {
      let labelId = labelTitleToId.get(b.label_title)
      if (labelId == null) continue
      insert_bounding_box.run({
        image_id: imageId,
        user_id,
        label_id: labelId,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        rotate: b.rotate,
      })
      imported_boxes++
    }
  }

  // cleanup uploaded temp file
  try {
    rmSync(file.filepath, { force: true })
  } catch {}

  return {
    success: true,
    imported_images,
    skipped_images,
    created_labels,
    imported_labels,
    imported_boxes,
  }
}

// ---------------------------------------------------------------------------
// review: reclassify (from review-annotation branch)
// ---------------------------------------------------------------------------
let reclassifyParser = object({
  label_id: id(),
  mark_answer: values(['yes' as const, 'no' as const]),
  selected_image_ids: array(id()),
  project_id: id(),
})

function Reclassify(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in'

    let body = getContextFormBody(context)
    let input = reclassifyParser.parse(body)
    let { label_id, mark_answer, selected_image_ids, project_id } = input

    let project = proxy.project[project_id]
    if (!project) throw 'Project not found'
    let label = proxy.label[label_id]
    if (!label || label.project_id !== project_id) throw 'Label not found'

    if (selected_image_ids.length > 0 && user.id) {
      reclassify(
        label_id,
        stringToNumber(mark_answer)!,
        selected_image_ids,
        user.id,
      )
    }

    let {
      yes_images,
      no_images,
      unknown_images,
      annotated_images,
      total_images,
    } = getReviewImages({ label_id, project_id })
    let label_title = label.title
    let label_text = `${label_title} (${annotated_images}/${total_images})`

    context.ws.send([
      'batch',
      [
        [
          'update-text',
          `#review_label_select ion-select-option[value="${label_id}"]`,
          label_text,
        ],
        [
          'eval',
          `var sel = document.querySelector('#review_label_select'); if (sel) sel.forceUpdate?.();`,
        ],
        ['update-in', '#content-yes ion-row', nodeToVNode(yes_images, context)],
        ['update-in', '#content-no ion-row', nodeToVNode(no_images, context)],
        [
          'update-in',
          '#content-unknown ion-row',
          nodeToVNode(unknown_images, context),
        ],
      ],
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('Reclassify error', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// review: reload review content when label changes
// ---------------------------------------------------------------------------
let reloadReviewParser = object({
  label_id: id(),
  project_id: id(),
})

function ReloadReview(attrs: {}, context: WsContext) {
  try {
    let body = getContextFormBody(context)
    let input = reloadReviewParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let label = proxy.label[input.label_id]
    if (!label || label.project_id !== input.project_id) throw 'Label not found'

    let { yes_images, no_images, unknown_images } = getReviewImages({
      label_id: input.label_id,
      project_id: input.project_id,
    })

    context.ws.send([
      'batch',
      [
        ['update-in', '#content-yes ion-row', nodeToVNode(yes_images, context)],
        ['update-in', '#content-no ion-row', nodeToVNode(no_images, context)],
        [
          'update-in',
          '#content-unknown ion-row',
          nodeToVNode(unknown_images, context),
        ],
      ],
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('ReloadReview error', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
let routes = {
  '/manage-dataset': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'Manage images and review annotations in the dataset',
    node: page,
    layout_type: LayoutType.ionic,
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
  '/manage-dataset/export-dataset': {
    title: apiEndpointTitle,
    description:
      'Export whole dataset (images + labels + bounding boxes) as ZIP',
    node: <ExportDataset />,
  },
  '/manage-dataset/import-dataset': ajaxRoute({
    description:
      'Import whole dataset (images + labels + bounding boxes) from ZIP',
    api: ImportDataset,
  }),
  '/manage-dataset/reclassify': {
    title: apiEndpointTitle,
    description: 'Reclassify selected images answer for a label',
    node: <Reclassify />,
  },
  '/manage-dataset/reload-review': {
    title: apiEndpointTitle,
    description: 'Reload review content for a label',
    node: <ReloadReview />,
  },
} satisfies Routes

export default { routes }
