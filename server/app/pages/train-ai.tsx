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
import { del, notNull, pick } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { modelsCache, datasetCache } from 'image-dataset/dist/cache.js'
import { saveClassifierModelMetadata } from 'image-dataset/dist/model.js'
import { config } from 'image-dataset/dist/config.js'

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
// if no duplicate variable error, it should add 'let' before variable
learning_rate = document.querySelector('#learning_rate'); 
learning_rate_input = document.querySelector('#learning_rate_input');

// Epoch Elements
epoch_no = document.querySelector('#epoch_no');
epoch_no_input = document.querySelector('#epoch_no_input');

learning_rate.pinFormatter = (value) => {
  // Format the value to 2 decimal places
  return value.toFixed(2);
}

learning_rate.addEventListener('ionChange', ({ detail }) => {
  learning_rate_input.value = detail.value
});

learning_rate_input.addEventListener('ionChange', ({ detail }) => {
  learning_rate.pinFormatter = (value) => {
    return detail.value;
  }
  learning_rate.value = detail.value
});

epoch_no.addEventListener('ionChange', ({ detail }) => {
  
  epoch_no_input.value = detail.value
  
});

epoch_no_input.addEventListener('ionChange', ({ detail }) => {
  epoch_no.value = detail.value
  epoch_no.pinFormatter = (value) => {
    return detail.value;
  }
});

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

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)

  let rows = pick(proxy.training_stats, [
    'epoch',
    'train_loss',
    'val_loss',
    'train_accuracy',
    'val_accuracy',
  ])

  let chart_label = []

  let loss_chart_train_data = []
  let loss_chart_val_data = []

  let accuracy_chart_train_data = []
  let accuracy_chart_val_data = []

  for (let row of rows) {
    chart_label.push(row.epoch.toLocaleString())
    loss_chart_train_data.push(row.train_loss)
    loss_chart_val_data.push(row.val_loss)
    accuracy_chart_train_data.push(row.train_accuracy)
    accuracy_chart_val_data.push(row.val_accuracy)
  }

  return (
    <form
      method="POST"
      action={toRouteUrl(routes, '/train-ai/train')}
      onsubmit="emitForm(event)"
    >
      {/* <ion-list>
        {mapArray(items, item => (
          <ion-item>
            {item.title} ({item.slug})
          </ion-item>
        ))}
      </ion-list>
      {user ? (
        <Link href="/train-ai/add" tagName="ion-button">
          {addPageTitle}
        </Link>
      ) : (
        <p>
          You can add train ai after <Link href="/register">register</Link>.
        </p>
      )} */}
      <ion-item>
        <ion-label>
          <Locale en="Learning Rate:" zh_hk="學習率:" zh_cn="学习率:" />
        </ion-label>
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
        <Chart
          canvas_id="loss_canvas"
          data_labels={chart_label}
          datasets={[
            { label: 'Train Loss', data: loss_chart_train_data },
            { label: 'Val Loss', data: loss_chart_val_data },
          ]}
          borderWidth={1}
          min={0}
        />
      </div>
      <div style="width: 100%; max-height: 400px;">
        <Chart
          canvas_id="accuracy_canvas"
          data_labels={chart_label}
          datasets={[
            { label: 'Train Accuracy', data: accuracy_chart_train_data },
            { label: 'Val Accuracy', data: accuracy_chart_val_data },
          ]}
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
    loss_canvas.chart.data.labels = []
    loss_canvas.chart.data.datasets[0].data = []
    loss_canvas.chart.data.datasets[1].data = []
    loss_canvas.chart.update();

    accuracy_canvas.chart.data.labels = []
    accuracy_canvas.chart.data.datasets[0].data = []
    accuracy_canvas.chart.data.datasets[1].data = []
    accuracy_canvas.chart.update();
      `
    broadcast(['eval', code])
  }
  async function train() {
    let { classifierModel, metadata } = await modelsCache.get()
    let { x, y, classCounts } = await datasetCache.get()
    let epochs = input.epoch_no
    let total_epochs = proxy.training_stats.length + epochs
    let batchSize = 32
    let total_batches = Math.ceil(x.shape[0] / batchSize)
    let loss = '',
      accuracy = ''
    let val_loss = 0
    let val_accuracy = 0
    console.log(`\nTraining ${epochs} epochs...`)
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
              user_id: user!.id!,
              learning_rate: input.learning_rate,
              epoch: absoluteEpoch,
              train_loss: Number(loss),
              train_accuracy: Number(accuracy),
              val_loss,
              val_accuracy,
            })
            let code = /* javascript */ `
            loss_canvas.chart.data.labels.push('${absoluteEpoch}');
            loss_canvas.chart.data.datasets[0].data.push('${loss}');
            loss_canvas.chart.data.datasets[1].data.push('${val_loss}');
            loss_canvas.chart.update();

            accuracy_canvas.chart.data.labels.push('${absoluteEpoch}');
            accuracy_canvas.chart.data.datasets[0].data.push('${accuracy}');
            accuracy_canvas.chart.data.datasets[1].data.push('${val_accuracy}');
            accuracy_canvas.chart.update();
              `
            broadcast(['eval', code])
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
