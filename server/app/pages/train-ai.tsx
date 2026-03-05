import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
  getContextUrl,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
import { ProjectPageBackButton } from '../components/back-to-project-home-button.js'
import { float, int, object, string, values } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale, Title } from '../components/locale.js'
import { Script } from '../components/script.js'
import { Chart, ChartScript } from '../components/chart.js'
import { toRouteUrl } from '../../url.js'
import { EarlyTerminate } from '../../exception.js'
import { sessions } from '../session.js'
import { ServerMessage } from '../../../client/types.js'
import { sleep } from '@beenotung/tslib/async/wait.js'
import { del, filter, notNull, pick } from 'better-sqlite3-proxy'
import { Label, Project, proxy } from '../../../db/proxy.js'
import { db } from '../../../db/db.js'
import {
  baseModel,
  getClassifierModel,
  modelCheckpoint,
  compileModel,
  classifierModelCache,
} from '../model.js'
import { env } from '../../env.js'
import { join } from 'path'
import { tf } from 'tensorflow-helpers'
import { Logs } from '@tensorflow/tfjs-layers'
import { existsSync, rmSync } from 'fs'
import { scales } from 'chart.js'
import { log } from 'console'
import { text } from 'stream/consumers'

let pageTitle = (
  <Locale en="Train AI Model" zh_hk="訓練 AI 模型" zh_cn="训练 AI 模型" />
)

let style = Style(/* css */ `
#TrainAI {

}
ion-range::part(pin) { /*always show pin number*/
  bborder-radius: 50%;
  transform: scale(1.01);
  top: -20px;
}
`)
let project_id: number
let script = Script(/* js */ `
// Learning Rate Elements
learning_rate = document.querySelector('#learning_rate'); 
learning_rate_input = document.querySelector('#learning_rate_input');

// Epoch Elements
epoch_no = document.querySelector('#epoch_no');
epoch_no_input = document.querySelector('#epoch_no_input');

//Cross-Validation Elements
cross_validation_ratio = document.querySelector('#cross_validation_ratio');
cross_validation_ratio_input = document.querySelector('#cross_validation_ratio_input');

//Batch Size Elements
batch_size = document.querySelector('#batch_size');
batch_size_input = document.querySelector('#batch_size_input');

// Set the pinFormatter so the pin shows 2^value
batch_size.pinFormatter = value => Math.pow(2, value);

// Set the input to match the slider at start
batch_size_input.value = Math.pow(2, batch_size.value);

//change default pin formatter from integer to float
learning_rate.pinFormatter = (value) => {
  // Format the value to 2 decimal places
  return value.toFixed(2);
}

//sync data of slider and input
//sync data of slider and input
learning_rate.addEventListener('ionChange', ({ detail }) => {
  learning_rate_input.value = detail.value
  learning_rate.pinFormatter = (value) => {
    // Format the value to 2 decimal places
    value = learning_rate.value
    return value.toFixed(2);
  }
});

learning_rate_input.addEventListener('ionChange', ({ detail }) => {
  learning_rate.value = detail.value
  learning_rate.value = detail.value
  learning_rate.pinFormatter = (value) => {
    return learning_rate.value;
    return learning_rate.value;
  }
});

epoch_no.addEventListener('ionChange', ({ detail }) => {
  epoch_no_input.value = detail.value
  
  epoch_no.pinFormatter = (value) => {
    return epoch_no.value;
  }
});

epoch_no_input.addEventListener('ionChange', ({ detail }) => {
  epoch_no.value = detail.value
  epoch_no.pinFormatter = (value) => {
    return epoch_no.value;
  }
});

cross_validation_ratio.addEventListener('ionChange', ({ detail }) => {

  cross_validation_ratio_input.value = detail.value

  cross_validation_ratio.pinFormatter = (value) => {
    return cross_validation_ratio.value;
  }
})

cross_validation_ratio_input.addEventListener('ionChange', ({ detail }) => {
  cross_validation_ratio.value = detail.value
  cross_validation_ratio.pinFormatter = (value) => {
    return cross_validation_ratio.value;
  }
});

batch_size.addEventListener('ionChange', ({ detail }) => {
  const exp = parseInt(detail.value, 10);
  const batchValue = Math.pow(2, exp);
  batch_size_input.value = batchValue;
  
  batch_size.pinFormatter = (value) => {
    return batchValue;
  }
})

batch_size_input.addEventListener('ionChange', ({ detail }) => {
  const input = parseInt(detail.value, 10);
  const exp = Math.log2(input);
  batch_size.value = exp
  batch_size.pinFormatter = (value) => {
    return input;
  }
});

//ignore enter key to submit form
function cancelEnterSubmit(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
  }
}
`)

