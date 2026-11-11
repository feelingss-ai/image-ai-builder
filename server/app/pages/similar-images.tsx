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
import { IonBackButton } from '../components/ion-back-button.js'
import { array, id, object, optional, values } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter, seedRow, del } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { Script } from '../components/script.js'
import { loadClientPlugin } from '../../client-plugin.js'
import { EarlyTerminate } from '../../exception.js'
import { nodeToVNode } from '../jsx/vnode.js'
import { sessions } from '../session.js'
import { ServerMessage } from '../../../client/types.js'
import {
  canViewProject,
  getContextProject,
} from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { NoAccessMessage } from '../components/no-access-message.js'
import { env } from '../../env.js'
import { join } from 'path'
import { existsSync } from 'fs'
import { promises as fsPromises } from 'fs'
import {
  findTopSimilarPairs,
  ensureProjectEmbeddings,
  deriveWeightFromFeedbackGA,
  saveEmbeddingWeight,
  invalidateProjectVectorCache,
  EMBEDDING_MODEL_VERSION,
} from '../embedding.js'
import {
  preloadProjectScorer,
  getPreloadedScorer,
  invalidateRelationModelCache,
  getSimilarityMode,
  setSimilarityMode,
  getUiVersion,
  setUiVersion,
} from '../similarity-scorer.js'
import { trainMultiTaskModel } from '../relation-multitask.js'
import { RELATION_MODEL_VERSION } from '../relation-model.js'
import {
  suggestTriplet,
  suggestTripletBatch,
  trainRelationClassifier,
  countTriplets,
} from '../relation-triplet.js'

let pageTitle = <Locale en="Similar Images" zh_hk="相似圖片" zh_cn="相似图片" />

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let style = Style(/* css */ `
#SimilarImages {
  --padding-start: 1rem;
  --padding-end: 1rem;
  --padding-top: 1rem;
  --padding-bottom: 1rem;
}
.similar-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}
.similar-toolbar ion-button {
  margin: 0;
}
.similar-toolbar .top-k-select {
  max-width: 8rem;
}
/* shows which scorer is ranking the pairs */
.similar-mode-select {
  max-width: 8rem;
  font-size: 0.85rem;
}
/* the switch between the new and the legacy page version */
.similar-version-switch {
  margin-left: auto;
  font-size: 0.8rem;
  --padding-start: 0.5rem;
  --padding-end: 0.5rem;
}
.similar-section {
  margin-top: 0.5rem;
}
.similar-section h3 {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}
.similar-pair {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  background: var(--ion-color-light, #f4f5f8);
}
.similar-pair img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid #ccc;
  flex-shrink: 0;
  cursor: pointer;
}
/* delete button on the top-right corner of each thumbnail */
.similar-pair .img-wrapper {
  position: relative;
  flex-shrink: 0;
}
.similar-pair .img-wrapper img {
  display: block;
}
.similar-pair .img-wrapper .img-delete-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 1.25rem;
  height: 1.25rem;
  border: none;
  border-radius: 50%;
  background: #dc3545;
  color: #fff;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 1;
}
.similar-pair .img-wrapper .img-delete-btn:hover {
  background: #c82333;
}
.similar-pair .similar-score {
  font-size: 0.9rem;
  color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
  flex: 1;
  text-align: right;
}
/* rank controls: move up/down + position badge */
.similar-pair .rank-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}
.similar-pair .rank-controls button {
  border: none;
  border-radius: 0.3rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.9rem;
  cursor: pointer;
  background: #6e7881;
  color: #fff;
}
.similar-pair .rank-controls button:disabled {
  opacity: 0.3;
  cursor: default;
}
.similar-pair .rank-badge {
  min-width: 1.6rem;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--ion-color-primary, #3880ff);
  background: rgba(56, 128, 255, 0.12);
  border-radius: 0.3rem;
  padding: 0.2rem 0.3rem;
}
.similar-hint {
  font-size: 0.85rem;
  color: #999;
  margin: 0.5rem 0;
}
/* ------------------------------------------------------------------
   triplet relation annotation: pick the most similar pair of three
   ------------------------------------------------------------------ */
.triplet-box {
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: var(--ion-color-light, #f4f5f8);
  margin-bottom: 0.75rem;
}
.triplet-images {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.triplet-image {
  flex: 1;
  min-width: 0;
}
.triplet-image img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 0.4rem;
  border: 2px solid transparent;
  cursor: pointer;
  display: block;
  background: #eee;
  transition: border-color 0.15s, opacity 0.15s;
}
/* the two selected images are highlighted */
.triplet-image img.triplet-selected {
  border-color: var(--ion-color-primary, #3880ff);
}
/* the image that is not part of the pair is dimmed */
.triplet-image img.triplet-muted {
  opacity: 0.4;
}
.triplet-image .triplet-label {
  display: block;
  text-align: center;
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
  font-weight: 600;
}
.triplet-options {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.triplet-option {
  border: 1px solid #ccc;
  border-radius: 0.35rem;
  background: #fff;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  cursor: pointer;
  color: #333;
}
.triplet-option:hover {
  border-color: var(--ion-color-primary, #3880ff);
}
.triplet-option.triplet-option-active {
  background: var(--ion-color-primary, #3880ff);
  border-color: var(--ion-color-primary, #3880ff);
  color: #fff;
}
.triplet-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #888;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}
.triplet-position {
  font-weight: 600;
  color: var(--ion-color-primary, #3880ff);
}
.triplet-count {
  color: #666;
}
.triplet-hint {
  color: #999;
  font-style: italic;
}
/* the keyboard hint inside the answer buttons */
.triplet-option kbd {
  display: inline-block;
  min-width: 1.1rem;
  padding: 0.05rem 0.25rem;
  margin-right: 0.3rem;
  border: 1px solid #bbb;
  border-bottom-width: 2px;
  border-radius: 0.25rem;
  background: #f6f6f6;
  font-family: monospace;
  font-size: 0.75rem;
  text-align: center;
  color: #555;
}
.triplet-option-active kbd {
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
/* the progress toward the target number of annotations */
.triplet-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: #888;
  margin-bottom: 0.25rem;
}
.triplet-progress {
  height: 0.4rem;
  border-radius: 0.2rem;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
  margin-bottom: 0.75rem;
}
.triplet-progress-bar {
  height: 100%;
  border-radius: 0.2rem;
  background: var(--ion-color-primary, #3880ff);
  transition: width 0.25s;
}
/* banner shown when some images don't have an embedding yet */
.embed-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  margin-bottom: 1rem;
  border-radius: 0.5rem;
  background: rgba(255, 193, 7, 0.15);
  border: 1px solid rgba(255, 193, 7, 0.5);
  color: #856404;
  font-size: 0.9rem;
}
.embed-hint ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}
`)

