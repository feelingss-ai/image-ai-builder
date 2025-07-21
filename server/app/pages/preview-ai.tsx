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
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { evalLocale, Locale } from '../components/locale.js'
import { proxy } from '../../../db/proxy.js'
import { Script } from '../components/script.js'

let pageTitle = <Locale en="Preview AI" zh_hk="預覽 AI" zh_cn="预览 AI" />
let addPageTitle = (
  <Locale en="Add Preview AI" zh_hk="添加預覽 AI" zh_cn="添加预览 AI" />
)

let style = Style(/* css */ `
#PreviewAI .label-container {
  background-color: #fff9;
  padding: 0.25rem;
  border-radius: 0.25rem;
}
#PreviewAI .label-container progress {
  width: 5rem;
}
`)

let script = Script(/* js */ `

models_dir = ['classifier_model_crayfish','classifier_model_open_tail', 'classifier_model_raise_claw']

//avoid load model multiple times
window.modelCache ||= {}

function loadLabelModel(label_dir) {
  let url = '/saved_models/' + label_dir + '/model.json'
  window.modelCache[url] ||= tf.loadLayersModel(url)
  let p = window.modelCache[url]
  p.catch(err => {
    console.error('failed to load label model:', { url, err })
    delete window.modelCache[url]
  })
  return p
}

document.querySelector('#webcamOutput').style.display = 'none';
document.querySelector('#image').style.display='none';

function pickPreviewPhoto() {
document.querySelector('#previewPhotoInput').click();
document.querySelector('#webcamOutput').style.display = 'none';
document.querySelector('#image').style.display='block';
}

document.querySelector('#previewPhotoInput').onchange = async function(event) {
  
  let file = event.target.files[0];
  if (!file) return;
  let reader = new FileReader();

  for (let model_dir of models_dir) {
    let model = await loadLabelModel(model_dir); // 'label-id'

    reader.onload = function(e) {
      let image = document.querySelector('img');
      image.src = e.target.result;
      image.file = file;

      let img = new Image();
      img.src = e.target.result;

      img.onload = async function() {
        // 1. Resize image to 40x32 (width=40, height=32) to match input size 1280 = 40*32
        const width = 40;
        const height = 32;

        // Create a hidden canvas to draw the resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Draw resized image on canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Get pixel data - returns an Uint8ClampedArray with RGBA (4 values per pixel)
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Convert to grayscale and normalize
        const grayscaleData = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          // Simple grayscale: average of RGB
          grayscaleData[i] = (r + g + b) / 3 / 255;
        }

        // Create input tensor shaped [1, 1280]
        const inputTensor = tf.tensor2d(grayscaleData, [1, width * height]);

        // Predict
        const prediction = model.predict(inputTensor);
        const probabilities = prediction.arraySync()[0];

        console.log('Class probabilities:', probabilities);

        const classNames = ['no', 'yes'];
        const maxIndex = probabilities.indexOf(Math.max(...probabilities));
        const predictedClass = classNames[maxIndex];

        console.log(model_dir)
        console.log("Prediction: " + predictedClass + " confidence:" + (probabilities[maxIndex] * 100).toFixed(2));

        let label = ''

        switch (model_dir) {
          case 'classifier_model_crayfish':
            label = '#label-1'
            break;
          case 'classifier_model_open_tail':
            label = '#label-4'
            break;
          case 'classifier_model_raise_claw':
            label = '#label-5'
            break;
          default:
            break;
        }
        
        //update label progress value
        document.querySelector(label).value =  (probabilities[1] * 100).toFixed(2) //0: no 1: yes

        // Dispose tensors to avoid memory leaks
      prediction.dispose && prediction.dispose();
      };
    }
    reader.readAsDataURL(file);
  }

  // Reset input so user can select the same file again if needed
  event.target.value = '';
};

realtimeDetectionInterval = null;

async function startRealtimeDetection() {
  // Make sure models are loaded
  const models = {};
  for (let model_dir of models_dir) {
    models[model_dir] = await loadLabelModel(model_dir);
  }

  const video = document.querySelector('video');
  const width = 40, height = 32;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Clear any previous interval
  if (realtimeDetectionInterval) clearInterval(realtimeDetectionInterval);

  realtimeDetectionInterval = setInterval(async () => {
    if (video.readyState < 2) return; // Not enough data

    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, width, height);

    // Get pixel data
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Convert to grayscale and normalize
    const grayscaleData = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      grayscaleData[i] = (r + g + b) / 3 / 255;
    }

    // Create input tensor
    const inputTensor = tf.tensor2d(grayscaleData, [1, width * height]);

    // Predict for each model
    for (let model_dir of models_dir) {
      const model = models[model_dir];
      const prediction = model.predict(inputTensor);
      const probabilities = (await prediction.array())[0];

      const classNames = ['no', 'yes'];
      const maxIndex = probabilities.indexOf(Math.max(...probabilities));
      const predictedClass = classNames[maxIndex];

      console.log(model_dir);
      console.log("Prediction: " + predictedClass + " confidence:" + (probabilities[maxIndex] * 100).toFixed(2));

      let label = '';
      switch (model_dir) {
        case 'classifier_model_crayfish':
          label = '#label-1';
          break;
        case 'classifier_model_open_tail':
          label = '#label-4';
          break;
        case 'classifier_model_raise_claw':
          label = '#label-5';
          break;
        default:
          break;
      }
      document.querySelector(label).value = (probabilities[1] * 100).toFixed(2);

      // Dispose tensors to avoid memory leaks
      prediction.dispose && prediction.dispose();
    }
    inputTensor.dispose && inputTensor.dispose();
  }, 1000); // Run every 1s (adjust as needed)
}

// To stop detection when webcam is off:
function stopRealtimeDetection() {
  if (realtimeDetectionInterval) {
    clearInterval(realtimeDetectionInterval);
    realtimeDetectionInterval = null;
  }
}

currentStream = null;

async function toggleWebcam() {
  document.querySelector('#image').style.display='none';
  document.querySelector('#webcamOutput').style.display = 'block';
  document.querySelector("#webcamBtnOn").style.display="none";
  document.querySelector("#webcamBtnOff").style.display="block";

  if (currentStream) {
    console.log('stopping')
    // Stop all tracks to turn off the webcam
    currentStream.getTracks().forEach(track => track.stop());
    // Optionally clear the video source
    const video = document.querySelector('video');
    video.srcObject = null;
    // Hide video
    currentStream = null;
    stopRealtimeDetection();
    document.querySelector('#webcamOutput').style.display = 'none';
    document.querySelector("#webcamBtnOff").style.display="none";
    document.querySelector("#webcamBtnOn").style.display="block";
  } else {
    try {
    console.log('starting')
    currentStream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Attach the stream to a video element:
    const video = document.querySelector('video'); 
    video.srcObject = currentStream;
    video.play();
    startRealtimeDetection();
    return currentStream;
  } catch (err) {
    console.error('Webcam access denied or error:', err);
    }
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
    <ion-content id="PreviewAI" class="ion-no-padding">
      <Main />
      <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js"></script>
    </ion-content>
    {script}
  </>
)

let items = [
  { title: 'Android', slug: 'md' },
  { title: 'iOS', slug: 'ios' },
]

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  return (
    <>
      <div style="padding: 30px; display: flex; justify-content: center; margin-bottom: 1rem;">
        <div style="display: flex; flex-direction: row; gap: 3rem; align-items: center;">
          <ion-button onclick="pickPreviewPhoto()">
            <ion-icon name="image-outline" slot="start"></ion-icon>{' '}
            <Locale en="Select Photo" zh_hk="選擇照片" zh_cn="选择照片" />
          </ion-button>
          <ion-button id="webcamBtnOn" onclick="toggleWebcam()">
            <ion-icon name="camera-outline" slot="start"></ion-icon>{' '}
            <Locale en="Open Camera" zh_hk="開啟相機" zh_cn="开启相机" />
          </ion-button>
          <ion-button
            id="webcamBtnOff"
            onclick="toggleWebcam()"
            style="display: none;"
          >
            <ion-icon name="camera-outline" slot="start"></ion-icon>{' '}
            <Locale en="Close Camera" zh_hk="關閉相機" zh_cn="关闭相机" />
          </ion-button>
        </div>
      </div>
      <div style="position: relative; width: 100%; height: 100%;">
        {/* webcam output */}
        <div
          style="border-radius: 0.5rem; box-shadow: 0 2px 8px #0001; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;"
          id="webcamOutput"
        >
          <video
            id="webcamVideo align-items: center;"
            muted
            playsinline
          ></video>
          <canvas id="webcamCanvas"></canvas>
        </div>
        {/* placeholder to display user selected image */}
        <div
          id="image"
          style="border-radius: 0.5rem; box-shadow: 0 2px 8px #0001; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;"
        >
          <img width="100%" height="100%" style="object-fit: contain;" />
        </div>
        {/* labels */}
        <div style="position: absolute; right: 0; top: 0; display: flex; flex-direction: column; gap: 0.5rem; max-width: 40%;">
          {mapArray(proxy.label, label => (
            <div class="label-container">
              <div class="class-label">{label.title}</div>
              <progress
                id={'label-' + label.id}
                value="10"
                max="100"
              ></progress>
            </div>
          ))}
        </div>
        {/* upload image input */}
        <input
          type="file"
          id="previewPhotoInput"
          accept="image/*"
          style="display:none"
        />
      </div>
    </>
  )
}

let addPage = (
  <>
    {Style(/* css */ `
#AddPreviewAI .hint {
  margin-inline-start: 1rem;
  margin-block: 0.25rem;
}
`)}
    <ion-header>
      <ion-toolbar>
        <IonBackButton href="/preview-ai" backText={pageTitle} />
        <ion-title role="heading" aria-level="1">
          {addPageTitle}
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="AddPreviewAI" class="ion-padding">
      <form
        method="POST"
        action="/preview-ai/add/submit"
        onsubmit="emitForm(event)"
      >
        <ion-list>
          <ion-item>
            <ion-input
              name="title"
              label="Title*:"
              label-placement="floating"
              required
              minlength="3"
              maxlength="50"
            />
          </ion-item>
          <p class="hint">(3-50 characters)</p>
          <ion-item>
            <ion-input
              name="slug"
              label="Slug*: (unique url)"
              label-placement="floating"
              required
              pattern="(\w|-|\.){1,32}"
            />
          </ion-item>
          <p class="hint">
            (1-32 characters of: <code>a-z A-Z 0-9 - _ .</code>)
          </p>
        </ion-list>
        <div style="margin-inline-start: 1rem">
          <ion-button type="submit">Submit</ion-button>
        </div>
        <p>
          Remark:
          <br />
          *: mandatory fields
        </p>
        <p id="add-message"></p>
      </form>
    </ion-content>
  </>
)

function AddPage(attrs: {}, context: DynamicContext) {
  let user = getAuthUser(context)
  if (!user) return <Redirect href="/login" />
  return addPage
}

let submitParser = object({
  title: string({ minLength: 3, maxLength: 50 }),
  slug: string({ match: /^[\w-]{1,32}$/ }),
})

function Submit(attrs: {}, context: DynamicContext) {
  try {
    let user = getAuthUser(context)
    if (!user) throw 'You must be logged in to submit ' + pageTitle
    let body = getContextFormBody(context)
    let input = submitParser.parse(body)
    let id = items.push({
      title: input.title,
      slug: input.slug,
    })
    return <Redirect href={`/preview-ai/result?id=${id}`} />
  } catch (error) {
    throwIfInAPI(error, '#add-message', context)
    return (
      <Redirect
        href={
          '/preview-ai/result?' + new URLSearchParams({ error: String(error) })
        }
      />
    )
  }
}

function SubmitResult(attrs: {}, context: DynamicContext) {
  let params = new URLSearchParams(context.routerMatch?.search)
  let error = params.get('error')
  let id = params.get('id')
  return (
    <>
      <ion-header>
        <ion-toolbar>
          <IonBackButton href="/preview-ai/add" backText="Form" />
          <ion-title role="heading" aria-level="1">
            Submitted {pageTitle}
          </ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content id="AddPreviewAI" class="ion-padding">
        {error ? (
          renderError(error, context)
        ) : (
          <>
            <p>Your submission is received (#{id}).</p>
            <Link href="/preview-ai" tagName="ion-button">
              Back to {pageTitle}
            </Link>
          </>
        )}
      </ion-content>
    </>
  )
}

let routes = {
  '/preview-ai': {
    resolve(context) {
      let t = evalLocale(pageTitle, context)
      return {
        title: title(t),
        description: 'TODO',
        node: page,
      }
    },
  },
  '/preview-ai/add': {
    title: title(addPageTitle),
    description: 'TODO',
    node: <AddPage />,
    streaming: false,
  },
  '/preview-ai/add/submit': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <Submit />,
    streaming: false,
  },
  '/preview-ai/result': {
    title: apiEndpointTitle,
    description: 'TODO',
    node: <SubmitResult />,
    streaming: false,
  },
} satisfies Routes

export default { routes }