let page = (
  <>
    {style}
    <ion-header>
      <ion-toolbar>
        <ProjectPageBackButton />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <Main />
    {script}
  </>
)

const model_labels = () => {
  let model_labels = []
  for (let row of proxy.label) {
    model_labels.push(row.title)
  }
  return model_labels
}

//check how many models are there
const count_model = () => {
  let model_no = 0
  for (let row of proxy.label) {
    if (row.id && row.id > model_no) {
      model_no = row.id
    }
  }
  return model_no
}

const MODEL_NO = count_model()

function Main(attrs: {}, context: Context) {
  project_id = getProjectIDFromURL(context) as number
  let user = getAuthUser(context)
  //get data from training_stats table on database and group by label_id (support multiple models)
  let statsByModel: Record<
    number,
    {
      label_id: number
      label_title: string
      epochs: number[]
      train_loss: number[]
      val_loss: number[]
      train_accuracy: number[]
      val_accuracy: number[]
    }
  > = {}
  let labels = select_label_by_project.all({ project_id })
  for (let label of labels) {
    let rows = pick(
      proxy.training_stats,
      ['epoch', 'train_loss', 'val_loss', 'train_accuracy', 'val_accuracy'],
      { label_id: label.id! },
    )
    statsByModel[label.id!] = {
      label_id: label.id!,
      label_title: label.title,
      epochs: rows.map(row => row.epoch),
      train_loss: rows.map(row => row.train_loss),
      val_loss: rows.map(row => row.val_loss),
      train_accuracy: rows.map(row => row.train_accuracy),
      val_accuracy: rows.map(row => row.val_accuracy),
    }
  }

  //get datasets for chart drawing
  /* example
  data: [{label: 'Model (label.title) train_loss', data: [1, 2, 3]}, {label: 'Model (label.title) val_loss', data: [4, 5, 6]}]
  */
  function getDatasets(key: string) {
    return Object.values(statsByModel).map(model => ({
      label: `Model ${model.label_title}`,
      data: model[key as keyof typeof model] as number[],
    }))
  }
  //get epochs for chart drawing
  let chart_label: string[] = []
  const statsValues = Object.values(statsByModel)
  if (statsValues.length > 0) {
    chart_label = statsValues[0].epochs.map(epoch => epoch.toString())
  }

  return (
    <ion-content id="TrainAI" class="ion-padding">
      <ion-accordion-group>
        <ion-accordion value="train-ai-settings">
          <ion-item slot="header" style="--padding-start: 0">
            <h2>
              <Locale
                en="Model Training Setting"
                zh_hk="模型訓練設定"
                zh_cn="模型训练设置"
              ></Locale>
            </h2>
          </ion-item>
          <div slot="content">
            <form
              method="POST"
              action={toRouteUrl(routes, '/train-ai/train')}
              onsubmit="emitForm(event)"
            >
              <ion-item>
                <ion-label>
                  <Locale en="Learning Rate:" zh_hk="學習率:" zh_cn="学习率:" />
                </ion-label>
                {/* Learning Rate Slider */}
                <ion-range
                  id="learning_rate"
                  step="0.01"
                  pin
                  ticks
                  snaps
                  value="0.03"
                  min="0.01"
                  max="0.1"
                  aria-label="Custom range"
                ></ion-range>
                <ion-input
                  id="learning_rate_input"
                  name="learning_rate"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]+.?[0-9]*"
                  maxlength="10"
                  min="0"
                  style="width: 25%; font-size: 16px;"
                  placeholder="Numbers only"
                  value="0.03"
                  step="0.01"
                  onkeypress="cancelEnterSubmit(event)"
                  readonly
                ></ion-input>
              </ion-item>

              <ion-item>
                <ion-label>
                  <Locale
                    en="Cross-Validation Ratio:"
                    zh_hk="交叉驗證比率:"
                    zh_cn="交叉验证比率:"
                  />
                </ion-label>
                {/* Cross-Validation Slider */}
                <ion-range
                  id="cross_validation_ratio"
                  step="5"
                  pin
                  ticks
                  snaps
                  value="20"
                  min="0"
                  max="50"
                  aria-label="Custom range"
                ></ion-range>
                <ion-input
                  name="cross_validation_ratio"
                  id="cross_validation_ratio_input"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]+"
                  maxlength="10"
                  min="0"
                  style="width: 25%; font-size: 16px;"
                  placeholder="Numbers only"
                  value="20"
                  onkeypress="cancelEnterSubmit(event)"
                  readonly
                ></ion-input>
              </ion-item>

              <ion-item>
                <ion-label>
                  <Locale
                    en="Batch Size:"
                    zh_hk="批量大小:"
                    zh_cn="批量大小:"
                  />
                </ion-label>
                {/* Batch Size Slider */}
                <ion-range
                  id="batch_size"
                  step="1"
                  pin
                  ticks
                  snaps
                  value="5"
                  min="0"
                  max="11"
                  aria-label="Custom range"
                ></ion-range>
                <ion-input
                  name="batch_size"
                  id="batch_size_input"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]+"
                  maxlength="10"
                  min="1"
                  style="width: 25%; font-size: 16px;"
                  placeholder="Numbers only"
                  value="32"
                  onkeypress="cancelEnterSubmit(event)"
                  readonly
                ></ion-input>
              </ion-item>

              <ion-item>
                <ion-label>
                  <Locale
                    en="Epoch to train:"
                    zh_hk="訓練輪數:"
                    zh_cn="训练轮数:"
                  />
                </ion-label>
                {/* Epoch Slider */}
                <ion-range
                  id="epoch_no"
                  step="5"
                  pin
                  ticks
                  snaps
                  value="20"
                  min="0"
                  max="100"
                  aria-label="Custom range"
                ></ion-range>
                <ion-input
                  name="epoch_no"
                  id="epoch_no_input"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]+"
                  maxlength="10"
                  min="0"
                  style="width: 25%; font-size: 16px;"
                  placeholder="Numbers only"
                  value="20"
                  onkeypress="cancelEnterSubmit(event)"
                  readonly
                ></ion-input>
              </ion-item>

              <ion-item>
                <ion-label>
                  <Locale
                    en="Training Mode:"
                    zh_hk="訓練模式:"
                    zh_cn="训练模式:"
                  />
                </ion-label>
                <ion-select name="training_mode" value="continue">
                  <ion-select-option value="continue">
                    <Locale
                      en="Continue from previous training"
                      zh_hk="繼續上一次訓練"
                      zh_cn="继续上一次训练"
                    />
                  </ion-select-option>
                  <ion-select-option value="scratch">
                    <Locale
                      en="Train from scratch"
                      zh_hk="從頭訓練"
                      zh_cn="从头训练"
                    />
                  </ion-select-option>
                </ion-select>
              </ion-item>
              <br></br>
              {user ? (
                <ion-button type="submit">
                  {<Locale en="Train AI" zh_hk="訓練 AI" zh_cn="训练 AI" />}
                </ion-button>
              ) : (
                <p>
                  You can train ai after <Link href="/register">register</Link>.
                </p>
              )}
            </form>
          </div>
        </ion-accordion>
      </ion-accordion-group>
      <h2>
        <Locale
          en="Model Evaluation over Epoch"
          zh_hk="模型評估隨訓練輪數變化"
          zh_cn="模型评估随训练轮数变化"
        />
      </h2>
      <div id="demoMessage"></div>
      {ChartScript}
      <div style="width: 100%; max-height: 400px; margin-bottom: 40px;">
        <p>
          <Locale en="Train Loss" zh_hk="訓練損失" zh_cn="训练损失" />
        </p>
        <Chart
          canvas_id="train_loss_canvas"
          data_labels={chart_label}
          datasets={getDatasets('train_loss')}
          borderWidth={1}
          min={0}
        />
      </div>
      <div style="width: 100%; max-height: 400px; margin-bottom: 40px;">
        <p>
          <Locale en="Validation Loss" zh_hk="驗證損失" zh_cn="验证损失" />
        </p>
        <Chart
          canvas_id="val_loss_canvas"
          data_labels={chart_label}
          datasets={getDatasets('val_loss')}
          borderWidth={1}
          min={0}
        />
      </div>
      <div style="width: 100%; max-height: 400px; margin-bottom: 40px;">
        <p>
          <Locale en="Train Accuracy" zh_hk="訓練準確率" zh_cn="训练准确率" />
        </p>
        <Chart
          canvas_id="train_accuracy_canvas"
          data_labels={chart_label}
          datasets={getDatasets('train_accuracy')}
          borderWidth={1}
          min={0}
          max={1}
        />
      </div>
      <div style="width: 100%; max-height: 400px; margin-bottom: 40px;">
        <p>
          <Locale
            en="Validation Accuracy"
            zh_hk="驗證準確率"
            zh_cn="验证准确率"
          />
        </p>
        <Chart
          canvas_id="val_accuracy_canvas"
          data_labels={chart_label}
          datasets={getDatasets('val_accuracy')}
          borderWidth={1}
          min={0}
          max={1}
        />
      </div>
    </ion-content>
  )
}