let script = Script(/* js */ `
function getProjectId() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get('project') || '0');
}

async function computeEmbeddings() {
  if (typeof showToast === 'function') {
    showToast('Computing embeddings...', 'info', 'top-end', 0);
  }
  try {
    const json = await fetch_json('/similar-images/compute-embeddings?project=' + getProjectId());
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      else alert('Error: ' + json.error);
    } else {
      // clarify the "all skipped" case: it means every image already had
      // an embedding (e.g. computed during upload), not that nothing ran
      if (typeof showToast === 'function') {
        if (json.embedded > 0) {
          showToast('Done: ' + json.embedded + ' embedded, ' + json.skipped + ' skipped', 'success');
        } else {
          showToast('All ' + json.skipped + ' images already have embeddings — nothing to compute', 'info');
        }
      } else alert('Done: ' + json.embedded + ' embedded, ' + json.skipped + ' skipped');
      // the missing-embedding banner is now stale — remove it
      const hint = document.getElementById('embedHint');
      if (hint) hint.remove();
      findSimilarPairs();
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
    else alert('Error: ' + error);
  }
}

// Reads the user-selected number of pairs to display (Top 5/10/20).
// Shared by findSimilarPairs and deleteImage so the re-rendered list
// always matches the current selection.
function getTopK() {
  const kSelect = document.getElementById('topKSelect');
  return kSelect ? parseInt(kSelect.value) : 5;
}

function findSimilarPairs() {
  const container = document.getElementById('similarPairs');
  if (container) {
    container.className = 'similar-hint';
    container.textContent = 'Searching...';
  }
  emit('/similar-images/find-pairs', {
    project_id: getProjectId(),
    k: getTopK(),
  });
}

// Moves a pair up/down in the displayed list (up = more similar), then
// saves the whole new ordering to the server right away — no separate
// "confirm" step; the saved ranks are what "Train from Ranking" uses.
function movePair(btn, direction) {
  const row = btn.closest('.similar-pair');
  if (!row) return;
  // rows are children of the wrapper div inside #similarPairs, so
  // reorder within the row's actual parent (not the container itself)
  const parent = row.parentElement;
  if (!parent) return;
  const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling || !sibling.classList.contains('similar-pair')) return;
  if (direction === 'up') {
    parent.insertBefore(row, sibling);
  } else {
    parent.insertBefore(sibling, row);
  }
  // persist the new ordering (most similar first) — each pair's rank is
  // its index in the displayed list
  const rows = Array.from(parent.querySelectorAll('.similar-pair'));
  emit('/similar-images/rank', {
    project_id: getProjectId(),
    ordered_pairs: rows.map(item => ({
      image_a_id: parseInt(item.dataset.imageAId),
      image_b_id: parseInt(item.dataset.imageBId),
    })),
  });
  // refresh badges + button disabled states
  rows.forEach((item, index) => {
    const badge = item.querySelector('.rank-badge');
    if (badge) badge.textContent = String(index + 1);
    const up = item.querySelector('.rank-up');
    const down = item.querySelector('.rank-down');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
}

// Trains the AI weight from the saved pair ranking feedback, then the
// server automatically re-runs the search with the newly trained weight
// and refreshes the list — no manual "Find Similar" step.
function trainWeight() {
  if (typeof showToast === 'function') {
    showToast('Training AI from your ranking...', 'info', 'top-end', 0);
  }
  emit('/similar-images/train-weight', {
    project_id: getProjectId(),
    k: getTopK(),
  });
}

// Trains the shared similarity model from the saved pair ranking
// feedback. The training runs real backprop on the server, so it goes
// through an ajax endpoint; when it finishes the pair list is
// re-searched with the new model.
async function trainModel() {
  if (typeof showToast === 'function') {
    showToast('Training similarity model...', 'info', 'top-end', 0);
  }
  try {
    const json = await fetch_json('/similar-images/train-model?project=' + getProjectId());
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      else alert('Error: ' + json.error);
    } else {
      if (typeof showToast === 'function') {
        showToast(
          'Model trained (best epoch ' + json.bestEpoch + ')',
          'success'
        );
      }
      findSimilarPairs();
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
    else alert('Error: ' + error);
  }
}

// Loads the similarity model of the project into the server cache. The
// pair search itself is synchronous on the server, so the model has to
// be in place before the first search.
async function preloadScorer() {
  try {
    await fetch_json('/similar-images/preload?project=' + getProjectId());
  } catch (error) {
    console.error('failed to preload similarity model', error);
  }
}

// Deletes one image (from a similar pair) after user confirmation.
// The server cleans up the DB rows + file, then re-renders the list
// with the currently selected number of pairs.
function deleteImage(btn, image_id) {
  const doDelete = () => {
    emit('/similar-images/delete-image', {
      project_id: getProjectId(),
      image_id: image_id,
      k: getTopK(),
    });
  };
  if (typeof Swal !== 'undefined') {
    // heightAuto: false — required on ionic pages: ionic sets
    // body { position: fixed }, and swal2's default height-auto
    // class collapses the body to 0px (white screen)
    Swal.fire({
      title: 'Delete this image?',
      text: 'It will be removed from the dataset (including annotations).',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc3545',
      heightAuto: false,
    }).then(result => {
      if (result.isConfirmed) doDelete();
    });
  } else {
    if (confirm('Delete this image? It will be removed from the dataset.')) doDelete();
  }
}

// Trains the relation classifier (the 4-way "which two of these three
// are the most similar" model) on the annotated triplets.
async function trainRelationModel() {
  if (typeof showToast === 'function') {
    showToast('Training relation model...', 'info', 'top-end', 0);
  }
  try {
    const json = await fetch_json('/similar-images/train-relation?project=' + getProjectId());
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      else alert('Error: ' + json.error);
    } else {
      if (typeof showToast === 'function') {
        showToast(
          'Relation model trained: ' + (json.accuracy * 100).toFixed(1) + '% accuracy',
          'success'
        );
      }
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
    else alert('Error: ' + error);
  }
}

/**
 * Switches the page between the new version (trained model + triplet
 * annotation) and the legacy one (weighted cosine + pair ranking).
 *
 * The whole page is reloaded because the two versions render different
 * sections — the server decides which one to show.
 */
async function switchUiVersion(version) {
  try {
    const json = await fetch_json(
      '/similar-images/set-version?project=' + getProjectId() + '&version=' + version,
    );
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      return;
    }
    // reload so the server renders the other version
    window.location.reload();
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
  }
}

/**
 * Switches the scoring mode: 'relation' (the trained model) or
 * 'weighted' (the original per-dimension weight). The choice is stored
 * on the server, because the pair list is rendered by a synchronous
 * websocket component.
 */
async function switchSimilarityMode(mode) {
  try {
    const json = await fetch_json(
      '/similar-images/set-mode?project=' + getProjectId() + '&mode=' + mode,
    );
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      return;
    }
    if (typeof showToast === 'function') {
      showToast(
        mode === 'relation'
          ? 'Using the trained model'
          : 'Using the weighted cosine',
        'info',
      );
    }
    findSimilarPairs();
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
  }
}

// ---------------------------------------------------------------------------
// triplet relation annotation
// ---------------------------------------------------------------------------

// The triplets currently on screen. var (not let) because the inline
// script is re-executed on every websocket update.
var tripletBatch = [];
// The index of the triplet the user is working on.
var tripletIndex = 0;
// The image picked first in the current triplet.
var tripletPending = null;
// How many triplets to show at once.
var TRIPLET_BATCH_SIZE = 4;
// The target number of annotations to reach.
var TRIPLET_TARGET = 50;

// Loads a batch of triplets to annotate.
async function loadTripletBatch() {
  try {
    const json = await fetch_json(
      '/similar-images/triplets?project=' + getProjectId() + '&count=' + TRIPLET_BATCH_SIZE,
    );
    if (json.error) {
      const box = document.getElementById('tripletBox');
      if (box) box.innerHTML = '<div class="similar-hint">' + json.error + '</div>';
      return;
    }
    tripletBatch = json.triplets || [];
    tripletIndex = 0;
    tripletPending = null;
    if (tripletBatch.length === 0) {
      const box = document.getElementById('tripletBox');
      if (box) {
        box.innerHTML =
          '<div class="similar-hint">No more triplets to annotate. ' +
          'The dataset may not have enough images with embeddings.</div>';
      }
      renderTripletProgress(json.count || 0);
      return;
    }
    renderTripletBatch(json.count || 0);
  } catch (error) {
    console.error('failed to load triplet batch', error);
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
  }
}

// Renders the whole batch: the current triplet in full, the others
// smaller so the user can see what is coming.
function renderTripletBatch(count) {
  const box = document.getElementById('tripletBox');
  if (!box) return;

  const current = tripletBatch[tripletIndex];
  if (!current) return;

  const items = [
    { key: 'a', id: current.image_a_id, file: current.filename_a },
    { key: 'b', id: current.image_b_id, file: current.filename_b },
    { key: 'c', id: current.image_c_id, file: current.filename_c },
  ];
  const images = items.map(function (item) {
    return (
      '<div class="triplet-image" data-triplet-key="' + item.key + '">' +
      '<img src="/uploads/' + item.file + '" alt="' + item.key + '" loading="lazy" ' +
      'onclick="selectTripletImage(this)" />' +
      '<span class="triplet-label">' + item.key.toUpperCase() + '</span>' +
      '</div>'
    );
  }).join('');

  box.innerHTML =
    '<div class="triplet-meta">' +
    '<span class="triplet-position">Triplet ' + (tripletIndex + 1) + ' of ' + tripletBatch.length + '</span>' +
    '<span class="triplet-count">Annotated: ' + count + '</span>' +
    '<span class="triplet-hint">Press 1-4 to answer</span>' +
    '<button type="button" class="triplet-option" onclick="loadTripletBatch()">Skip batch</button>' +
    '</div>' +
    '<div class="triplet-images">' + images + '</div>' +
    '<div class="triplet-options">' +
    '<button type="button" class="triplet-option" data-relation="0" onclick="answerTriplet(0)"><kbd>1</kbd> A and B are the most similar</button>' +
    '<button type="button" class="triplet-option" data-relation="1" onclick="answerTriplet(1)"><kbd>2</kbd> A and C are the most similar</button>' +
    '<button type="button" class="triplet-option" data-relation="2" onclick="answerTriplet(2)"><kbd>3</kbd> B and C are the most similar</button>' +
    '<button type="button" class="triplet-option" data-relation="3" onclick="answerTriplet(3)"><kbd>4</kbd> All three are equally similar</button>' +
    '</div>';
}

// The progress bar toward the target number of annotations.
function renderTripletProgress(count) {
  const el = document.getElementById('tripletProgress');
  if (!el) return;
  const pct = Math.min(100, Math.round((count / TRIPLET_TARGET) * 100));
  el.innerHTML =
    '<div class="triplet-progress-label">' +
    '<span>Annotated triplets</span>' +
    '<span>' + count + ' / ' + TRIPLET_TARGET + '</span>' +
    '</div>' +
    '<div class="triplet-progress"><div class="triplet-progress-bar" style="width:' + pct + '%"></div></div>';
}

// Saves the answer for the current triplet and moves to the next one.
async function answerTriplet(relation) {
  if (tripletBatch.length === 0) return;
  const current = tripletBatch[tripletIndex];
  if (!current) return;

  try {
    const json = await fetch_json(
      '/similar-images/triplet-answer?project=' + getProjectId(),
      {
        method: 'POST',
        // express.json() only parses a body sent as JSON
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: getProjectId(),
          image_a_id: current.image_a_id,
          image_b_id: current.image_b_id,
          image_c_id: current.image_c_id,
          relation: relation,
        }),
      },
    );
    if (json.error) {
      if (typeof showToast === 'function') showToast('Error: ' + json.error, 'error');
      else alert('Error: ' + json.error);
      return;
    }

    renderTripletProgress(json.count || 0);

    // move to the next triplet in the batch; load a new batch when the
    // current one is exhausted
    tripletPending = null;
    tripletIndex++;
    if (tripletIndex >= tripletBatch.length) {
      await loadTripletBatch();
    } else {
      renderTripletBatch(json.count || 0);
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
    else alert('Error: ' + error);
  }
}

// The image picked first; the second click completes the pair.
// var (not let) because the inline script is re-executed on every update.
var tripletPending = null;

// Highlights the two images of the chosen relation and dims the third.
function selectTripletImage(img) {
  const box = document.getElementById('tripletBox');
  if (!box) return;
  const key = img.closest('.triplet-image').dataset.tripletKey;

  if (tripletPending === null) {
    // first click: remember it and mark it
    tripletPending = key;
    for (const el of box.querySelectorAll('.triplet-image img')) {
      el.classList.remove('triplet-selected', 'triplet-muted');
      el.closest('.triplet-image').dataset.tripletKey === key &&
        el.classList.add('triplet-selected');
    }
    return;
  }

  if (tripletPending === key) {
    // clicking the same image again cancels the selection
    tripletPending = null;
    for (const el of box.querySelectorAll('.triplet-image img')) {
      el.classList.remove('triplet-selected', 'triplet-muted');
    }
    for (const el of box.querySelectorAll('.triplet-option[data-relation]')) {
      el.classList.remove('triplet-option-active');
    }
    return;
  }

  // second click: the two images form the most similar pair
  const first = tripletPending;
  tripletPending = null;
  const pair = [first, key].sort();
  // a~b -> 0, a~c -> 1, b~c -> 2
  const relation = { 'a,b': 0, 'a,c': 1, 'b,c': 2 }[pair.join(',')];

  for (const el of box.querySelectorAll('.triplet-image img')) {
    const elKey = el.closest('.triplet-image').dataset.tripletKey;
    el.classList.remove('triplet-selected', 'triplet-muted');
    if (pair.indexOf(elKey) >= 0) el.classList.add('triplet-selected');
    else el.classList.add('triplet-muted');
  }
  for (const el of box.querySelectorAll('.triplet-option[data-relation]')) {
    el.classList.toggle(
      'triplet-option-active',
      Number(el.dataset.relation) === relation,
    );
  }
}

// Sends the answer to the server and loads the next triplet.
// run once on mount — defer until the client bundle defines emit()
// (on a full page load the inline script runs before the bundle loads)
async function initSimilarImages() {
  if (typeof emit !== 'function') {
    setTimeout(initSimilarImages, 100);
    return;
  }
  bindTopKSelect();
  bindModeSelect();
  if (!getProjectId()) return;
  // load the similarity model into the server cache first — the pair
  // search is synchronous on the server, so the model has to be ready
  await preloadScorer();
  // the websocket may still be connecting (the model load above is
  // async), and emit() on a connecting socket throws
  await waitForWebSocket();
  // if some images have no embedding yet, compute them first — the
  // server endpoint broadcasts progress and findSimilarPairs() runs
  // automatically when done (see computeEmbeddings)
  const hint = document.getElementById('embedHint');
  if (hint) {
    computeEmbeddings();
  } else {
    findSimilarPairs();
  }
  // load a batch of triplets to annotate (the relation classifier
  // needs these) — only the new version has the triplet section
  if (document.getElementById('tripletBox')) {
    loadTripletBatch();
    bindTripletShortcuts();
  }
}
initSimilarImages();

// Waits until the websocket is open. Calling emit() while it is still
// connecting throws "InvalidStateError: ... Still in CONNECTING state".
function waitForWebSocket() {
  return new Promise(function (resolve) {
    let check = function () {
      let socket = window.__ws;
      if (!socket || socket.readyState === 1) {
        // open (or no socket at all) — go ahead
        resolve(undefined);
      } else if (socket.readyState === 3) {
        // closed — give up rather than wait forever
        resolve(undefined);
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// ion-select is an Ionic web component: it does NOT fire a native
// 'change' event, so an inline onchange attribute never runs. Bind an
// 'ionChange' listener instead (dataset.bound guards against double
// binding when the framework re-executes this script on ws updates).
function bindTopKSelect() {
  const kSelect = document.getElementById('topKSelect');
  if (!kSelect || kSelect.dataset.bound) return;
  kSelect.addEventListener('ionChange', function (event) {
    findSimilarPairs();
  });
  kSelect.dataset.bound = '1';
}

// The mode select is an Ionic web component, so it does NOT fire a
// native 'change' event — bind 'ionChange' instead.
function bindModeSelect() {
  const modeSelect = document.getElementById('modeSelect');
  if (!modeSelect || modeSelect.dataset.bound) return;
  modeSelect.addEventListener('ionChange', function (event) {
    switchSimilarityMode(event.detail.value);
  });
  modeSelect.dataset.bound = '1';
}

// Keyboard shortcuts for the triplet annotation:
//   1 / 2 / 3  — the pair A&B / A&C / B&C is the most similar
//   4          — all three are equally similar
//   Q / W / E  — pick the first image of the pair (A / B / C)
//   Enter      — confirm the pair picked with Q/W/E
//   Arrow keys — move between the images of the current triplet
function bindTripletShortcuts() {
  if (document.body.dataset.tripletKeysBound) return;
  document.body.dataset.tripletKeysBound = '1';

  document.addEventListener('keydown', function (event) {
    // ignore when the user is typing in a field
    const tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tripletBatch.length === 0) return;
    // let the browser handle the usual modifier combinations
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const key = event.key;
    if (key === '1') { answerTriplet(0); event.preventDefault(); }
    else if (key === '2') { answerTriplet(1); event.preventDefault(); }
    else if (key === '3') { answerTriplet(2); event.preventDefault(); }
    else if (key === '4') { answerTriplet(3); event.preventDefault(); }
    else if (key === 'q' || key === 'Q') { pickTripletImage('a'); event.preventDefault(); }
    else if (key === 'w' || key === 'W') { pickTripletImage('b'); event.preventDefault(); }
    else if (key === 'e' || key === 'E') { pickTripletImage('c'); event.preventDefault(); }
  });
}

// Picks the first image of the pair (used by the Q/W/E shortcuts).
function pickTripletImage(key) {
  const el = document.querySelector(
    '#tripletBox .triplet-image[data-triplet-key="' + key + '"] img',
  );
  if (el) selectTripletImage(el);
}
`)

