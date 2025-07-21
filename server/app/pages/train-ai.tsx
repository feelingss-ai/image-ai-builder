import { o } from '../jsx/jsx.js'
import { Routes } from '../routes.js'
import { apiEndpointTitle, title } from '../../config.js'
import Style from '../components/style.js'
import {
  Context,
  DynamicContext,
  getContextFormBody,
  throwIfInAPI,
} from '../context.js'
import { mapArray } from '../components/fragment.js'
import { IonBackButton } from '../components/ion-back-button.js'
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
import { Label, proxy } from '../../../db/proxy.js'
import {
  modelsCache,
  datasetCache,
  CrayfishDatasetCache,
  OpenTailDatasetCache,
  RaiseClawDatasetCache,
} from 'image-dataset/dist/cache.js'
import { saveClassifierModelMetadata } from 'image-dataset/dist/model.js'
import { config } from 'image-dataset/dist/config.js'
import { db } from '../../../db/db.js'
import { baseModel, getClassifierModel } from '../model.js'
import { env } from '../../env.js'
import { join } from 'path'
import { tf } from 'tensorflow-helpers'
import { Logs } from '@tensorflow/tfjs-layers'

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

let script = Script(/* js */ `
// Learning Rate Elements
learning_rate = document.querySelector('#learning_rate'); 
learning_rate_input = document.querySelector('#learning_rate_input');

// Epoch Elements
epoch_no = document.querySelector('#epoch_no');
epoch_no_input = document.querySelector('#epoch_no_input');

//change default pin formatter from integer to float
learning_rate.pinFormatter = (value) => {
  // Format the value to 2 decimal places
  return value.toFixed(2);
}

//sync data of slider and input
learning_rate.addEventListener('ionChange', ({ detail }) => {
  learning_rate_input.value = detail.value
  learning_rate.pinFormatter = (value) => {
    // Format the value to 2 decimal places
    value = learning_rate.value
    return value.toFixed(2);
  }
});

//sync data of slider and input
learning_rate_input.addEventListener('ionChange', ({ detail }) => {
  learning_rate.value = detail.value
  learning_rate.pinFormatter = (value) => {
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
        <IonBackButton href="/" backText="Home" />
        <ion-title role="heading" aria-level="1">
          {pageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="TrainAI" class="ion-padding">
      <h2>
        <Locale
          en="Model Training Setting"
          zh_hk="模型訓練設定"
          zh_cn="模型训练设置"
        ></Locale>
      </h2>
      <Main />
    </ion-content>
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

//const MODEL_NO = count_model()
const MODEL_NO = 4

function Main(attrs: {}, context: Context) {
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
  let labels = pick(proxy.label, ['id', 'title'])
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
      label: `Model ${model.label_title} ${key}`,
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
        ></ion-input>
      </ion-item>
      <ion-item>
        <ion-label>
          <Locale en="Epoch to train:" zh_hk="訓練輪數:" zh_cn="训练轮数:" />
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
        ></ion-input>
      </ion-item>
      <ion-item>
        <ion-label>
          <Locale en="Training Mode:" zh_hk="訓練模式:" zh_cn="训练模式:" />
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
            <Locale en="Train from scratch" zh_hk="從頭訓練" zh_cn="从头训练" />
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
      <h2>
        <Locale
          en="Model Evaluation over Epoch"
          zh_hk="模型評估隨訓練輪數變化"
          zh_cn="模型评估随训练轮数变化"
        />
      </h2>
      <div id="demoMessage"></div>
      {ChartScript}
      <div style="width: 100%; max-height: 400px;">
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
      <div style="width: 100%; max-height: 400px;">
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
      <div style="width: 100%; max-height: 400px;">
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
      <div style="width: 100%; max-height: 400px;">
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
    </form>
  )
}

let submitTrainParser = object({
  learning_rate: float(),
  epoch_no: int(),
  training_mode: values(['continue' as const, 'scratch' as const]),
})

function SubmitTrain(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) throw 'You must be logged in to train AI'
  let body = getContextFormBody(context)
  let input = submitTrainParser.parse(body)
  if (input.training_mode === 'scratch') {
    del(proxy.training_stats, { id: notNull })
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
  async function trainModel(options: {
    label_index: number
    label: Label
    userID: number
    epochs: number
    learning_rate: number
    batchSize: number
    total_epochs: number
  }) {
    let { label, label_index } = options
    let label_id = label.id!
    let classifierModel = await getClassifierModel(label)
    let rows = select_image_filename_by_label.all({ label_id })
    let embeddings = []
    let answers = []
    let classCounts = [0, 0]
    for (let row of rows) {
      let file = join(env.UPLOAD_DIR, row.filename)
      let tensor = await baseModel.imageFileToEmbedding(file)
      embeddings.push(tensor)
      classCounts[row.answer]++
      answers.push(row.answer)
    }
    let x = tf.stack(embeddings)
    let y = tf.stack(answers)
    await classifierModel.train({
      x,
      y,
      initialEpoch: count_epoch_by_label.get({ label_id }) || 0,
      callbacks: [
        {
          onEpochEnd(epoch: number, logs?: Logs) {
            let accuracy = formatNumber(logs!.categoricalAccuracy)
            let loss = formatNumber(logs!.loss)
            let label = JSON.stringify(epoch + 1)
            broadcast([
              'eval',
              /* javascript */ `
train_loss_canvas.chart.data.labels[${epoch}] = ${label}
train_loss_canvas.chart.data.datasets[${label_index}].data[${epoch}] = ${loss};

train_accuracy_canvas.chart.data.labels[${epoch}] = ${label}
train_accuracy_canvas.chart.data.datasets[${label_index}].data[${epoch}] = ${accuracy};

train_loss_canvas.chart.update();
train_accuracy_canvas.chart.update();
`,
            ])
          },
        },
      ],
    })
    x.dispose()
    y.dispose()
  }
  let labels = pick(proxy.label, ['id', 'title', 'dependency_id'])
  for (let i = 0; i < labels.length; i++) {
    let label: Label = labels[i]
    trainModel({
      label_index: label['id']!,
      label: label,
      userID: user!.id!,
      epochs: input.epoch_no,
      learning_rate: input.learning_rate,
      batchSize: 32,
      total_epochs: 0,
    })
  }
  /*
  trainModel({
    label_index: 1,
    label: label,
    userID: user!.id!,
    epochs: input.epoch_no,
    learning_rate: input.learning_rate
  })
    */
  /*
  //get the last epoch number from training_stats table
  let epoch = proxy.training_stats.length + 1
  async function train() {
    let data: any[] = []
    let epochs = input.epoch_no
    //const total_epochs = proxy.training_stats.length + epochs
    const total_epochs = 20
    let batchSize = 32
    let loss = 0,
      accuracy = 0
    let val_loss = 0
    let val_accuracy = 0
    let originalData = await OriginalModelTrain(
      user!.id!,
      epochs,
      input.learning_rate,
      batchSize,
      total_epochs,
    )
    insertData(originalData, data)
    let crayfishData = await CrayfishModelTrain(
      user!.id!,
      epochs,
      input.learning_rate,
      batchSize,
      total_epochs,
    )
    insertData(crayfishData, data)
    let raiseClawData = await RaiseClawModelTrain(
      user!.id!,
      epochs,
      input.learning_rate,
      batchSize,
      total_epochs,
    )
    insertData(raiseClawData, data)
    let openTailData = await OpenTailModelTrain(
      user!.id!,
      epochs,
      input.learning_rate,
      batchSize,
      total_epochs,
    )
    insertData(openTailData, data)
    for (let i = 0; i < data.length; i++) {
      console.log
    }
  */

  //let code = /* javascript */ `
  /*
      const data = ${JSON.stringify(data)};
      const model_labels = ${JSON.stringify(model_labels())};
      train_loss_canvas.chart.data.labels.push('${epoch}');
      val_loss_canvas.chart.data.labels.push('${epoch}');
      train_accuracy_canvas.chart.data.labels.push('${epoch}');
      val_accuracy_canvas.chart.data.labels.push('${epoch}');

      // if training_stats is empty, set the chart data
      if (${proxy.training_stats.length === MODEL_NO}) { 
        train_loss_canvas.chart.data.labels = ['1']
        val_loss_canvas.chart.data.labels = ['1']
        train_accuracy_canvas.chart.data.labels = ['1']
        val_accuracy_canvas.chart.data.labels = ['1']
        for (let i = 1; i <= ${MODEL_NO}; i++) {
          train_loss_canvas.chart.data.datasets[i] = {label: 'Model ' + model_labels[i], data: []}
          val_loss_canvas.chart.data.datasets[i] = {label: 'Model ' + model_labels[i], data: []}
          train_accuracy_canvas.chart.data.datasets[i] = {label: 'Model ' + model_labels[i], data: []}
          val_accuracy_canvas.chart.data.datasets[i] = {label: 'Model ' + model_labels[i], data: []}
        }
      }
      
      for (let i = 0; i < data.length; i++) {
        console.log(i, ": ", data[i])
        //train_loss_canvas.chart.data.datasets[data[i].label].data.push(data[i].train_loss);
        train_loss_canvas.chart.data.datasets[data[i].label].data.push(0);
        val_loss_canvas.chart.data.datasets[data[i].label].data.push(data[i].val_loss);
        //train_accuracy_canvas.chart.data.datasets[data[i].label].data.push(data[i].train_accuracy);
        train_accuracy_canvas.chart.data.datasets[data[i].label].data.push(0);
        val_accuracy_canvas.chart.data.datasets[data[i].label].data.push(data[i].val_accuracy);
        train_loss_canvas.chart.update();
        val_loss_canvas.chart.update();
        train_accuracy_canvas.chart.update();
        val_accuracy_canvas.chart.update();
      } 
        `
        */
  //broadcast(['eval', code])
  //}

  //train()
  throw EarlyTerminate
}
//input: the data of a single model, output: the combined data of all model
function insertData(input: any, output: any) {
  for (let i = 0; i < input.length; i++) {
    output.push({
      epoch: input[i].epoch,
      label: input[i].label,
      train_loss: input[i].train_loss,
      val_loss: input[i].val_loss,
      train_accuracy: input[i].train_accuracy,
      val_accuracy: input[i].val_accuracy,
    })
  }
  return output
}

