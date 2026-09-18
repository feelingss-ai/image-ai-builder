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
import { array, id, object, optional } from 'cast.ts'
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
import { getContextProject } from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { env } from '../../env.js'
import { join } from 'path'
import { promises as fsPromises } from 'fs'
import {
  findTopSimilarPairs,
  ensureProjectEmbeddings,
  deriveWeightFromFeedbackGA,
  saveEmbeddingWeight,
  invalidateProjectVectorCache,
  EMBEDDING_MODEL_VERSION,
} from '../embedding.js'

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

// run once on mount — defer until the client bundle defines emit()
// (on a full page load the inline script runs before the bundle loads)
function initSimilarImages() {
  if (typeof emit !== 'function') {
    setTimeout(initSimilarImages, 100);
    return;
  }
  bindTopKSelect();
  if (!getProjectId()) return;
  // if some images have no embedding yet, compute them first — the
  // server endpoint broadcasts progress and findSimilarPairs() runs
  // automatically when done (see computeEmbeddings)
  const hint = document.getElementById('embedHint');
  if (hint) {
    computeEmbeddings();
  } else {
    findSimilarPairs();
  }
}
initSimilarImages();

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

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />

  // fresh projects (esp. bulk imports) have images without embeddings;
  // the client auto-computes them on mount (see initSimilarImages) and
  // then loads the pairs — the banner tells the user what is happening
  let missingEmbeddings =
    count_missing_embeddings.get({
      project_id: project.id!,
      model_version: EMBEDDING_MODEL_VERSION,
    }) ?? 0

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
    </>
  )
}

let findPairsParser = object({
  project_id: id(),
  k: optional(id()),
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
    // automatically refresh the pairs list with the newly trained weight
    let results = findTopSimilarPairs({
      project_id,
      k: input.k ?? 5,
    })
    sendSimilarPairs(results, context)
    context.ws.send([
      'eval',
      `if (typeof showToast === 'function')
         showToast('AI trained from your ranking (GA, ${elapsedMs}ms) — list refreshed', 'success')`,
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

    let results = findTopSimilarPairs({ project_id, k: input.k ?? 5 })
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
                <div class="similar-score">
                  {(item.score * 100).toFixed(1)}%
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