let submitTrainParser = object({
  learning_rate: float(),
  cross_validation_ratio: float(),
  batch_size: int(),
  epoch_no: int(),
  training_mode: values(['continue' as const, 'scratch' as const]),
})

function SubmitTrain(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) throw 'You must be logged in to train AI'
  let body = getContextFormBody(context)
  let input = submitTrainParser.parse(body)
  let project_id = getProjectIDFromURL(context)
  let projectLabels = filter(proxy.label, { project_id })
  let labels = [...projectLabels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999)
  )

  if (input.training_mode === 'scratch') {
    del(proxy.training_stats, { id: notNull })

    for (let i = 0; i < labels.length; i++) {
      retrainModel(labels[i]!, project_id)
    }

    let code = /* javascript */ `
    train_loss_canvas.chart.data.labels = []
    val_loss_canvas.chart.data.labels = []
    train_accuracy_canvas.chart.data.labels = []
    val_accuracy_canvas.chart.data.labels = []
    for (let i = 0; i < ${MODEL_NO}; i++) {
      train_loss_canvas.chart.data.datasets[i].data = []
      val_loss_canvas.chart.data.datasets[i].data = []
      train_accuracy_canvas.chart.data.datasets[i].data = []
      val_accuracy_canvas.chart.data.datasets[i].data = []
    }
     train_loss_canvas.chart.update();
     val_loss_canvas.chart.update();
     train_accuracy_canvas.chart.update();
     val_accuracy_canvas.chart.update();           
      `
    broadcast(['eval', code])
  }

  for (let i = 0; i < labels.length; i++) {
    trainModel({
      label_index: labels[i]['id']!,
      label: labels[i],
      userID: user!.id!,
      epochs: input.epoch_no,
      learning_rate: input.learning_rate,
      batchSize: input.batch_size,
      cross_validation_ratio: input.cross_validation_ratio / 100,
      project_id: project_id,
    })
  }

  throw EarlyTerminate
}