async function OriginalModelTrain(
  userID: number,
  epochs: number,
  learning_rate: number,
  batchSize: number,
  total_epochs: number,
) {
  let { classifierModel, metadata } = await modelsCache.get()
  let { x, y, classCounts } = await datasetCache.get()
  let loss = '',
    accuracy = ''
  let data: any = []
  let total_batches = Math.ceil(x.shape[0] / batchSize)
  console.log(`\nOriginal Model Training ${epochs} epochs...`)
  await classifierModel.train({
    x,
    y,
    classCounts,
    epochs,
    batchSize,
    verbose: 0,
    callbacks: [
      {
        onEpochBegin(epoch: number, logs: any) {
          process.stdout.write(
            `Epoch: ${epoch + 1}/${total_epochs}, Batch: 1/${total_batches}`,
          )
        },
        onBatchEnd: (batch: number, logs: any) => {
          accuracy = formatNumber(logs.categoricalAccuracy)
          loss = formatNumber(logs.loss)
          process.stdout.write(
            `\rEpoch: ${proxy.training_stats.length + 1}/${total_epochs}, Batch: ${batch + 1}/${total_batches}, Accuracy: ${accuracy}, Loss: ${loss}`,
          )
        },
        onEpochEnd: (epoch: number, logs: any) => {
          process.stdout.write(`\n`)
          const absoluteEpoch = proxy.training_stats.length + 1
          proxy.training_stats.push({
            user_id: userID,
            learning_rate: learning_rate,
            epoch: absoluteEpoch,
            train_loss: Number(loss),
            train_accuracy: Number(accuracy),
            val_loss: 0,
            val_accuracy: 0,
            label_id: 1,
          })
          data.push({
            epoch: epoch,
            label: 1,
            train_loss: loss,
            val_loss: 0,
            train_accuracy: accuracy,
            val_accuracy: 0,
          })
        },
      },
    ],
  })
  await classifierModel.save()
  await saveClassifierModelMetadata(config.classifierModelDir, metadata)
  return data
}

