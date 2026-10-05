import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import Style from '../components/style.js'
import { DynamicContext } from '../context.js'
import { mapArray } from '../components/fragment.js'
import { Link } from '../components/router.js'
import { Locale, Title } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import { getDisplayName } from './profile.js'
import { getAuthUser } from '../auth/user.js'
import { IonButton } from '../components/ion-button.js'
import { IonBackButton } from '../components/ion-back-button.js'

let pageTitle = (
  <Locale en="Public Datasets" zh_hk="公開數據集" zh_cn="公开数据集" />
)

let style = Style(/* css */ `
#Gallery {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}
.gallery-hero {
  text-align: center;
  margin-bottom: 1.5rem;
}
.gallery-hero h1 {
  font-size: 1.8rem;
  margin-bottom: 0.25rem;
}
.gallery-hero p {
  color: var(--ion-color-medium, #92949c);
}
.gallery-search {
  display: flex;
  justify-content: center;
  margin-bottom: 1.5rem;
}
.gallery-search ion-searchbar {
  max-width: 560px;
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}
.gallery-card {
  display: block;
  border: 1px solid var(--ion-color-light-shade, #d7d8da);
  border-radius: 12px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  background: white;
  transition: transform 0.15s, box-shadow 0.15s;
}
.gallery-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}
.gallery-card--thumbs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  aspect-ratio: 3 / 1;
  background: var(--ion-color-light, #f4f5f8);
}
.gallery-card--thumbs img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gallery-card--thumbs .thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ion-color-medium, #92949c);
}
.gallery-card--body {
  padding: 0.6rem 0.8rem 0.8rem;
}
.gallery-card--title {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 0.15rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gallery-card--creator {
  font-size: 0.8rem;
  color: var(--ion-color-medium, #92949c);
  margin-bottom: 0.35rem;
}
.gallery-card--stats {
  font-size: 0.8rem;
  color: var(--ion-color-medium-shade, #737479);
}
.gallery-empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--ion-color-medium, #92949c);
}
.gallery-empty ion-icon {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}
`)

// thumbnails per project: newest 3 images (excluding data: uris)
let select_gallery_thumbnails = db.prepare<
  { project_id: number; limit: number },
  { filename: string }
>(/* sql */ `
  select filename from image
  where project_id = :project_id
    and filename is not null and filename not like 'data:image%'
  order by id desc limit :limit
`)

let count_project_images = db
  .prepare<{ project_id: number }, number>(
    /* sql */ `
    select count(*) from image
    where project_id = :project_id
      and filename is not null and filename not like 'data:image%'
  `,
  )
  .pluck()

let count_project_labels = db
  .prepare<{ project_id: number }, number>(
    /* sql */ `
    select count(*) from label where project_id = :project_id
  `,
  )
  .pluck()

// label titles of a project (for search)
let select_project_label_titles = db
  .prepare<{ project_id: number }, string>(
    /* sql */ `
    select title from label where project_id = :project_id
  `,
  )
  .pluck()

function GalleryCard(attrs: {
  project_id: number
  title: string
  creator_name: string
  image_count: number
  label_count: number
  thumbnails: string[]
}) {
  return (
    <Link href={`/dataset?project=${attrs.project_id}`} class="gallery-card">
      <div class="gallery-card--thumbs">
        {attrs.thumbnails.length === 0 ? (
          <div class="thumb-empty">
            <ion-icon name="images-outline"></ion-icon>
          </div>
        ) : (
          mapArray(attrs.thumbnails, filename => (
            <img src={'/uploads/' + filename} loading="lazy" />
          ))
        )}
      </div>
      <div class="gallery-card--body">
        <div class="gallery-card--title">{attrs.title}</div>
        <div class="gallery-card--creator">by {attrs.creator_name}</div>
        <div class="gallery-card--stats">
          {attrs.image_count}{' '}
          <Locale en="images" zh_hk="張圖片" zh_cn="张图片" /> ·{' '}
          {attrs.label_count}{' '}
          <Locale en="labels" zh_hk="個標籤" zh_cn="个标签" />
        </div>
      </div>
    </Link>
  )
}