// back to the manage-dataset page this page is opened from (not the
// project home) — mirrors ProjectPageBackButton but targets manage-dataset
function ManageBackButton(attrs: {}, context: DynamicContext) {
  let project = getContextProject(context)
  if (project) {
    return (
      <IonBackButton
        href={`/manage-dataset?project=${project.id}`}
        backText={<Locale en="Manage" zh_hk="管理" zh_cn="管理" />}
      />
    )
  }
  return <IonBackButton href="/" backText="Home" />
}

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ManageBackButton />
        <ion-title role="heading" aria-level="1">
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="SimilarImages" class="ion-no-padding">
      <Main />
    </ion-content>
    {sweetAlertPlugin.node}
    {script}
  </>
)

// counts images of a project that have no embedding row for the current
// model version — used to warn the user to run Compute Embeddings first
// (bulk-imported images are NOT embedded on upload, only by that button)
let count_missing_embeddings = db
  .prepare<{ project_id: number; model_version: string }, number>(
    /* sql */ `
  select count(*) from image
  where project_id = :project_id
    and not exists (
      select 1 from image_embedding
      where image_embedding.image_id = image.id
        and image_embedding.model_version = :model_version
    )
`,
  )
  .pluck()

/**
 * Whether the project has a trained relation model. The page shows
 * which scorer is ranking the pairs, so the user knows what the
 * "Train from Ranking" button (the weighted cosine) actually affects.
 */