let select_image_filename_by_label = db.prepare<
  { label_id: number },
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

async function CrayfishModelTrain(
  userID: number,
  epochs: number,
  learning_rate: number,
  batchSize: number,
  total_epochs: number,
) {
  let { classifierModelCrayfish, metadata } = await modelsCache.get()
  let { x, y, classCounts } = await CrayfishDatasetCache.get()
  let loss = '',
    accuracy = ''
  let data: any = []
  let total_batches = Math.ceil(x.shape[0] / batchSize)
  console.log(`\nCrayfish Model Training ${epochs} epochs...`)
  await classifierModelCrayfish.train({
    x,
    y,
    classCounts,
    epochs,
    batchSize,
    verbose: 0,
    callbacks: [
      {
        onEpochBegin(epoch: number, logs: any) {
          process.stdout.write(
            `Epoch: ${epoch + 1}/${total_epochs}, Batch: 1/${total_batches}`,
          )
        },
        onBatchEnd: (batch: number, logs: any) => {
          accuracy = formatNumber(logs.categoricalAccuracy)
          loss = formatNumber(logs.loss)
          process.stdout.write(
            `\rEpoch: ${proxy.training_stats.length + 1}/${total_epochs}, Batch: ${batch + 1}/${total_batches}, Accuracy: ${accuracy}, Loss: ${loss}`,
          )
        },
        onEpochEnd: (epoch: number, logs: any) => {
          process.stdout.write(`\n`)
          const absoluteEpoch = proxy.training_stats.length + 1
          proxy.training_stats.push({
            user_id: userID,
            learning_rate: learning_rate,
            epoch: absoluteEpoch,
            train_loss: Number(loss),
            train_accuracy: Number(accuracy),
            val_loss: 0,
            val_accuracy: 0,
            label_id: 2,
          })
          data.push({
            epoch: epoch,
            label: 2,
            train_loss: loss,
            val_loss: 0,
            train_accuracy: accuracy,
            val_accuracy: 0,
          })
        },
      },
    ],
  })
  await classifierModelCrayfish.save()
  await saveClassifierModelMetadata(config.classifierModelCrayfishDir, metadata)
  return data
}

