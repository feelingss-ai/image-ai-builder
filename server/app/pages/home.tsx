import { o } from '../jsx/jsx.js'
import { prerender } from '../jsx/html.js'
import { ResolvedPageRoute, Routes } from '../routes.js'
import { title, LayoutType } from '../../config.js'
import Style from '../components/style.js'
import { Locale, LocaleVariants } from '../components/locale.js'
import { Context } from '../context.js'
import { getAuthUser } from '../auth/user.js'
import { Redirect } from '../components/router.js'
import { PickLanguage } from '../components/ui-language.js'

let style = Style(/* css */ `
#landing {
  --background: linear-gradient(135deg, #4a0080 0%, #6706ce 50%, #8d55fc 100%);
  --color: #fff;
}

#landing .landing-inner {
  --primary: #6706ce;
  --primary-light: #c9a3ff;
  min-height: 100%;
  color: #fff !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
}

#landing .landing-hero {
  text-align: center;
  max-width: 600px;
  margin-bottom: 40px;
}

#landing .landing-hero h1 {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 12px;
  line-height: 1.3;
  color: #fff !important;
}

#landing .landing-hero p {
  font-size: 18px;
  opacity: 0.9;
  line-height: 1.6;
  margin-bottom: 24px;
  color: #fff !important;
}

#landing .landing-cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

#landing .cta-btn {
  display: inline-block;
  padding: 12px 28px;
  border-radius: 100px;
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
  transition: transform 0.2s, box-shadow 0.2s;
}

#landing .cta-btn.primary {
  background: #ffc300;
  color: #1a1a1a;
}

#landing .cta-btn.primary:hover {
  transform: scale(1.03);
  box-shadow: 0 6px 20px rgba(0,0,0,0.2);
}

#landing .cta-btn.secondary {
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: 1.5px solid rgba(255,255,255,0.35);
}

#landing .cta-btn.secondary:hover {
  background: rgba(255,255,255,0.25);
  transform: scale(1.03);
}

#landing .features {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: center;
  max-width: 900px;
  margin-bottom: 40px;
}

#landing .feature-card {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 260px;
  backdrop-filter: blur(4px);
}

#landing .feature-card .icon {
  font-size: 32px;
  margin-bottom: 12px;
}

#landing .feature-card h3 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

#landing .feature-card p {
  font-size: 14px;
  opacity: 0.85;
  line-height: 1.6;
  margin: 0;
}

#landing .landing-footer {
  text-align: center;
  opacity: 0.9;
  font-size: 14px;
  margin-top: auto;
}

#landing .landing-footer > div {
  margin-bottom: 12px;
  white-space: nowrap;
}

#landing .landing-footer a {
  color: #fff;
  text-decoration: none;
  white-space: nowrap;
}

#landing .landing-footer a button {
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 100px;
  color: #fff;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s;
}

#landing .landing-footer a button:hover {
  background: rgba(255,255,255,0.25);
}

@media (max-width: 600px) {
  #landing .landing-hero h1 {
    font-size: 26px;
  }
  #landing .feature-card {
    max-width: 100%;
  }
}
`)

function Landing(attrs: {}, context: Context) {
  return (
    <>
      {style}
      <ion-content id="landing" fullscreen>
        <div class="landing-inner">
          <div class="landing-hero">
            <h1>
              <Locale
                en="Build Custom AI Models in Your Browser"
                zh_hk="在瀏覽器中建構自訂 AI 模型"
                zh_cn="在浏览器中构建自定义 AI 模型"
              />
            </h1>
            <p>
              <Locale
                en="Upload your data, annotate with touch, train, and deploy — all in one low-code platform. No ML experience required."
                zh_hk="上傳數據、觸控標註、訓練並部署 — 一個低代碼平台完成所有步驟。無需機器學習經驗。"
                zh_cn="上传数据、触控标注、训练并部署 — 一个低代码平台完成所有步骤。无需机器学习经验。"
              />
            </p>
            <div class="landing-cta">
              <a href="/register" class="cta-btn primary">
                <Locale
                  en="Get Started Free"
                  zh_hk="免費開始"
                  zh_cn="免费开始"
                />
              </a>
              <a href="/login" class="cta-btn secondary">
                <Locale en="Login" zh_hk="登入" zh_cn="登录" />
              </a>
            </div>
          </div>

          <div class="features">
            <div class="feature-card">
              <div class="icon">📱</div>
              <h3>
                <Locale
                  en="Touch-Friendly Annotation"
                  zh_hk="觸控友善標註"
                  zh_cn="触控友好标注"
                />
              </h3>
              <p>
                <Locale
                  en="Pan, zoom, and rotate with touch screen on mobile or laptop. Draw bounding boxes with your finger."
                  zh_hk="在手機或筆記本上用觸控螢幕平移、縮放、旋轉。用手指繪製邊界框。"
                  zh_cn="在手机或笔记本上用触摸屏平移、缩放、旋转。用手指绘制边界框。"
                />
              </p>
            </div>

            <div class="feature-card">
              <div class="icon">🎯</div>
              <h3>
                <Locale
                  en="Train in Minutes"
                  zh_hk="幾分鐘內訓練"
                  zh_cn="几分钟内训练"
                />
              </h3>
              <p>
                <Locale
                  en="Upload your dataset, click train, and deploy. Models are ready in minutes — all in your browser."
                  zh_hk="上傳數據集，點擊訓練，然後部署。模型幾分鐘內就緒 — 全在瀏覽器中完成。"
                  zh_cn="上传数据集，点击训练，然后部署。模型几分钟内就绪 — 全在浏览器中完成。"
                />
              </p>
            </div>

            <div class="feature-card">
              <div class="icon">🚀</div>
              <h3>
                <Locale
                  en="Low-Code End to End"
                  zh_hk="端到端低代碼"
                  zh_cn="端到端低代码"
                />
              </h3>
              <p>
                <Locale
                  en="From data collection to model deployment — no ML experience required. The entire pipeline in one platform."
                  zh_hk="從數據收集到模型部署 — 無需機器學習經驗。整個流程在一個平台完成。"
                  zh_cn="从数据收集到模型部署 — 无需机器学习经验。整个流程在一个平台完成。"
                />
              </p>
            </div>
          </div>

        <div class="landing-footer">
          <PickLanguage style="margin-bottom: 12px;" />
          <Locale
            en="Made with 💝 by Feelings AI"
            zh_hk="由 Feelings AI 用💝製作"
            zh_cn="由 Feelings AI 用💝制作"
          />
        </div>
        </div>
      </ion-content>
    </>
  )
}

let route: LocaleVariants<ResolvedPageRoute> = {
  en: {
    title: title('Home'),
    description:
      'Build custom AI models in your browser — touch-friendly annotation, training, and deployment in one low-code platform',
    node: prerender(<Landing />, { language: 'en' }),
  },
  zh_hk: {
    title: title('主頁'),
    description:
      '在瀏覽器中建構自訂 AI 模型 — 觸控標註、訓練和部署，一個低代碼平台完成',
    node: prerender(<Landing />, { language: 'zh_hk' }),
  },
  zh_cn: {
    title: title('主页'),
    description:
      '在浏览器中构建自定义 AI 模型 — 触控标注、训练和部署，一个低代码平台完成',
    node: prerender(<Landing />, { language: 'zh_cn' }),
  },
}

let routes = {
  '/': {
    menuText: <Locale en="Home" zh_hk="主頁" zh_cn="主页" />,
    resolve(context) {
      let user = getAuthUser(context)
      if (user) {
        return <Redirect href="/app/project" />
      }
      return Locale(route, context)
    },
  },
} satisfies Routes

export default { routes }