function hasRelationModel(project_id: number): boolean {
  return existsSync(
    join(
      process.cwd(),
      `saved_models/project-${project_id}/relation/model.json`,
    ),
  )
}

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  if (!canViewProject(user, project)) return <NoAccessMessage />
  // fresh projects (esp. bulk imports) have images without embeddings;
  // the client auto-computes them on mount (see initSimilarImages) and
  // then loads the pairs — the banner tells the user what is happening
  let missingEmbeddings =
    count_missing_embeddings.get({
      project_id: project.id!,
      model_version: EMBEDDING_MODEL_VERSION,
    }) ?? 0

  // the page shows either the new version (trained model + triplet
  // annotation) or the legacy one (weighted cosine + pair ranking) —
  // never both. The new version is the default; the switch in the
  // toolbar brings the legacy one back.
  let isNew = getUiVersion(project.id!) === 'new'

  return (
    <>
      {missingEmbeddings > 0 && (
        <div class="embed-hint" id="embedHint">
          <ion-icon name="hourglass"></ion-icon>
          <span>
            <Locale
              en={`Computing embeddings for ${missingEmbeddings} image(s)... the pairs will load automatically when done.`}
              zh_hk={`正在為 ${missingEmbeddings} 張圖片計算向量，完成後會自動載入配對。`}
              zh_cn={`正在为 ${missingEmbeddings} 张图片计算向量，完成后会自动载入配对。`}
            />
          </span>
        </div>
      )}
      <div class="similar-toolbar">
        {isNew ? (
          <>
            <ion-button color="primary" onclick="trainModel()">
              <ion-icon name="sparkles" slot="start"></ion-icon>
              <span>
                <Locale en="Train Model" zh_hk="訓練模型" zh_cn="训练模型" />
              </span>
            </ion-button>
            <ion-select
              id="modeSelect"
              class="similar-mode-select"
              interface="popover"
              value={getSimilarityMode(project.id!)}
            >
              <ion-select-option value="relation">
                <Locale en="Model" zh_hk="模型" zh_cn="模型" />
              </ion-select-option>
              <ion-select-option value="weighted">
                <Locale en="Weighted" zh_hk="加權" zh_cn="加权" />
              </ion-select-option>
            </ion-select>
          </>
        ) : (
          <>
            <ion-button color="tertiary" onclick="trainWeight()">
              <ion-icon name="fitness" slot="start"></ion-icon>
              <span>
                <Locale
                  en="Train from Ranking"
                  zh_hk="用排序訓練"
                  zh_cn="用排序训练"
                />
              </span>
            </ion-button>
          </>
        )}
        <ion-select
          id="topKSelect"
          class="top-k-select"
          interface="popover"
          value="5"
        >
          <ion-select-option value="5">
            <Locale en="Top 5" zh_hk="前 5" zh_cn="前 5" />
          </ion-select-option>
          <ion-select-option value="10">
            <Locale en="Top 10" zh_hk="前 10" zh_cn="前 10" />
          </ion-select-option>
          <ion-select-option value="20">
            <Locale en="Top 20" zh_hk="前 20" zh_cn="前 20" />
          </ion-select-option>
        </ion-select>
        <ion-button
          class="similar-version-switch"
          fill="outline"
          size="small"
          onclick={`switchUiVersion('${isNew ? 'legacy' : 'new'}')`}
        >
          <ion-icon name="swap-horizontal" slot="start"></ion-icon>
          <span>
            {isNew ? (
              <Locale
                en="Switch to legacy version"
                zh_hk="切換舊版本"
                zh_cn="切换旧版本"
              />
            ) : (
              <Locale
                en="Switch to new version"
                zh_hk="切換新版"
                zh_cn="切换新版"
              />
            )}
          </span>
        </ion-button>
      </div>
      <div class="similar-section">
        <h3>
          <Locale
            en="Most similar image pairs in this dataset"
            zh_hk="數據集中最相似的圖片配對"
            zh_cn="数据集中最相似的图片配对"
          />
        </h3>
        <div id="similarPairs" class="similar-hint">
          <Locale
            en="Click Find Similar to see the most similar image pairs across the whole dataset."
            zh_hk="按「找相似」查看整個數據集最相似的圖片配對。"
            zh_cn="按「找相似」查看整个数据集最相似的图片配对。"
          />
        </div>
      </div>
      {isNew && (
        <div class="similar-section" id="tripletSection">
          <h3>
            <Locale
              en="Which two of these three are the most similar?"
              zh_hk="這三張圖中哪兩張最相似？"
              zh_cn="这三张图中哪两张最相似？"
            />
          </h3>
          <p class="similar-hint">
            <Locale
              en="Pick the closest pair, or say that all three are about equally similar. These answers teach the model what similarity means for this dataset."
              zh_hk="選出最相似的一對，或表示三張都差不多。這些答案會教會模型這個數據集裡的「相似」是什麼意思。"
              zh_cn="选出最相似的一对，或表示三张都差不多。这些答案会教会模型这个数据集里的「相似」是什么意思。"
            />
          </p>
          <div id="tripletProgress"></div>
          <div id="tripletBox" class="triplet-box">
            <div class="similar-hint">
              <Locale
                en="Loading a triplet..."
                zh_hk="正在載入三元組..."
                zh_cn="正在载入三元组..."
              />
            </div>
          </div>
          <ion-button
            color="tertiary"
            size="small"
            onclick="trainRelationModel()"
          >
            <ion-icon name="school" slot="start"></ion-icon>
            <span>
              <Locale
                en="Train Relation Model"
                zh_hk="訓練關係模型"
                zh_cn="训练关系模型"
              />
            </span>
          </ion-button>
        </div>
      )}
    </>
  )
}

