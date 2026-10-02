import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import Style from '../components/style.js'
import { DynamicContext, ExpressContext } from '../context.js'
import { EarlyTerminate } from '../../exception.js'
import { mapArray } from '../components/fragment.js'
import { Link } from '../components/router.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { getAuthUser } from '../auth/user.js'
import { Locale, Title } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import {
  canViewProject,
  getContextProject,
} from '../context/project-context.js'
import { getLabelAnswerStats } from '../context/project-stats.js'
import { StatsChart, statsChartStyle } from '../components/stats-chart.js'
import { getDisplayName } from './profile.js'
import { title, apiEndpointTitle } from '../../config.js'
import {
  buildDatasetZip,
  getProjectImages,
  select_project_bounding_boxes_full,
  select_project_image_labels,
  select_project_labels_full,
} from './manage-dataset.js'

let pageTitle = (
  <Locale en="Public Dataset" zh_hk="公開數據集" zh_cn="公开数据集" />
)

let style = Style(/* css */ `
#PublicDataset {
}
.public-dataset-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0 1rem;
}
.public-dataset-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.75rem;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--ion-color-success, #2dd36f);
  color: white;
}
.public-dataset-download {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  padding: 4px 12px;
  border-radius: 10px;
  background: var(--ion-color-primary, #3880ff);
  color: white;
  text-decoration: none;
}
.public-dataset-download:hover {
  opacity: 0.9;
}
.public-dataset-meta {
  color: var(--ion-color-medium, #92949c);
  font-size: 0.9rem;
  padding: 0.25rem 1rem 0;
}
.public-dataset-section-title {
  font-size: 1.2rem;
  padding: 0.75rem 1rem 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.public-dataset-empty {
  text-align: center;
  color: var(--ion-color-medium, #92949c);
  padding: 1rem;
}
.public-dataset-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  padding: 0.5rem 1rem;
}
.public-dataset-images img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  display: block;
}
.public-dataset-report {
  padding: 0.5rem 1rem 1.5rem;
}
${statsChartStyle}
`)

// latest images of a project (excluding data: uris)
let select_public_sample_images = db.prepare<
  { project_id: number; limit: number },
  { id: number; filename: string; original_filename: null | string }
>(/* sql */ `
  select id, filename, original_filename from image
  where project_id = :project_id
    and filename is not null and filename not like 'data:image%'
  order by id desc limit :limit
`)

// sample images per label: latest-answer = yes, newest first
let select_public_label_samples = db.prepare<
  { label_id: number; project_id: number; limit: number },
  { image_id: number; filename: string }
>(/* sql */ `
  select il.image_id, image.filename
  from image_label il
  inner join image on image.id = il.image_id
  where il.label_id = :label_id and image.project_id = :project_id
    and il.id = (
      select max(il2.id) from image_label il2
      where il2.image_id = il.image_id and il2.label_id = il.label_id
    )
    and il.answer = 1
  order by il.image_id desc limit :limit
`)

function ImageGrid(attrs: { filenames: string[] }) {
  if (attrs.filenames.length === 0) {
    return (
      <p class="public-dataset-empty">
        <Locale en="No images yet" zh_hk="還沒有圖片" zh_cn="还没有图片" />
      </p>
    )
  }
  return (
    <div class="public-dataset-images">
      {mapArray(attrs.filenames, filename => (
        <img src={'/uploads/' + filename} loading="lazy" />
      ))}
    </div>
  )
}

