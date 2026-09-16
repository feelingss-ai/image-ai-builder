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
import { array, id, object } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter, seedRow } from 'better-sqlite3-proxy'
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
import {
  findTopSimilarPairs,
  ensureProjectEmbeddings,
  deriveWeightFromFeedback,
  saveEmbeddingWeight,
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
}
.similar-toolbar ion-button {
  margin: 0;
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
.similar-pair .similar-score {
  font-size: 0.9rem;
  color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
  flex: 1;
  text-align: right;
}
.similar-confirm {
  margin-top: 0.75rem;
}
.similar-confirm ion-button {
  margin: 0;
}
/* confirmed state: highlight the pairs the user has confirmed */
.similar-pair.voted-yes {
  border-color: #28a745;
  box-shadow: inset 3px 0 0 #28a745;
}
.similar-pair.voted-no {
  border-color: #dc3545;
  box-shadow: inset 3px 0 0 #dc3545;
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
      if (typeof showToast === 'function') {
        showToast('Done: ' + json.embedded + ' embedded, ' + json.skipped + ' skipped', 'success');
      } else alert('Done: ' + json.embedded + ' embedded, ' + json.skipped + ' skipped');
      findSimilarPairs();
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('Error: ' + error, 'error');
    else alert('Error: ' + error);
  }
}

function findSimilarPairs() {
  const container = document.getElementById('similarPairs');
  if (container) {
    container.className = 'similar-hint';
    container.textContent = 'Searching...';
  }
  emit('/similar-images/find-pairs', {
    project_id: getProjectId(),
  });
}

// Moves a pair up/down in the displayed list (up = more similar).
// Reordering is local only — nothing is saved until the user clicks
// "Confirm Ranking", which persists the whole ordering at once.
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
  // refresh badges + button disabled states
  const rows = Array.from(parent.querySelectorAll('.similar-pair'));
  rows.forEach((item, index) => {
    const badge = item.querySelector('.rank-badge');
    if (badge) badge.textContent = String(index + 1);
    const up = item.querySelector('.rank-up');
    const down = item.querySelector('.rank-down');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
}

// Confirms the whole current ordering at once: saves every pair's rank
// (most similar first) as feedback used to train the AI weight.
function confirmRanking() {
  const container = document.getElementById('similarPairs');
  if (!container) return;
  const rows = container.querySelectorAll('.similar-pair');
  if (rows.length === 0) return;
  emit('/similar-images/rank', {
    project_id: getProjectId(),
    ordered_pairs: Array.from(rows).map(item => ({
      image_a_id: parseInt(item.dataset.imageAId),
      image_b_id: parseInt(item.dataset.imageBId),
    })),
  });
}

// Trains the AI weight from the saved pair ranking feedback.
function trainWeight() {
  if (typeof showToast === 'function') {
    showToast('Training AI from your ranking...', 'info', 'top-end', 0);
  }
  emit('/similar-images/train-weight', {
    project_id: getProjectId(),
  });
}

// run once on mount — defer until the client bundle defines emit()
// (on a full page load the inline script runs before the bundle loads)
function initSimilarImages() {
  if (typeof emit !== 'function') {
    setTimeout(initSimilarImages, 100);
    return;
  }
  if (getProjectId()) {
    findSimilarPairs();
  }
}
initSimilarImages();
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

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />

  return (
    <>
      <div class="similar-toolbar">
        <ion-button color="primary" onclick="findSimilarPairs()">
          <ion-icon name="search" slot="start"></ion-icon>
          <span>
            <Locale en="Find Similar" zh_hk="找相似" zh_cn="找相似" />
          </span>
        </ion-button>
        <ion-button color="medium" onclick="computeEmbeddings()">
          <ion-icon name="sparkles" slot="start"></ion-icon>
          <span>
            <Locale en="Compute Embeddings" zh_hk="計算向量" zh_cn="计算向量" />
          </span>
        </ion-button>
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
      <div class="similar-confirm">
        <ion-button color="success" onclick="confirmRanking()">
          <ion-icon name="checkmark-circle" slot="start"></ion-icon>
          <span>
            <Locale en="Confirm Ranking" zh_hk="確認排序" zh_cn="确认排序" />
          </span>
        </ion-button>
      </div>
    </>
  )
}

let findPairsParser = object({
  project_id: id(),
})

// Loads the user's existing votes for the given pairs (normalized a<b),
// keyed by "a:b" for quick lookup when rendering.
let select_pair_feedback = db.prepare<
  { user_id: number; project_id: number; pairs: string },
  { image_a_id: number; image_b_id: number; is_similar: number }
>(/* sql */ `
  select image_a_id, image_b_id, is_similar
  from similar_pair_feedback
  where user_id = :user_id
    and project_id = :project_id
    and (image_a_id || ':' || image_b_id) in (select value from json_each(:pairs))
`)

