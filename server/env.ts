import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { populateEnv, saveEnv } from 'populate-env'
import { loadEnvFile } from 'process'

function getEnvFile() {
  if (process.env.ENV_FILE) {
    return process.env.ENV_FILE
  }
  if (process.env.NODE_ENV && existsSync('.env.' + process.env.NODE_ENV)) {
    return '.env.' + process.env.NODE_ENV
  }
  if (existsSync('.env')) {
    return '.env'
  }
  return null
}
let envFile = getEnvFile()
if (envFile) {
  loadEnvFile(envFile)
}

export let env = {
  NODE_ENV: 'development' as 'development' | 'production',
  CADDY_PROXY: 'skip' as 'skip' | 'enable',
  PORT: 8100,
  COOKIE_SECRET: '',
  // optional: shared secret for signing dataset export zips (HMAC).
  // falls back to COOKIE_SECRET, which is machine-local — set this to
  // share signed datasets across servers
  // NOTE: must default to a non-empty placeholder because populateEnv
  // (mode: 'halt') exits when a value is missing/empty
  DATASET_SECRET: 'unset',
  // local vision language model (OpenAI-compatible endpoint) used by the
  // one-click auto label feature. Defaults match a local Ollama install;
  // for LM Studio use http://localhost:1234/v1 and the loaded model name
  VLM_BASE_URL: 'http://localhost:11434/v1',
  VLM_MODEL: 'minicpm-v4.6',
  VLM_API_KEY: 'no-api-key',
  EPOCH: 1, // to distinct initial run or restart in serve mode, auto-managed by dev.ts
  UPLOAD_DIR: 'uploads',
  ORIGIN: '',
  FIND_IP_API_KEY: 'skip', // Optional: API key for findip.net geolocation service
  EMAIL_SERVICE: 'google',
  EMAIL_HOST: 'smtp.gmail.com',
  EMAIL_PORT: 587,
  EMAIL_USER: '',
  EMAIL_PASSWORD: '',
  SMS_ACCOUNT_KEY: '',
  SMS_API_KEY: '',
}
applyDefaultEnv()

function applyDefaultEnv() {
  if (!process.env.COOKIE_SECRET) {
    env.COOKIE_SECRET = randomUUID()
    saveEnv({ env, key: 'COOKIE_SECRET' })
  }
  if (process.env.NODE_ENV === 'production') return
  let PORT = process.env.PORT || env.PORT
  env.ORIGIN ||= process.env.ORIGIN || `http://localhost:${PORT}`
  env.EMAIL_USER ||= process.env.EMAIL_USER || 'skip'
  env.EMAIL_PASSWORD ||= process.env.EMAIL_PASSWORD || 'skip'
  env.SMS_ACCOUNT_KEY ||= process.env.SMS_ACCOUNT_KEY || 'skip'
  env.SMS_API_KEY ||= process.env.SMS_API_KEY || 'skip'
}

populateEnv(env, { mode: 'halt' })

// fallback for the dataset signing secret: reuse the machine-local cookie
// secret unless a dedicated cross-server secret is configured
if (!env.DATASET_SECRET || env.DATASET_SECRET === 'unset') {
  env.DATASET_SECRET = env.COOKIE_SECRET
}

if (env.CADDY_PROXY.toLocaleLowerCase().startsWith('enable')) {
  env.CADDY_PROXY = 'enable'
} else {
  env.CADDY_PROXY = 'skip'
}

if (env.FIND_IP_API_KEY.toLocaleLowerCase() == 'skip') {
  env.FIND_IP_API_KEY = 'skip'
  console.warn('feat: FIND_IP_API_KEY not set, geolocation logging is disabled')
}