function Main(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  let project = getContextProject(context)
  if (!project || !canViewProject(user, project)) return <NotFound />

  let project_id = project.id!
  let creator = proxy.user[project.creator_id]
  let labels = filter_labels.all({ project_id })
  let image_count = count_images.get({ project_id }) ?? 0
  let labelStats = getLabelAnswerStats(project_id, labels)
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )

  let latestFilenames = select_public_sample_images
    .all({ project_id, limit: 12 })
    .map(img => img.filename)

  let reportUrl =
    '/report-content?return_url=' +
    encodeURIComponent(`/dataset?project=${project_id}`) +
    '&return_title=' +
    encodeURIComponent(project.title)

  return (
    <>
      <div class="public-dataset-header">
        <h2>{project.title}</h2>
        <span class="public-dataset-badge">
          <ion-icon name="globe-outline"></ion-icon>
          <Locale en="Public" zh_hk="公開" zh_cn="公开" />
        </span>
        {image_count > 0 ? (
          <a
            class="public-dataset-download"
            href={`/dataset/download?project=${project_id}`}
          >
            <ion-icon name="download-outline"></ion-icon>{' '}
            <Locale en="Download" zh_hk="下載" zh_cn="下载" />
          </a>
        ) : null}
      </div>
      <p class="public-dataset-meta">
        <Locale en="by" zh_hk="建立者" zh_cn="建立者" />{' '}
        {creator ? getDisplayName(creator) : '-'} · {image_count}{' '}
        <Locale en="images" zh_hk="張圖片" zh_cn="张图片" /> · {labels.length}{' '}
        <Locale en="labels" zh_hk="個標籤" zh_cn="个标签" />
      </p>
      {!project.is_public ? (
        <p class="public-dataset-meta">
          <ion-icon name="lock-closed-outline" />{' '}
          <Locale
            en="This is a preview — the dataset is private."
            zh_hk="這是預覽 — 此數據集為私人。"
            zh_cn="这是预览 — 此数据集为私人。"
          />
        </p>
      ) : null}

      <h3 class="public-dataset-section-title">
        <ion-icon name="images-outline" />{' '}
        <Locale en="Latest Images" zh_hk="最新圖片" zh_cn="最新图片" />
      </h3>
      <ImageGrid filenames={latestFilenames} />

      <h3 class="public-dataset-section-title">
        <ion-icon name="stats-chart" />{' '}
        <Locale en="Labels" zh_hk="標籤" zh_cn="标签" />
      </h3>
      {sortedLabels.length === 0 ? (
        <p class="public-dataset-empty">
          <Locale en="No labels yet" zh_hk="還沒有標籤" zh_cn="还没有标签" />
        </p>
      ) : (
        mapArray(sortedLabels, label => {
          let label_id = label.id!
          let stats = labelStats.get(label_id) || {
            yes: 0,
            no: 0,
            unknown: 0,
          }
          return (
            <ion-card>
              <ion-card-content>
                <div class="stats-label">
                  <span>{label.title}</span>
                </div>
                <StatsChart
                  yes={stats.yes}
                  unknown={stats.unknown}
                  no={stats.no}
                />
              </ion-card-content>
            </ion-card>
          )
        })
      )}

      <h3 class="public-dataset-section-title">
        <ion-icon name="image-outline" />{' '}
        <Locale en="Label Samples" zh_hk="標籤樣本" zh_cn="标签样本" />
      </h3>
      {sortedLabels.length === 0
        ? null
        : mapArray(sortedLabels, label => {
            let label_id = label.id!
            let samples = select_public_label_samples
              .all({ label_id, project_id, limit: 4 })
              .map(row => row.filename)
            return (
              <div>
                <p class="public-dataset-meta">{label.title}</p>
                <ImageGrid filenames={samples} />
              </div>
            )
          })}

      <div class="public-dataset-report">
        <ion-icon name="flag-outline" />{' '}
        <Link href={reportUrl}>
          <Locale
            en="Report this dataset"
            zh_hk="檢舉此數據集"
            zh_cn="检举此数据集"
          />
        </Link>
      </div>
    </>
  )
}

let filter_labels = db.prepare<
  { project_id: number },
  {
    id: number
    title: string
    dependency_id: null | number
    display_order: null | number
  }
>(/* sql */ `
  select id, title, dependency_id, display_order
  from label
  where project_id = :project_id
  order by display_order asc
`)

let count_images = db
  .prepare<{ project_id: number }, number>(
    /* sql */ `
    select count(*) from image
    where project_id = :project_id
      and filename is not null and filename not like 'data:image%'
  `,
  )
  .pluck()