let findPairsParser = object({
  project_id: id(),
  k: optional(id()),
  /**
   * Which scorer ranks the pairs: 'relation' (the trained model, the
   * default) or 'weighted' (the original per-dimension weight). The
   * user can switch back to the old behaviour from the toolbar.
   */
  mode: optional(values(['relation' as const, 'weighted' as const])),
})

// The answer to a triplet annotation: which two of the three images
// are the most similar, or that all three are equally similar.
// The relation values are 0-3, so `id()` (which requires a minimum of
// 1) cannot be used here.
let tripletAnswerParser = object({
  project_id: id(),
  image_a_id: id(),
  image_b_id: id(),
  image_c_id: id(),
  relation: values([0, 1, 2, 3] as const),
})

// ---------------------------------------------------------------------------
// pair ranking (user orders pairs: most similar first)
// ---------------------------------------------------------------------------
let rankParser = object({
  project_id: id(),
  ordered_pairs: array(
    object({
      image_a_id: id(),
      image_b_id: id(),
    }),
  ),
})

// Saves the user's ordering of the displayed pairs as pairwise
// comparisons. The client sends the full list in display order (most
// similar first); the server expands it into every two-pair comparison
// (ordered[i] is more similar than ordered[j] for all i < j) and upserts
// each one — comparisons accumulate across sessions and are what
// "Train from Ranking" learns from.
function PairRank(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'Login required'

    let body = getContextFormBody(context)
    let input = rankParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    // resolve and normalize the displayed pairs first (a < b per pair)
    let pairs: { a: number; b: number }[] = []
    for (let pair of input.ordered_pairs) {
      let image_a = proxy.image[pair.image_a_id]
      let image_b = proxy.image[pair.image_b_id]
      if (!image_a || !image_b) continue
      pairs.push({
        a: Math.min(pair.image_a_id, pair.image_b_id),
        b: Math.max(pair.image_a_id, pair.image_b_id),
      })
    }

    let now = Math.floor(Date.now() / 1000)
    // every ordered pair of list positions i < j: the pair at i is more
    // similar than the pair at j
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        let hi = pairs[i]!
        let lo = pairs[j]!
        // order the two pairs by (a, b) lexicographically so the stored
        // direction is canonical — flipping the user's mind later just
        // flips hi_more_similar on the same row (upsert)
        let hiFirst = hi.a < lo.a || (hi.a === lo.a && hi.b < lo.b)
        let row = hiFirst
          ? {
              pair_hi_a_id: hi.a,
              pair_hi_b_id: hi.b,
              pair_lo_a_id: lo.a,
              pair_lo_b_id: lo.b,
              hi_more_similar: 1,
            }
          : {
              pair_hi_a_id: lo.a,
              pair_hi_b_id: lo.b,
              pair_lo_a_id: hi.a,
              pair_lo_b_id: hi.b,
              hi_more_similar: 0,
            }
        seedRow(
          proxy.similar_pair_comparison,
          {
            project_id: input.project_id,
            user_id: user.id!,
            pair_hi_a_id: row.pair_hi_a_id,
            pair_hi_b_id: row.pair_hi_b_id,
            pair_lo_a_id: row.pair_lo_a_id,
            pair_lo_b_id: row.pair_lo_b_id,
          },
          {
            hi_more_similar: row.hi_more_similar,
            created_at: now,
          },
        )
      }
    }

    // update the rank badges + acknowledge the save
    let code = `
     document.querySelectorAll('#similarPairs .similar-pair').forEach((row, index) => {
       let badge = row.querySelector('.rank-badge')
       if (badge) badge.textContent = String(index + 1)
     })
     if (typeof showToast === 'function') showToast('Ranking saved', 'success')`
    context.ws.send(['eval', code])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('PairRank Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// train weight from ranking feedback
// ---------------------------------------------------------------------------
let trainWeightParser = object({
  project_id: id(),
  k: optional(id()),
})

// Trains the per-project embedding weight from the user's pair ranking
// feedback and saves it to embedding_weight (source='similar-feedback').
// The training itself is a fast contrastive approximation (no tfjs), so it
// runs synchronously here. After training, the pairs list is automatically
// re-searched with the new weight and re-rendered — the user no longer
// clicks "Find Similar" manually.
function TrainSimilarWeight(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'Login required'

    let body = getContextFormBody(context)
    let input = trainWeightParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let startedAt = Date.now()
    let weight = deriveWeightFromFeedbackGA({ project_id })
    if (!weight) {
      context.ws.send([
        'eval',
        `if (typeof showToast === 'function')
           showToast('Need at least 2 ranked pairs to train. Move some pairs first.', 'warning')`,
      ])
      throw EarlyTerminate
    }

    saveEmbeddingWeight({
      project_id,
      label_id: null,
      weight,
      source: 'similar-feedback',
    })

    let elapsedMs = Date.now() - startedAt
    // The trained weight only affects the weighted cosine. When the
    // project also has a relation model, that model keeps being used —
    // the toast tells the user which scorer the list was ranked with.
    let scorer = getPreloadedScorer(project_id)
    let results = findTopSimilarPairs({
      project_id,
      k: input.k ?? 5,
      scorer: scorer ?? undefined,
    })
    sendSimilarPairs(results, context)
    let mode = scorer?.mode ?? 'weighted'
    context.ws.send([
      'eval',
      `if (typeof showToast === 'function')
         showToast('AI trained from your ranking (GA, ${elapsedMs}ms) — list refreshed (${mode} mode)', 'success')`,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('TrainSimilarWeight Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

function FindSimilarPairs(attrs: {}, context: WsContext) {
  // must be a sync component: async components are invoked synchronously by
  // componentToVNode, which turns the return value into a Promise and breaks
  // nodeToVNode (and the EarlyTerminate rejection would crash the server)
  try {
    let user_id = getAuthUserId(context)!
    if (!user_id) throw 'Login required'

    let body = getContextFormBody(context)
    let input = findPairsParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!

    // The scorer was preloaded when the page was rendered, for both
    // modes, so switching between them is a cache lookup. This
    // component has to stay synchronous (see the comment above).
    let scorer = getPreloadedScorer(project_id) ?? undefined
    let results = findTopSimilarPairs({ project_id, k: input.k ?? 5, scorer })
    sendSimilarPairs(results, context)
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('FindSimilarPairs Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

function sendSimilarPairs(
  results: ReturnType<typeof findTopSimilarPairs>,
  context: WsContext,
) {
  if (!results || results.length === 0) {
    context.ws.send([
      'update-in',
      '#similarPairs',
      nodeToVNode(
        <div class="similar-hint">
          <p>
            <Locale
              en="No similar pairs found. Run Compute Embeddings first."
              zh_hk="找不到相似配對。請先按「計算向量」。"
              zh_cn="找不到相似配对。请先按「计算向量」。"
            />
          </p>
        </div>,
        context,
      ),
    ])
  } else {
    context.ws.send([
      'update-in',
      '#similarPairs',
      nodeToVNode(
        <div>
          {mapArray(results, (item, index) => {
            // normalize pair order so the data attributes are consistent
            let a = Math.min(item.image_id_a, item.image_id_b)
            let b = Math.max(item.image_id_a, item.image_id_b)
            return (
              <div class="similar-pair" data-image-a-id={a} data-image-b-id={b}>
                <div class="img-wrapper">
                  <img
                    src={`/uploads/${item.filename_a}`}
                    alt="a"
                    loading="lazy"
                    onclick={`window.open('/uploads/${item.filename_a}', '_blank')`}
                  />
                  <button
                    type="button"
                    class="img-delete-btn"
                    title="Delete this image"
                    onclick={`deleteImage(this, ${item.image_id_a})`}
                  >
                    ×
                  </button>
                </div>
                <div class="img-wrapper">
                  <img
                    src={`/uploads/${item.filename_b}`}
                    alt="b"
                    loading="lazy"
                    onclick={`window.open('/uploads/${item.filename_b}', '_blank')`}
                  />
                  <button
                    type="button"
                    class="img-delete-btn"
                    title="Delete this image"
                    onclick={`deleteImage(this, ${item.image_id_b})`}
                  >
                    ×
                  </button>
                </div>
                <div
                  class="similar-score"
                  title={
                    Number.isNaN(item.score_percent)
                      ? 'The model has not separated these pairs yet — the order still reflects the plain cosine.'
                      : ''
                  }
                >
                  {Number.isNaN(item.score_percent)
                    ? '—'
                    : item.score_percent.toFixed(1) + '%'}
                </div>
                <div class="rank-controls">
                  <button
                    type="button"
                    class="rank-up"
                    title="Move up (more similar)"
                    onclick="movePair(this, 'up')"
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="rank-down"
                    title="Move down (less similar)"
                    onclick="movePair(this, 'down')"
                    disabled={index === results.length - 1}
                  >
                    ↓
                  </button>
                  <span class="rank-badge">{index + 1}</span>
                </div>
              </div>
            )
          })}
        </div>,
        context,
      ),
    ])
  }
}

// ---------------------------------------------------------------------------
// delete one image (from a similar pair)
// ---------------------------------------------------------------------------
let deleteImageParser = object({
  project_id: id(),
  image_id: id(),
  k: optional(id()),
})

// Deletes a single image with full cleanup (same chain as manage-dataset
// BatchDelete): embedding, bounding boxes + confirmations, labels, the
// image row itself, and the physical file when no other row references it.
// Also removes the pair feedback rows the image took part in. Then
// re-renders the pairs list with the user-selected number of pairs.
function DeleteImage(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'Login required'

    let body = getContextFormBody(context)
    let input = deleteImageParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let image = proxy.image[input.image_id]
    if (!image || image.project_id !== input.project_id) {
      throw 'Image not found in project'
    }

    let filename = image.filename
    db.transaction(() => {
      del(proxy.image_embedding, { image_id: input.image_id })
      del(proxy.image_bounding_box_confirmation, { image_id: input.image_id })
      del(proxy.image_bounding_box, { image_id: input.image_id })
      del(proxy.image_label, { image_id: input.image_id })
      del(proxy.similar_pair_feedback, { image_a_id: input.image_id })
      del(proxy.similar_pair_feedback, { image_b_id: input.image_id })
      del(proxy.image, { id: input.image_id })
    })()
    // only delete the physical file when no other image row references it
    let stillUsed = db
      .prepare<{ filename: string; image_id: number }, number>(
        /* sql */ `
        select count(*) from image
        where filename = :filename and id != :image_id
        `,
      )
      .pluck()
      .get({ filename, image_id: input.image_id })
    if (!stillUsed) {
      let filePath = join(env.UPLOAD_DIR, filename)
      fsPromises.rm(filePath, { force: true }).catch(err => {
        console.error('DeleteImage file delete failed:', err)
      })
    }
    // embeddings were deleted above; drop the cached vector matrix
    invalidateProjectVectorCache(input.project_id)

    // re-render the pairs list (the deleted image is gone from the DB,
    // so findTopSimilarPairs no longer returns it)
    let results = findTopSimilarPairs({
      project_id: input.project_id,
      k: input.k ?? 5,
    })
    sendSimilarPairs(results, context)
    context.ws.send([
      'eval',
      `if (typeof showToast === 'function') showToast('Image deleted', 'success')`,
    ])
    throw EarlyTerminate
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('DeleteImage Error:', error)
      context.ws.send(showError(error))
    }
    throw EarlyTerminate
  }
}

// ---------------------------------------------------------------------------
// compute embeddings (toolbar backfill)
// ---------------------------------------------------------------------------
function broadcastProgress(project_id: number, done: number, total: number) {
  let message: ServerMessage = [
    'eval',
    `if (typeof document !== 'undefined' && typeof Swal !== 'undefined') {
      if (Swal.isVisible()) {
        Swal.update({ title: 'Computing embeddings... ${done}/${total}' })
      } else {
        showToast('Computing embeddings... ${done}/${total}', 'info', 'top-end', 0)
      }
    }`,
  ]
  sessions.forEach(session => {
    if (session.url?.startsWith('/similar-images')) {
      session.ws.send(message)
    }
  })
}

async function ComputeEmbeddings(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let images = filter(proxy.image, { project_id })
    let total = images.length
    let embedded = 0
    let skipped = 0
    await ensureProjectEmbeddings({
      project_id,
      onProgress: (done, total) => {
        broadcastProgress(project_id, done, total)
      },
    })
    // count how many already had a cached embedding
    for (let image of images) {
      let cached = db
        .prepare<{ image_id: number; model_version: string }, unknown>(
          /* sql */ `select 1 from image_embedding where image_id = :image_id and model_version = :model_version limit 1`,
        )
        .get({ image_id: image.id!, model_version: EMBEDDING_MODEL_VERSION })
      if (cached) skipped++
    }
    embedded = total - skipped
    return { embedded, skipped, total }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

// ---------------------------------------------------------------------------
// train the shared similarity model
// ---------------------------------------------------------------------------

/**
 * Trains the shared similarity model from the pair ranking feedback and
 * saves it. The training is asynchronous (it runs real backprop), so it
 * runs through an ajax endpoint rather than a websocket component.
 */
async function TrainRelationModelApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let result = await trainMultiTaskModel({
      project_id,
      onProgress: (epoch, loss) => {
        broadcastTrainingProgress(project_id, epoch, loss)
      },
      onValidation: (epoch, ranking, classification) => {
        let extra =
          classification == null
            ? ''
            : `, relation ${(classification * 100).toFixed(1)}%`
        broadcastTrainingProgress(
          project_id,
          epoch,
          NaN,
          `ranking ${(ranking * 100).toFixed(1)}%${extra}`,
        )
      },
    })
    if (!result) {
      return {
        error:
          'Not enough ranking feedback. Move some pairs up or down first, then train again.',
      }
    }

    // the new model has to be loaded before the pair list can use it
    invalidateRelationModelCache(project_id)
    await preloadProjectScorer({ project_id })

    // record the model metadata
    seedRow(
      proxy.relation_model,
      { project_id, label_id: null },
      {
        model_version: RELATION_MODEL_VERSION,
        spec: JSON.stringify(result.bundle.spec),
        trained_at: Math.floor(Date.now() / 1000),
      },
    )

    broadcastTrainingDone(project_id, result)
    return {
      ok: true,
      epochs: result.epochs,
      bestEpoch: result.bestEpoch,
      rankingAccuracy: result.rankingAccuracy,
      classificationAccuracy: result.classificationAccuracy,
      loss: result.loss,
      constraints: result.constraintCount,
      triplets: result.tripletCount,
    }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

function broadcastTrainingProgress(
  project_id: number,
  epoch: number,
  loss: number,
  detail = '',
) {
  let lossText = Number.isNaN(loss) ? '' : `, loss ${loss.toFixed(4)}`
  let message: ServerMessage = [
    'eval',
    /* javascript */ `
      if (typeof showToast === 'function') {
        showToast('Training model: epoch ${epoch}${lossText}${detail ? ' — ' + detail : ''}', 'info', 'top-end', 0)
      }
    `,
  ]
  sessions.forEach(session => {
    if (session.url?.startsWith('/similar-images')) {
      session.ws.send(message)
    }
  })
}

function broadcastTrainingDone(
  project_id: number,
  result: {
    rankingAccuracy: number | null
    classificationAccuracy: number | null
    bestEpoch: number
  },
) {
  let parts: string[] = []
  if (result.rankingAccuracy != null) {
    parts.push(`ranking ${(result.rankingAccuracy * 100).toFixed(1)}%`)
  }
  if (result.classificationAccuracy != null) {
    parts.push(`relation ${(result.classificationAccuracy * 100).toFixed(1)}%`)
  }
  let accuracy = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  let message: ServerMessage = [
    'eval',
    /* javascript */ `
      if (typeof showToast === 'function') {
        showToast('Model trained${accuracy}', 'success')
      }
      if (typeof findSimilarPairs === 'function') findSimilarPairs()
    `,
  ]
  sessions.forEach(session => {
    if (session.url?.startsWith('/similar-images')) {
      session.ws.send(message)
    }
  })
}

/**
 * Load the similarity model of a project into the cache, so the
 * (synchronous) pair search can use it.
 */
async function PreloadScorerApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let scorer = await preloadProjectScorer({ project_id })
    return { ok: true, mode: scorer.mode }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

/**
 * Switch the scoring mode of a project: 'relation' (the trained model,
 * the default) or 'weighted' (the original per-dimension weight).
 */
/**
 * Switch which version of the page is shown: the new one (the trained
 * model plus the triplet annotation) or the legacy one (the weighted
 * cosine plus the pair ranking only).
 */
async function SetUiVersionApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let version = String(req.query.version || 'new')
    if (version !== 'new' && version !== 'legacy') {
      return { error: 'unknown version: ' + version }
    }
    setUiVersion({ project_id, version })

    // the legacy version ranks the pairs with the weighted cosine
    if (version === 'legacy') {
      setSimilarityMode({ project_id, mode: 'weighted' })
    }
    await preloadProjectScorer({ project_id })

    return { ok: true, version }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

async function SetSimilarityModeApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let mode = String(req.query.mode || 'relation')
    if (mode !== 'relation' && mode !== 'weighted') {
      return { error: 'unknown mode: ' + mode }
    }
    setSimilarityMode({ project_id, mode })

    // rebuild the scorers so the new mode takes effect right away
    await preloadProjectScorer({ project_id, mode })

    return { ok: true, mode }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

// ---------------------------------------------------------------------------
// triplet relation annotation
// ---------------------------------------------------------------------------

/**
 * Suggest a triplet for the user to annotate: two images the current
 * scorer considers similar plus a third one that is further away.
 */
async function GetTripletApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let scorer = getPreloadedScorer(project_id)
    let triplet = suggestTriplet({
      project_id,
      scorer: scorer ?? undefined,
    })
    if (!triplet) {
      return { error: 'Not enough images with embeddings to build a triplet' }
    }

    return {
      ok: true,
      triplet: {
        image_a_id: triplet.image_a_id,
        filename_a: proxy.image[triplet.image_a_id]?.filename ?? '',
        image_b_id: triplet.image_b_id,
        filename_b: proxy.image[triplet.image_b_id]?.filename ?? '',
        image_c_id: triplet.image_c_id,
        filename_c: proxy.image[triplet.image_c_id]?.filename ?? '',
      },
      count: countTriplets(project_id),
    }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

/**
 * Suggest a batch of triplets to annotate.
 */
async function GetTripletsApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let count = Math.min(+req.query.count! || 4, 12)
    let scorer = getPreloadedScorer(project_id)
    let triplets = suggestTripletBatch({
      project_id,
      count,
      scorer: scorer ?? undefined,
    })

    return {
      ok: true,
      triplets: triplets.map(triplet => ({
        image_a_id: triplet.image_a_id,
        filename_a: proxy.image[triplet.image_a_id]?.filename ?? '',
        image_b_id: triplet.image_b_id,
        filename_b: proxy.image[triplet.image_b_id]?.filename ?? '',
        image_c_id: triplet.image_c_id,
        filename_c: proxy.image[triplet.image_c_id]?.filename ?? '',
      })),
      count: countTriplets(project_id),
    }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

/**
 * Save the user's answer: which two of the three images are the most
 * similar (or that all three are equally similar).
 */
async function AnswerTripletApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'

    let body = getContextFormBody(context)
    let input = tripletAnswerParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    // the three images must be distinct and belong to the project
    let ids = [input.image_a_id, input.image_b_id, input.image_c_id]
    if (new Set(ids).size !== 3) throw 'The three images must be different'
    for (let image_id of ids) {
      let image = proxy.image[image_id]
      if (!image || image.project_id !== input.project_id) {
        throw 'Image not found in this project'
      }
    }

    seedRow(
      proxy.similar_triplet,
      {
        project_id: input.project_id,
        user_id: user.id!,
        image_a_id: input.image_a_id,
        image_b_id: input.image_b_id,
        image_c_id: input.image_c_id,
      },
      {
        relation: input.relation,
        created_at: Math.floor(Date.now() / 1000),
      },
    )

    return { ok: true, count: countTriplets(input.project_id) }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

/**
 * Train the relation classifier on the annotated triplets.
 */
async function TrainRelationClassifierApi(context: ExpressContext) {
  let { req } = context
  try {
    let user = getAuthUser(context)
    if (!user) throw 'not login'
    let project_id = +req.query.project!
    if (!project_id) throw 'missing project id in query'
    let project = proxy.project[project_id]
    if (!project) throw 'project not found'

    let result = await trainRelationClassifier({
      project_id,
      onProgress: (epoch, loss) => {
        broadcastTrainingProgress(project_id, epoch, loss)
      },
    })
    if (!result) {
      return {
        error:
          'Not enough triplet annotations. Answer at least 4 triplets first.',
      }
    }

    return {
      ok: true,
      accuracy: result.accuracy,
      loss: result.loss,
      epochs: result.epochs,
      count: result.count,
    }
  } catch (error) {
    console.error(error)
    return { error: String(error) }
  }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
let routes = {
  '/similar-images': {
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'Find the most similar image pairs across the dataset',
    node: page,
    layout_type: LayoutType.ionic,
  },
  '/similar-images/find-pairs': {
    title: apiEndpointTitle,
    description: 'Find the most similar image pairs across the dataset',
    node: <FindSimilarPairs />,
  },
  '/similar-images/rank': {
    title: apiEndpointTitle,
    description: 'save the user ordering of similar pairs',
    node: <PairRank />,
  },
  '/similar-images/train-weight': {
    title: apiEndpointTitle,
    description: 'train embedding weight from pair ranking feedback',
    node: <TrainSimilarWeight />,
  },
  '/similar-images/train-model': ajaxRoute({
    description: 'train the shared similarity model from pair ranking feedback',
    api: TrainRelationModelApi,
  }),
  '/similar-images/preload': ajaxRoute({
    description: 'load the similarity model of a project into the cache',
    api: PreloadScorerApi,
  }),
  '/similar-images/set-mode': ajaxRoute({
    description: 'switch the scoring mode of a project',
    api: SetSimilarityModeApi,
  }),
  '/similar-images/set-version': ajaxRoute({
    description: 'switch between the new and the legacy page version',
    api: SetUiVersionApi,
  }),
  '/similar-images/triplet': ajaxRoute({
    description: 'suggest a triplet of images to annotate',
    api: GetTripletApi,
  }),
  '/similar-images/triplets': ajaxRoute({
    description: 'suggest a batch of triplets to annotate',
    api: GetTripletsApi,
  }),
  '/similar-images/triplet-answer': ajaxRoute({
    description: 'save the relation answer of an annotated triplet',
    api: AnswerTripletApi,
  }),
  '/similar-images/train-relation': ajaxRoute({
    description: 'train the relation classifier on the annotated triplets',
    api: TrainRelationClassifierApi,
  }),
  '/similar-images/delete-image': {
    title: apiEndpointTitle,
    description: 'delete one image from the dataset',
    node: <DeleteImage />,
  },
  '/similar-images/compute-embeddings': ajaxRoute({
    description: 'compute embeddings for all images in a project',
    api: ComputeEmbeddings,
  }),
} satisfies Routes

export default { routes }