let select_label_by_project = db.prepare<
  { project_id: number },
  {
    id: number
    title: string
  }
>(/*sql*/ `
  select
    label.id, 
    label.title
  from label
  where label.project_id = :project_id
  order by label.display_order asc, label.id asc
  `)

// For labels with dependency_id, only include images where the dependency is annotated positive (precondition met).
let select_image_filename_by_label = db.prepare<
  { label_id: number; dependency_id: null | number },
  {
    filename: string
    answer: 1 | 0
  }
>(/* sql */ `
select
  image.filename
, image_label.answer
from image_label
inner join image on image.id = image_label.image_id
where image_label.label_id = :label_id
and (
  :dependency_id is null
  or exists (
    select 1 from image_label il2
    where il2.image_id = image_label.image_id
    and il2.label_id = :dependency_id
    and il2.answer = 1
  )
)
`)

let count_epoch_by_label = db
  .prepare<{ label_id: number }, number>(
    /* sql */ `
select max(epoch)
from training_stats
where label_id = :label_id
`,
  )
  .pluck()

function broadcast(message: ServerMessage) {
  sessions.forEach(session => {
    if (session.url?.startsWith('/train-ai')) {
      session.ws.send(message)
    }
  })
}

function formatNumber(x: number) {
  if (x >= 1) {
    return x.toFixed(2)
  }
  if (x >= 0.1) {
    return x.toFixed(3)
  }
  if (x >= 0.01) {
    return x.toFixed(4)
  }
  return x.toExponential(3)
}

//Just delete the model to retrain
async function retrainModel(label: Label, project_id: number) {
  console.log(label)
  if (
    !existsSync(`saved_models/project-${project_id}/latest/label-${label.id}`)
  ) {
    return
  } else {
    rmSync(`saved_models/project-${project_id}/latest/label-${label.id}`, {
      recursive: true,
    })
    delete classifierModelCache[`project-${project_id}-${label.title}`]
  }

  if (
    !existsSync(`saved_models/project-${project_id}/best/label-${label.id}`)
  ) {
    return
  } else {
    rmSync(`saved_models/project-${project_id}/best/label-${label.id}`, {
      recursive: true,
    })
    delete classifierModelCache[`project-${project_id}-${label.title}-best`]
  }
}