function getExistingVotes(options: {
  user_id: number
  project_id: number
  pairs: { image_a_id: number; image_b_id: number }[]
}): Map<string, number> {
  let { user_id, project_id, pairs } = options
  let normalized = pairs.map(p => ({
    a: Math.min(p.image_a_id, p.image_b_id),
    b: Math.max(p.image_a_id, p.image_b_id),
  }))
  let keys = normalized.map(p => p.a + ':' + p.b)
  let votes = new Map<string, number>()
  if (keys.length === 0) return votes
  let rows = select_pair_feedback.all({
    user_id,
    project_id,
    pairs: JSON.stringify(keys),
  })
  for (let row of rows) {
    votes.set(row.image_a_id + ':' + row.image_b_id, row.is_similar)
  }
  return votes
}

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

// Saves the user's ordering of the displayed pairs. The client sends the
// full list in display order (most similar first); each pair's rank is
// its index. Pairs not in the list keep their previous rank.
function PairRank(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'Login required'

    let body = getContextFormBody(context)
    let input = rankParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'

    for (let index = 0; index < input.ordered_pairs.length; index++) {
      let pair = input.ordered_pairs[index]!
      let image_a = proxy.image[pair.image_a_id]
      let image_b = proxy.image[pair.image_b_id]
      if (!image_a || !image_b) continue
      // normalize pair order so (A,B) and (B,A) are the same vote
      let a = Math.min(pair.image_a_id, pair.image_b_id)
      let b = Math.max(pair.image_a_id, pair.image_b_id)
      seedRow(
        proxy.similar_pair_feedback,
        {
          project_id: input.project_id,
          image_a_id: a,
          image_b_id: b,
          user_id: user.id!,
        },
        {
          is_similar: 1,
          rank: index,
          created_at: Math.floor(Date.now() / 1000),
        },
      )
    }

    // update the rank badges + mark every pair as confirmed
    let code = `
     document.querySelectorAll('#similarPairs .similar-pair').forEach((row, index) => {
       let badge = row.querySelector('.rank-badge')
       if (badge) badge.textContent = String(index + 1)
       row.classList.add('voted-yes')
     })
     if (typeof showToast === 'function') showToast('Ranking confirmed', 'success')`
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
})

// Trains the per-project embedding weight from the user's pair ranking
// feedback and saves it to embedding_weight (source='similar-feedback').
// The training itself is a fast contrastive approximation (no tfjs), so it
// runs synchronously here; the result applies to the next Find Similar.
function TrainSimilarWeight(attrs: {}, context: WsContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'Login required'

    let body = getContextFormBody(context)
    let input = trainWeightParser.parse(body)
    let project = proxy.project[input.project_id]
    if (!project) throw 'Project not found'
    let project_id = project.id!

    let weight = deriveWeightFromFeedback({ project_id })
    if (!weight) {
      context.ws.send([
        'eval',
        `if (typeof showToast === 'function')
           showToast('Need at least 2 confirmed pairs to train. Confirm a ranking first.', 'warning')`,
      ])
      throw EarlyTerminate
    }

    saveEmbeddingWeight({
      project_id,
      label_id: null,
      weight,
      source: 'similar-feedback',
    })

    context.ws.send([
      'eval',
      `if (typeof showToast === 'function')
         showToast('AI trained from your ranking! Click Find Similar to see the improved order.', 'success')`,
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

    let results = findTopSimilarPairs({ project_id, k: 5 })
    let votes = getExistingVotes({
      user_id,
      project_id,
      pairs: results.map(item => ({
        image_a_id: item.image_id_a,
        image_b_id: item.image_id_b,
      })),
    })
    sendSimilarPairs(results, votes, context)
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
  votes: Map<string, number>,
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
            // normalize pair order (same as the feedback handler) so the
            // data attributes match the vote lookup & the ws eval selector
            let a = Math.min(item.image_id_a, item.image_id_b)
            let b = Math.max(item.image_id_a, item.image_id_b)
            let vote = votes.get(a + ':' + b)
            let voted = vote === 0 || vote === 1
            return (
              <div
                class={
                  'similar-pair' +
                  (voted ? (vote === 1 ? ' voted-yes' : ' voted-no') : '')
                }
                data-image-a-id={a}
                data-image-b-id={b}
              >
                <img
                  src={`/uploads/${item.filename_a}`}
                  alt="a"
                  loading="lazy"
                  onclick={`window.open('/uploads/${item.filename_a}', '_blank')`}
                />
                <img
                  src={`/uploads/${item.filename_b}`}
                  alt="b"
                  loading="lazy"
                  onclick={`window.open('/uploads/${item.filename_b}', '_blank')`}
                />
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
  '/similar-images/compute-embeddings': ajaxRoute({
    description: 'compute embeddings for all images in a project',
    api: ComputeEmbeddings,
  }),
} satisfies Routes

export default { routes }
