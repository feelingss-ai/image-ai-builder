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
import { IonButton } from '../components/ion-button.js'
import { getContextProject } from '../context/project-context.js'
import { NoProjectMessage } from '../components/no-project-message.js'
import { ProjectPageBackButton } from '../components/project-page-back-button.js'
import { object, string } from 'cast.ts'
import { Link, Redirect } from '../components/router.js'
import { renderError } from '../components/error.js'
import { getAuthUser } from '../auth/user.js'
import { Locale, ProjectPageTitle } from '../components/locale.js'
import { filter } from 'better-sqlite3-proxy'
import { proxy } from '../../../db/proxy.js'
import { Script } from '../components/script.js'
import { db } from '../../../db/db.js'
import { loadClientPlugin } from '../../client-plugin.js'

let pageTitle = <Locale en="Preview AI" zh_hk="預覽 AI" zh_cn="预览 AI" />

let sweetAlertPlugin = loadClientPlugin({
  entryFile: 'dist/client/sweetalert.js',
})

let style = Style(/* css */ `
#PreviewAI .label-container {
  background-color: #fff9;
  padding: 0.25rem;
  border-radius: 0.25rem;
}
#PreviewAI .label-container progress {
  width: 5rem;
}
#PreviewAI #webcamOutput[data-mode='camera'] #webcamCanvas {
  display: none;
}
#PreviewAI #webcamOutput[data-mode='frozen'] #webcamVideo {
  display: none;
}
`)