async function trainModel(options: {
  label_index: number
  label: Label
  userID: number
  epochs: number
  learning_rate: number
  batchSize: number
  cross_validation_ratio: number
  project_id: number
}) {
  let {
    label,
    label_index,
    epochs,
    batchSize,
    cross_validation_ratio,
    learning_rate,
    project_id,
  } = options
  let label_id = label.id!
  let dependency_id = label.dependency_id ?? null
  let rows = select_image_filename_by_label.all({ label_id, dependency_id })
  if (rows.length === 0) {
    console.log('no images available for training', { project_id, label_id })
    return
  }
  let embeddings = []
  let answers = []
  let classCounts = [0, 0]
  let initialEpoch = count_epoch_by_label.get({ label_id }) || 0

  let classifierModel = await getClassifierModel(label, project_id) //The latest model

  for (let row of rows) {
    let file = join(env.UPLOAD_DIR, row.filename)
    let tensor = await baseModel.imageFileToEmbedding(file)
    embeddings.push(tensor)
    classCounts[row.answer]++
    answers.push(row.answer)
  }

  if (initialEpoch === 0) {
    shuffleInUnison(embeddings, answers)
  }

  const total = embeddings.length
  let valCount = Math.floor(total * cross_validation_ratio)
  if (total >= 2 && valCount == 0) {
    valCount = 1
  }
  const valEmbeddings = embeddings.slice(0, valCount)
  const valAnswers = answers.slice(0, valCount)
  const trainEmbeddings = embeddings.slice(valCount)
  const trainAnswers = answers.slice(valCount)
  let valX = tf.concat(valEmbeddings)
  let valY = tf.oneHot(valAnswers, 2)
  let x = tf.concat(trainEmbeddings)
  let y = tf.oneHot(trainAnswers, 2)

  for (let i = 0; i < epochs; i++) {
    compileModel(classifierModel, learning_rate)
    await classifierModel.train({
      x,
      y,
      initialEpoch: initialEpoch + i,
      validationData: [valX, valY],
      epochs: initialEpoch + i + 1,
      batchSize,
      shuffle: false,
      verbose: 0, //For logging training stats, 0 to disable, 1 to enable
      callbacks: [
        {
          onEpochEnd(epoch: number, logs?: Logs) {
            let accuracy = formatNumber(logs!.categoricalAccuracy)
            let loss = formatNumber(logs!.loss)
            let val_accuracy = formatNumber(logs!.val_categoricalAccuracy)
            let val_loss = formatNumber(logs!.val_loss)
            proxy.training_stats.push({
              user_id: options.userID,
              learning_rate: options.learning_rate,
              epoch: epoch + 1,
              train_loss: +loss,
              train_accuracy: +accuracy,
              val_loss: +val_loss,
              val_accuracy: +val_accuracy,
              label_id: label_id,
            })
            broadcast([
              'eval',
              /* javascript */ ` 
                train_loss_canvas.chart.data.labels[${epoch}] = ${epoch}+ 1
                train_loss_canvas.chart.data.datasets[${label_index} - 1].data[${epoch}] = ${loss};

                train_accuracy_canvas.chart.data.labels[${epoch}] = ${epoch} + 1
                train_accuracy_canvas.chart.data.datasets[${label_index} - 1].data[${epoch}] = +${accuracy};

                val_loss_canvas.chart.data.labels[${epoch}] = ${epoch}+ 1
                val_loss_canvas.chart.data.datasets[${label_index} - 1].data[${epoch}] = ${val_loss};

                val_accuracy_canvas.chart.data.labels[${epoch}] = ${epoch} + 1
                val_accuracy_canvas.chart.data.datasets[${label_index} - 1].data[${epoch}] = +${val_accuracy};


                train_loss_canvas.chart.update();
                train_accuracy_canvas.chart.update();
                val_accuracy_canvas.chart.update();
                val_loss_canvas.chart.update();
                `,
            ])
          },
        },
      ],
    })
    await classifierModel.save()
    await modelCheckpoint({ label, x: valX, y: valY, project_id })
  }
  x.dispose()
  y.dispose()
}

function shuffleInUnison(a: any, b: any) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
    ;[b[i], b[j]] = [b[j], b[i]]
  }
}

function getProjectIDFromURL(context: Context): number {
  let url = getContextUrl(context)
  const project_id = Number(url.split('project=')[1])
  return project_id
}

let routes = {
  '/train-ai': {
    title: <Title t={pageTitle} />,
    description: (
      <Locale
        en="View model training progress and submit training request"
        zh_hk="查看模型訓練進度及提交訓練請求"
        zh_cn="查看模型训练进度及提交训练请求"
      />
    ),
    node: page,
  },
  '/train-ai/train': {
    title: apiEndpointTitle,
    description:
      'Train the model with the given learning rate and epoch number',
    node: <SubmitTrain />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