function Main(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search || '')
  let q = (params.get('q') || '').trim().toLowerCase()
  let sort = params.get('sort') === 'images' ? 'images' : 'newest'

  // all public projects
  let projects = proxy.project.filter(p => p && p.is_public)

  // search: project title or any label title contains q
  if (q) {
    projects = projects.filter(project => {
      if (project.title.toLowerCase().includes(q)) return true
      let label_titles = select_project_label_titles.all({
        project_id: project.id!,
      })
      return label_titles.some(title => title.toLowerCase().includes(q))
    })
  }

  // sort: newest (id desc) or most images
  let cards = projects.map(project => {
    let project_id = project.id!
    let creator = proxy.user[project.creator_id]
    return {
      project_id,
      title: project.title,
      creator_name: creator ? getDisplayName(creator) : '-',
      image_count: count_project_images.get({ project_id }) ?? 0,
      label_count: count_project_labels.get({ project_id }) ?? 0,
      thumbnails: select_gallery_thumbnails
        .all({ project_id, limit: 3 })
        .map(row => row.filename),
    }
  })
  if (sort === 'images') {
    cards.sort((a, b) => b.image_count - a.image_count)
  } else {
    cards.sort((a, b) => b.project_id - a.project_id)
  }

  return (
    <>
      <div class="gallery-hero">
        <h1>{pageTitle}</h1>
        <p>
          <Locale
            en="Browse and search public datasets shared by the community"
            zh_hk="瀏覽和搜尋社群分享的公開數據集"
            zh_cn="浏览和搜索社区分享的公开数据集"
          />
        </p>
      </div>
      <form class="gallery-search" method="get" action="/gallery">
        <ion-searchbar
          name="q"
          value={params.get('q') || ''}
          placeholder={Locale(
            {
              en: 'Search by dataset or label name',
              zh_hk: '搜尋數據集或標籤名稱',
              zh_cn: '搜索数据集或标签名称',
            },
            context,
          )}
        ></ion-searchbar>
      </form>
      {cards.length === 0 ? (
        <div class="gallery-empty">
          <div>
            <ion-icon name="folder-open-outline"></ion-icon>
          </div>
          {q ? (
            <Locale
              en="No datasets match your search"
              zh_hk="沒有符合搜尋的數據集"
              zh_cn="没有符合搜索的数据集"
            />
          ) : (
            <Locale
              en="No public datasets yet"
              zh_hk="還沒有公開數據集"
              zh_cn="还没有公开数据集"
            />
          )}
        </div>
      ) : (
        <div class="gallery-grid">
          {mapArray(cards, card => (
            <GalleryCard
              project_id={card.project_id}
              title={card.title}
              creator_name={card.creator_name}
              image_count={card.image_count}
              label_count={card.label_count}
              thumbnails={card.thumbnails}
            />
          ))}
        </div>
      )}
    </>
  )
}

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar color="primary">
        <GalleryBackButton />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
        <GalleryToolbarExtra />
      </ion-toolbar>
    </ion-header>
    <ion-content id="Gallery" class="ion-padding">
      <Main />
    </ion-content>
  </>
)

// logged-in users get a back button to their project list; guests don't
// (there is nothing to go back to)
function GalleryBackButton(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return null
  return <IonBackButton href="/app/project" backText="Project" color="light" />
}

// admins get a Review button in the header to jump to the report review page
function GalleryToolbarExtra(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user?.is_admin) return null
  return (
    <ion-buttons slot="end">
      <IonButton url="/report-content/review">
        <ion-icon name="shield-checkmark-outline" slot="start"></ion-icon>
        <Locale en="Review" zh_hk="審查" zh_cn="审查" />
      </IonButton>
    </ion-buttons>
  )
}

let routes = {
  '/gallery': {
    title: <Title t={pageTitle} />,
    description:
      'Browse and search public datasets shared by the Image AI Builder community',
    node: page,
  },
} satisfies Routes

export default { routes }