let script = Script(/* js */ `
//avoid load model multiple times
window.modelCache ||= {}
window.baseModelCache = null

function loadLabelModel(modelPath) {
  let url = '/saved_models/' + modelPath + '/model.json'
  window.modelCache[url] ||= loadTF().then(tf => tf.loadLayersModel(url)).catch(err => {
    if (err && err.message && (err.message.includes('404') || err.message.includes('Not Found'))) {
      console.warn('Model not found (needs training):', url)
      if (typeof showToast === 'function') showToast('Model not found. Please go to Train AI page and train the model first.', 'warning')
    } else {
      console.error('failed to load label model:', { url, err })
    }
    delete window.modelCache[url]
    return null
  })
  return window.modelCache[url]
}

async function loadBaseModel() {
  if (window.baseModelCache) return window.baseModelCache
  let tf = await loadTF()
  let url = '/saved_models/mobilenet-v3-large-100/model.json'
  window.baseModelCache = tf.loadGraphModel(url).catch(err => {
    console.error('failed to load base model:', { url, err })
    window.baseModelCache = null
    throw err
  })
  return window.baseModelCache
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

// Convert an image/video element to a MobileNet embedding (1280-dim feature vector)
async function imageToEmbedding(tf, baseModel, imageSource) {
  // Resize to 224x224 (MobileNet input size) and convert to RGB tensor
  const width = 224
  const height = 224
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(imageSource, 0, 0, width, height)

  // Get pixel data as RGB tensor [1, 224, 224, 3], normalized to [0, 1]
  const pixels = tf.browser.fromPixels(canvas) // [224, 224, 3], uint8
  const normalized = pixels.toFloat().div(255) // normalize to [0, 1]
  const batched = normalized.expandDims(0) // [1, 224, 224, 3]

  // Run through MobileNet to get embedding [1, 1280]
  const embedding = baseModel.predict(batched)

  // Clean up intermediate tensors
  pixels.dispose()
  normalized.dispose()
  batched.dispose()

  return embedding // [1, 1280]
}

function showLoading(show) {
  let el = document.querySelector('#previewLoading')
  if (el) el.style.display = show ? 'block' : 'none'
}

document.querySelector('#webcamOutput').hidden = true;
document.querySelector('#image').hidden = true;

function pickPreviewPhoto() {
  document.querySelector('#previewPhotoInput').click();
  document.querySelector('#webcamOutput').hidden = true;
  document.querySelector('#image').hidden = false;
  stopRealtimeDetection();
  stopWebcam();
  document.querySelector("#webcamBtnOff").hidden = true;
  document.querySelector("#webcamBtnOn").hidden = false;
  document.querySelector("#cameraDirectionBtn").hidden = true;
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
      try {
      if (!modelInfos || modelInfos.length === 0) {
        console.warn('Preview: no models (open the page with ?project= from project home)');
        return;
      }

      showLoading(true)
      let tf = await loadTF();
      let baseModel = await loadBaseModel();

      // Extract MobileNet embedding from the image
      const embedding = await imageToEmbedding(tf, baseModel, img);

      let predictions = {};
      for (let modelInfo of modelInfos) {
        if (modelInfo.dependency_id != null) {
          let depProb = predictions[modelInfo.dependency_id];
          if (depProb == null || depProb < 0.5) {
            let labelEl = document.querySelector('#label-' + modelInfo.id);
            if (labelEl) labelEl.value = 0;
            continue;
          }
        }
        let model = await loadLabelModel(modelInfo.path);
        if (!model) {
          let labelEl = document.querySelector('#label-' + modelInfo.id);
          if (labelEl) labelEl.value = 0;
          continue;
        }
        const prediction = model.predict(embedding);
        // Apply softmax since the output layer uses 'linear' activation
        const softmax = tf.softmax(prediction);
        const probabilities = softmax.arraySync()[0];
        predictions[modelInfo.id] = probabilities[1];

        let labelEl = document.querySelector('#label-' + modelInfo.id);
        if (labelEl) labelEl.value = Math.round(probabilities[1] * 100);

        prediction.dispose && prediction.dispose();
        softmax.dispose && softmax.dispose();
      }
      embedding.dispose && embedding.dispose();
      } catch (err) {
        console.error('Preview prediction failed:', err);
      } finally {
        showLoading(false)
      }
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

  showLoading(true)
  try {
    let tf = await loadTF()
    let baseModel = await loadBaseModel()

    // Make sure models are loaded
    const models = {};
    for (let modelInfo of modelInfos) {
      let model = await loadLabelModel(modelInfo.path)
      if (!model) {
        if (typeof showToast === 'function') showToast('Model not found. Please train AI first.', 'warning')
        stopWebcam()
        showLoading(false)
        return
      }
      models[modelInfo.id] = model
    }
    showLoading(false)

    const video = document.querySelector('video');

    let predictions = {};
    async function detectLoop() {
      if (video.readyState < 2) {
        detectionLoopHandle = requestAnimationFrame(detectLoop);
        return; // wait for camera to be ready
      }

      if (!shouldUpdateProgress) return;

      try {
        // Extract MobileNet embedding from the video frame
        const embedding = await imageToEmbedding(tf, baseModel, video);

        for (let modelInfo of modelInfos) {
          let labelEl = document.querySelector('#label-' + modelInfo.id);
          if (!labelEl) {
            stopWebcam();
            return;
          }
          if (modelInfo.dependency_id != null) {
            let depProb = predictions[modelInfo.dependency_id];
            if (depProb == null || depProb < 0.5) {
              if (shouldUpdateProgress) labelEl.value = 0;
              continue;
            }
          }
          const model = models[modelInfo.id];
          if (!model) continue;
          const prediction = model.predict(embedding);
          // Apply softmax since the output layer uses 'linear' activation
          const softmax = tf.softmax(prediction);
          const probabilities = (await softmax.array())[0];
          predictions[modelInfo.id] = probabilities[1];
          if (shouldUpdateProgress) {
            labelEl.value = Math.round(probabilities[1] * 100);
          }
          prediction.dispose && prediction.dispose();
          softmax.dispose && softmax.dispose();
        }
        embedding.dispose && embedding.dispose();
      } catch (err) {
        console.error('Detection loop error:', err);
      }

      detectionLoopHandle = requestAnimationFrame(detectLoop);
    }
    detectionLoopHandle = requestAnimationFrame(detectLoop);
  } catch (err) {
    console.error('Failed to start detection:', err)
    showLoading(false)
  }
}

// To stop detection when webcam is off:
function stopRealtimeDetection() {
  if (detectionLoopHandle) {
    cancelAnimationFrame(detectionLoopHandle);
    detectionLoopHandle = null;
  }
}

var currentStream = null;
var facingMode = 'environment'; // 'environment' = back, 'user' = front

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
  document.querySelector('#image').hidden = true;
  document.querySelector('#webcamOutput').hidden = false;
  document.querySelector("#webcamBtnOn").hidden = true;
  document.querySelector("#webcamBtnOff").hidden = false;
  document.querySelector("#cameraDirectionBtn").hidden = false;

  if (currentStream) {
    // Freeze the last video frame onto the canvas before stopping the stream.
    let video = document.querySelector('video');
    let canvas = document.querySelector('canvas');
    if (video && canvas && video.readyState >= 2) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      let ctx = canvas.getContext('2d');
      // Preserve the selfie mirror (front camera) in the frozen frame.
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    stopWebcam();
    stopRealtimeDetection();
    // Show the frozen frame (canvas), hide the live video.
    document.querySelector('#webcamOutput').setAttribute('data-mode', 'frozen');
    document.querySelector("#webcamBtnOff").hidden = true;
    document.querySelector("#webcamBtnOn").hidden = false;
    document.querySelector("#cameraDirectionBtn").hidden = true;
  } else {
    try {
    console.log('starting')
    currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { preferred: facingMode } } });
    // Attach the stream to a video element:
    const video = document.querySelector('video'); 
    video.srcObject = currentStream;
    video.play();
    // Show the live video, hide the frozen frame.
    document.querySelector('#webcamOutput').setAttribute('data-mode', 'camera');
    // Mirror the video when using the front camera, like a selfie view.
    video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : '';
    startRealtimeDetection();
    return currentStream;
  } catch (err) {
    console.error('Webcam access denied or error:', err);
    }
  }
}

async function toggleCameraDirection() {
  // Switch between front (user) and back (environment) camera.
  facingMode = facingMode === 'user' ? 'environment' : 'user'
  // If the webcam is already open, restart it with the new direction.
  if (currentStream) {
    stopWebcam()
    stopRealtimeDetection()
    document.querySelector('#webcamOutput').hidden = false
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { preferred: facingMode } },
      })
      const video = document.querySelector('video')
      video.srcObject = currentStream
      video.play()
      // Mirror the video when using the front camera, like a selfie view.
      video.style.transform = facingMode === 'user' ? 'scaleX(-1)' : ''
      startRealtimeDetection()
    } catch (err) {
      console.error('Webcam switch error:', err)
    }
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
          <ProjectPageTitle t={pageTitle} short />
        </ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content id="PreviewAI" class="ion-no-padding">
      <Main />
    </ion-content>
    {sweetAlertPlugin.node}
    <PreviewScript />
    {script}
  </>
)

function PreviewScript(attrs: {}, context: DynamicContext) {
  let models = getModels(context)
  return <script>modelInfos = {JSON.stringify(models)}</script>
}

let select_project_label = db.prepare<
  { project_id: number },
  { id: number; dependency_id: null | number }
>(/* sql */ `
select
  id
, dependency_id
from label
where project_id = :project_id
order by display_order asc
`)

function getModels(
  context: DynamicContext,
): { path: string; id: number; dependency_id: null | number }[] {
  let project = getContextProject(context)
  if (!project) return []
  let project_id = project.id!
  return select_project_label.all({ project_id }).map(label => ({
    path: `project-${project_id}/best/label-${label.id}`,
    id: label.id,
    dependency_id: label.dependency_id,
  }))
}

function Main(attrs: {}, context: DynamicContext) {
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
          <IonButton url="/login" color="primary">
            <Locale en="Login" zh_hk="登入" zh_cn="登录" />
          </IonButton>
        </div>
      </>
    )
  }
  let project = getContextProject(context)
  if (!project) return <NoProjectMessage />
  let project_id = project.id!
  let labels = filter(proxy.label, { project_id })
  let sortedLabels = [...labels].sort(
    (a, b) => (a.display_order ?? 999999) - (b.display_order ?? 999999),
  )
  return (
    <>
      <div style="padding: 30px; display: flex; justify-content: center; margin-bottom: 1rem;">
        <div style="display: flex; flex-direction: row; gap: 0.5rem; align-items: center;">
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
            hidden
          >
            <ion-icon name="camera-outline" slot="start"></ion-icon>{' '}
            <Locale en="Close Camera" zh_hk="關閉相機" zh_cn="关闭相机" />
          </ion-button>
          <ion-button
            id="cameraDirectionBtn"
            onclick="toggleCameraDirection()"
            hidden
          >
            <ion-icon name="camera-reverse-outline" slot="start"></ion-icon>{' '}
            <Locale en="Flip Camera" zh_hk="切換鏡頭" zh_cn="切换镜头" />
          </ion-button>
        </div>
      </div>
      <div style="position: relative; width: 100%; height: 100%;">
        {/* loading indicator */}
        <div
          id="previewLoading"
          style="display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; background: rgba(0,0,0,0.6); color: white; padding: 1rem 2rem; border-radius: 0.5rem; font-size: 1rem;"
        >
          <Locale
            en="Loading AI model..."
            zh_hk="載入 AI 模型中..."
            zh_cn="加载 AI 模型中..."
          />
        </div>
        {/* webcam output */}
        <div
          style="border-radius: 0.5rem; box-shadow: 0 2px 8px #0001; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;"
          id="webcamOutput"
          data-mode="camera"
        >
          <video id="webcamVideo" muted playsinline style="width: 100%; height: 100%; object-fit: contain;"></video>
          <canvas id="webcamCanvas" style="width: 100%; height: 100%; object-fit: contain;"></canvas>
        </div>
        {/* placeholder to display user selected image */}
        <div
          id="image"
          style="border-radius: 0.5rem; box-shadow: 0 2px 8px #0001; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;"
        >
          <img width="100%" height="100%" style="object-fit: contain;" />
        </div>
        {/* labels - same project-scoped list as modelInfos so progress ids match */}
        <div style="position: absolute; right: 0; top: 0; display: flex; flex-direction: column; gap: 0.5rem; max-width: 40%;">
          {mapArray(sortedLabels, label => (
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
    title: <ProjectPageTitle t={pageTitle} />,
    description: 'TODO',
    node: page,
  },
} satisfies Routes

export default { routes }
