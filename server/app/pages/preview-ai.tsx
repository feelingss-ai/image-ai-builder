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

const read_models_by_id = (): string[] => {
  let models_dir = []
  for (let row of proxy.label) {
    models_dir.push('label-' + row.id)
  }
  return models_dir
}

let script = Script(/* js */ `

models_dir = window.models_dir

//avoid load model multiple times
window.modelCache ||= {}

function loadLabelModel(label_dir) {
  let url = '/saved_models/' + label_dir + '/model.json'
  window.modelCache[url] ||= loadTF().then(tf => tf.loadLayersModel(url))
  let p = window.modelCache[url]
  p.catch(err => {
    console.error('failed to load label model:', { url, err })
    delete window.modelCache[url]
  })
  return p
}

async function loadTF() {
  if (window.tf) return window.tf;
  return new Promise((resolve, reject) => {
    function loop() {
      if (window.tf) {
        resolve(window.tf)
      } else {
        console.log('waiting for tfjs')
        setTimeout(loop, 100)
      }
    }
    loop()
  })
}

document.querySelector('#webcamOutput').style.display = 'none';
document.querySelector('#image').style.display='none';

function pickPreviewPhoto() {
  document.querySelector('#previewPhotoInput').click();
  document.querySelector('#webcamOutput').style.display = 'none';
  document.querySelector('#image').style.display='block';
  stopRealtimeDetection();
  stopWebcam();
  document.querySelector('#webcamOutput').style.display = 'none';
  document.querySelector("#webcamBtnOff").style.display="none";
  document.querySelector("#webcamBtnOn").style.display="block";
  document.querySelectorAll("progress").forEach(progress => progress.value= "0")
}

document.querySelector('#previewPhotoInput').onchange = async function(event) {
  
  let file = event.target.files[0];
  if (!file) return;
  let reader = new FileReader();

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

      // prevent use tf before it is loaded
      let tf = await loadTF();
      // Create input tensor shaped [1, 1280]
      const inputTensor = tf.tensor2d(grayscaleData, [1, width * height]);

      for (let model_dir of models_dir) {
        let model = await loadLabelModel(model_dir);
        // Predict
        const prediction = model.predict(inputTensor);
        const probabilities = prediction.arraySync()[0];

      //console.log('Class probabilities:', probabilities);

      const classNames = ['yes', 'no'];
      const maxIndex = probabilities.indexOf(Math.max(...probabilities));
      const predictedClass = classNames[maxIndex];

      // console.log(model_dir + ": " + "Prediction: " + predictedClass + " confidence:" + (probabilities[maxIndex] * 100).toFixed(2));

      let label = "#" + model_dir

      //update label progress value
      document.querySelector(label).value =  (probabilities[0] * 100).toFixed(2) //0: yes 1: no

      // Dispose tensors to avoid memory leaks
      prediction.dispose && prediction.dispose();
      }
      inputTensor.dispose && inputTensor.dispose();
    }
  }
  reader.readAsDataURL(file);

  // Reset input so user can select the same file again if needed
  event.target.value = '';
}

var detectionLoopHandle = null;

shouldUpdateProgress = false;

async function startRealtimeDetection() {
  shouldUpdateProgress = true

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

  async function detectLoop() {
    if (video.readyState < 2) {
      detectionLoopHandle = requestAnimationFrame(detectLoop);
      return; // wait for camera to be ready
    }

    if (!shouldUpdateProgress) return;

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

      const classNames = ['yes', 'no'];
      const maxIndex = probabilities.indexOf(Math.max(...probabilities));
      const predictedClass = classNames[maxIndex];

      // console.log(model_dir + ' Prediction: ' + predictedClass + ' confidence:' + (probabilities[maxIndex] * 100).toFixed(2));

      let label = document.querySelector('#' + model_dir)
      if (!label) {
        // user returned to previous page
        stopWebcam();
        return;
      }
      if (shouldUpdateProgress) {
        label.value = (probabilities[0] * 100).toFixed(2);
      }

      // Dispose tensors to avoid memory leaks
      prediction.dispose && prediction.dispose();
    }
    inputTensor.dispose && inputTensor.dispose();

    // Run next frame
    detectionLoopHandle = requestAnimationFrame(detectLoop);
  }
  detectionLoopHandle = requestAnimationFrame(detectLoop);
}

// To stop detection when webcam is off:
function stopRealtimeDetection() {
  if (detectionLoopHandle) {
    cancelAnimationFrame(detectionLoopHandle);
    detectionLoopHandle = null;
  }
}

var currentStream = null;

function stopWebcam() {
    console.log('stopping webcam')
    shouldUpdateProgress = false;
    // Stop all tracks to turn off the webcam
    if (currentStream) {  
      currentStream.getTracks().forEach(track => track.stop());
    }
    // Optionally clear the video source
    const video = document.querySelector('video');
    if (video) {
      video.srcObject = null;
    }
    // Hide video
    currentStream = null;
}

async function toggleWebcam() {
  document.querySelector('#image').style.display='none';
  document.querySelector('#webcamOutput').style.display = 'block';
  document.querySelector("#webcamBtnOn").style.display="none";
  document.querySelector("#webcamBtnOff").style.display="block";

  if (currentStream) {
    stopWebcam();
    stopRealtimeDetection();
    document.querySelector('#webcamOutput').style.display = 'none';
    document.querySelector("#webcamBtnOff").style.display="none";
    document.querySelector("#webcamBtnOn").style.display="block";
    document.querySelectorAll("progress").forEach(progress => progress.value = 0)
  } else {
    try {
    console.log('starting')
    currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { preferred: "environment" } } });
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
    </ion-content>
    {/* pass models_dir to client */}
    <script>window.models_dir = {JSON.stringify(read_models_by_id())}</script>
    {script}
  </>
)

function Main(attrs: {}, context: Context) {
  let user = getAuthUser(context)
  if (!user) {
    return (
      <>
        <div style="margin: auto; width: fit-content; text-align: center;">
          <p class="ion-padding ion-margin error">
            <Locale
              en="You must be logged in to preview AI"
              zh_hk="您必須登入才能預覽 AI"
              zh_cn="您必须登录才能预览 AI"
            />
          </p>
          <ion-button color="primary" onclick='goto("/login")'>
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </ion-button>
        </div>
      </>
    )
  }
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
              <progress id={'label-' + label.id} value="0" max="100"></progress>
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
} satisfies Routes

export default { routes }
