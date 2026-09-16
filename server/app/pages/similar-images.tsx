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
import { object, id } from 'cast.ts'
import { showError } from '../components/error.js'
import { getAuthUser, getAuthUserId } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter } from 'better-sqlite3-proxy'
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
})

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
          {mapArray(results, item => (
            <div class="similar-pair">
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
              <div class="similar-score">{(item.score * 100).toFixed(1)}%</div>
            </div>
          ))}
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
  '/similar-images/compute-embeddings': ajaxRoute({
    description: 'compute embeddings for all images in a project',
    api: ComputeEmbeddings,
  }),
} satisfies Routes

export default { routes }
