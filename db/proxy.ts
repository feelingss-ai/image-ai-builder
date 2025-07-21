import { proxySchema } from 'better-sqlite3-proxy'
import { db } from './db'

export type Method = {
  id?: null | number
  method: string
}

export type Url = {
  id?: null | number
  url: string
}

export type UaType = {
  id?: null | number
  name: string
  count: number
}

export type RequestSession = {
  id?: null | number
  language: null | string
  timezone: null | string
  timezone_offset: null | number
}

export type UaBot = {
  id?: null | number
  name: string
  count: number
}

export type UserAgent = {
  id?: null | number
  user_agent: string
  count: number
  ua_type_id: null | number
  ua_type?: UaType
  ua_bot_id: null | number
  ua_bot?: UaBot
}

export type UaStat = {
  id?: null | number
  last_request_log_id: number
}

export type User = {
  id?: null | number
  username: null | string
  password_hash: null | string // char(60)
  email: null | string
  tel: null | string
  avatar: null | string
  is_admin: null | boolean
  nickname: null | string
}

export type RequestLog = {
  id?: null | number
  method_id: number
  method?: Method
  url_id: number
  url?: Url
  user_agent_id: null | number
  user_agent?: UserAgent
  request_session_id: null | number
  request_session?: RequestSession
  user_id: null | number
  user?: User
  timestamp: number
}

export type VerificationAttempt = {
  id?: null | number
  passcode: string // char(6)
  email: null | string
  tel: null | string
}

export type VerificationCode = {
  id?: null | number
  uuid: null | string
  passcode: string // char(6)
  email: null | string
  tel: null | string
  request_time: number
  revoke_time: null | number
  match_id: null | number
  match?: VerificationAttempt
  user_id: null | number
  user?: User
}

export type ContentReport = {
  id?: null | number
  reporter_id: null | number
  reporter?: User
  type: string
  remark: null | string
  submit_time: number
  reviewer_id: null | number
  reviewer?: User
  review_time: null | number
  accept_time: null | number
  reject_time: null | number
}

export type Image = {
  id?: null | number
  original_filename: null | string
  filename: string
  user_id: number
  user?: User
  rotation: null | number
}

export type Label = {
  id?: null | number
  title: string
  dependency_id: null | number
  dependency?: Label
}

export type ImageLabel = {
  id?: null | number
  image_id: number
  image?: Image
  label_id: number
  label?: Label
  user_id: number
  user?: User
  answer: number
}

export type TrainingStats = {
  id?: null | number
  user_id: number
  user?: User
  label_id: number
  label?: Label
  epoch: number
  learning_rate: number
  train_accuracy: number
  train_loss: number
  val_accuracy: number
  val_loss: number
}

export type DBProxy = {
  method: Method[]
  url: Url[]
  ua_type: UaType[]
  request_session: RequestSession[]
  ua_bot: UaBot[]
  user_agent: UserAgent[]
  ua_stat: UaStat[]
  user: User[]
  request_log: RequestLog[]
  verification_attempt: VerificationAttempt[]
  verification_code: VerificationCode[]
  content_report: ContentReport[]
  image: Image[]
  label: Label[]
  image_label: ImageLabel[]
  training_stats: TrainingStats[]
}

export let proxy = proxySchema<DBProxy>({
  db,
  tableFields: {
    method: [],
    url: [],
    ua_type: [],
    request_session: [],
    ua_bot: [],
    user_agent: [
      /* foreign references */
      ['ua_type', { field: 'ua_type_id', table: 'ua_type' }],
      ['ua_bot', { field: 'ua_bot_id', table: 'ua_bot' }],
    ],
    ua_stat: [],
    user: [],
    request_log: [
      /* foreign references */
      ['method', { field: 'method_id', table: 'method' }],
      ['url', { field: 'url_id', table: 'url' }],
      ['user_agent', { field: 'user_agent_id', table: 'user_agent' }],
      ['request_session', { field: 'request_session_id', table: 'request_session' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    verification_attempt: [],
    verification_code: [
      /* foreign references */
      ['match', { field: 'match_id', table: 'verification_attempt' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    content_report: [
      /* foreign references */
      ['reporter', { field: 'reporter_id', table: 'user' }],
      ['reviewer', { field: 'reviewer_id', table: 'user' }],
    ],
    image: [
      /* foreign references */
      ['user', { field: 'user_id', table: 'user' }],
    ],
    label: [
      /* foreign references */
      ['dependency', { field: 'dependency_id', table: 'label' }],
    ],
    image_label: [
      /* foreign references */
      ['image', { field: 'image_id', table: 'image' }],
      ['label', { field: 'label_id', table: 'label' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    training_stats: [
      /* foreign references */
      ['user', { field: 'user_id', table: 'user' }],
      ['label', { field: 'label_id', table: 'label' }],
    ],
  },
})