function NotFound(attrs: {}) {
  return (
    <div style="margin: auto; width: fit-content; text-align: center;">
      <div class="ion-padding ion-margin error">
        <Locale
          en="Dataset not found"
          zh_hk="找不到數據集"
          zh_cn="找不到数据集"
        />
      </div>
      <Link href="/gallery">
        <Locale
          en="Browse Public Datasets"
          zh_hk="瀏覽公開數據集"
          zh_cn="浏览公开数据集"
        />
      </Link>
    </div>
  )
}

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/gallery" backText="Gallery" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="PublicDataset" class="ion-padding">
      <Main />
    </ion-content>
  </>
)

// ---------------------------------------------------------------------------
// public dataset download (YOLO detect zip, http streaming)
// ---------------------------------------------------------------------------

// rate limit: one concurrent build per project (the zip build is CPU and
// memory heavy — a 800-image project takes a few seconds and ~2x its size
// in memory). Later requests for the same project wait for the first one.
let buildingProjects = new Map<number, Promise<void>>()

async function DownloadDataset(context: ExpressContext) {
  let { res } = context
  try {
    let user = getAuthUser(context)
    let params = new URLSearchParams(context.routerMatch?.search)
    let project_id = +params.get('project')!
    if (!project_id) throw 'project is required'
    let project = proxy.project[project_id]
    // same visibility rule as the page: public -> anyone, private -> member
    if (!project || !canViewProject(user, project)) throw 'Dataset not found'

    // wait for an in-flight build of the same project
    let inflight = buildingProjects.get(project_id)
    if (inflight) await inflight

    let images = getProjectImages(project_id)
    if (images.length === 0) throw 'This dataset has no images to download'
    let labels = select_project_labels_full.all({ project_id })
    let imageLabels = select_project_image_labels.all({ project_id })
    let boxes = select_project_bounding_boxes_full.all({ project_id })

    let build = (async () => {
      let zipBuffer = buildDatasetZip({
        project,
        images,
        labels,
        imageLabels,
        boxes,
      })
      let filename = `dataset_${project_id}_${project.title.replace(/[^\w-]+/g, '_')}.zip`
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Content-Length', String(zipBuffer.length))
      res.end(zipBuffer)
    })()
    // track the build so concurrent downloads of the same project serialize
    let tracked = build
      .catch(error => {
        if (!res.headersSent) {
          res.status(500).json({ error: String(error) })
        } else {
          console.error('DownloadDataset: failed after headers sent', error)
        }
      })
      .finally(() => {
        buildingProjects.delete(project_id)
      })
    buildingProjects.set(
      project_id,
      tracked.then(() => undefined),
    )
    await build
  } catch (error) {
    if (error !== EarlyTerminate) {
      console.error('DownloadDataset Error:', error)
      if (!res.headersSent) {
        res.status(400).json({ error: String(error) })
      }
    }
  }
  throw EarlyTerminate
}

let routes = {
  '/dataset': {
    resolve(context) {
      let user = getAuthUser(context)
      let project = getContextProject(context)
      // missing or private (non-member) -> same not-found message, so the
      // existence of private projects is not leaked
      if (!project || !canViewProject(user, project)) {
        return {
          title: title('Dataset Not Found'),
          description: 'Public dataset not found',
          node: (
            <>
              {style}
              <ion-header>
                <ion-toolbar>
                  <IonBackButton href="/gallery" backText="Gallery" />
                  <ion-title role="heading" aria-level="1">
                    {pageTitle}
                  </ion-title>
                </ion-toolbar>
              </ion-header>
              <ion-content id="PublicDataset" class="ion-padding">
                <NotFound />
              </ion-content>
            </>
          ),
        }
      }
      return {
        title: title(project.title),
        description: `Public dataset: ${project.title} — browse images, labels and annotation stats`,
        node: page,
      }
    },
  },
  '/dataset/download': {
    title: apiEndpointTitle,
    description:
      'Download the whole dataset (YOLO detect format zip) of a public project',
    streaming: false,
    async resolve(context) {
      if (context.type != 'express') {
        throw new Error('this endpoint only supports http')
      }
      await DownloadDataset(context)
      throw EarlyTerminate
    },
  },
} satisfies Routes

export default { routes }