async function RaiseClawModelTrain(
  userID: number,
  epochs: number,
  learning_rate: number,
  batchSize: number,
  total_epochs: number,
) {
  let { classifierModelRaiseClaw, metadata } = await modelsCache.get()
  let { x, y, classCounts } = await RaiseClawDatasetCache.get()
  let loss = '',
    accuracy = ''
  let data: any = []
  let total_batches = Math.ceil(x.shape[0] / batchSize)
  console.log(`\nRaise Claw Model Training ${epochs} epochs...`)
  await classifierModelRaiseClaw.train({
    x,
    y,
    classCounts,
    epochs,
    batchSize,
    verbose: 0,
    callbacks: [
      {
        onEpochBegin(epoch: number, logs: any) {
          process.stdout.write(
            `Epoch: ${epoch + 1}/${total_epochs}, Batch: 1/${total_batches}`,
          )
        },
        onBatchEnd: (batch: number, logs: any) => {
          accuracy = formatNumber(logs.categoricalAccuracy)
          loss = formatNumber(logs.loss)
          process.stdout.write(
            `\rEpoch: ${proxy.training_stats.length + 1}/${total_epochs}, Batch: ${batch + 1}/${total_batches}, Accuracy: ${accuracy}, Loss: ${loss}`,
          )
        },
        onEpochEnd: (epoch: number, logs: any) => {
          process.stdout.write(`\n`)
          const absoluteEpoch = proxy.training_stats.length + 1
          proxy.training_stats.push({
            user_id: userID,
            learning_rate: learning_rate,
            epoch: absoluteEpoch,
            train_loss: Number(loss),
            train_accuracy: Number(accuracy),
            val_loss: 0,
            val_accuracy: 0,
            label_id: 3,
          })
          data.push({
            epoch: epoch,
            label: 3,
            train_loss: loss,
            val_loss: 0,
            train_accuracy: accuracy,
            val_accuracy: 0,
          })
        },
      },
    ],
  })
  await classifierModelRaiseClaw.save()

  await saveClassifierModelMetadata(
    config.classifierModelRaiseClawDir,
    metadata,
  )
  return data
}

async function OpenTailModelTrain(
  userID: number,
  epochs: number,
  learning_rate: number,
  batchSize: number,
  total_epochs: number,
) {
  let { classifierModelOpenTail, metadata } = await modelsCache.get()
  let { x, y, classCounts } = await OpenTailDatasetCache.get()
  let loss = '',
    accuracy = ''
  let data: any = []
  let total_batches = Math.ceil(x.shape[0] / batchSize)
  console.log(`\nOpen Tail Model Training ${epochs} epochs...`)
  await classifierModelOpenTail.train({
    x,
    y,
    classCounts,
    epochs,
    batchSize,
    verbose: 0,
    callbacks: [
      {
        onEpochBegin(epoch: number, logs: any) {
          process.stdout.write(
            `Epoch: ${epoch + 1}/${total_epochs}, Batch: 1/${total_batches}`,
          )
        },
        onBatchEnd: (batch: number, logs: any) => {
          accuracy = formatNumber(logs.categoricalAccuracy)
          loss = formatNumber(logs.loss)
          process.stdout.write(
            `\rEpoch: ${proxy.training_stats.length + 1}/${total_epochs}, Batch: ${batch + 1}/${total_batches}, Accuracy: ${accuracy}, Loss: ${loss}`,
          )
        },
        onEpochEnd: (epoch: number, logs: any) => {
          process.stdout.write(`\n`)
          const absoluteEpoch = proxy.training_stats.length + 1
          proxy.training_stats.push({
            user_id: userID,
            learning_rate: learning_rate,
            epoch: absoluteEpoch,
            train_loss: Number(loss),
            train_accuracy: Number(accuracy),
            val_loss: 0,
            val_accuracy: 0,
            label_id: 4,
          })
          data.push({
            epoch: epoch,
            label: 4,
            train_loss: loss,
            val_loss: 0,
            train_accuracy: accuracy,
            val_accuracy: 0,
          })
        },
      },
    ],
  })
  await classifierModelOpenTail.save()
  await saveClassifierModelMetadata(config.classifierModelOpenTailDir, metadata)
  return data
}

/*
          },
        },
      ],
    })
    await classifierModel.save()
    metadata.name = classifierModel.classNames[1]
    await saveClassifierModelMetadata(config.classifierModelDir, metadata)
  }

  train()
  throw EarlyTerminate
}
  */

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
  return x.toExponential(2)
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
