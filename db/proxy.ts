/**
 * This file is auto generated, do not edit it manually.
 *
 * update command: npm run update
 */

import { proxySchema } from 'better-sqlite3-proxy'
import { db } from './db'

export type RequestLog = {
  id?: null | number
  method_id: number
  method?: Method
  url_id: number
  url?: Url
  user_agent_id: null | number
  user_agent?: UserAgent
  geo_ip_id: null | number
  geo_ip?: GeoIp
  request_session_id: null | number
  request_session?: RequestSession
  user_id: null | number
  user?: User
  timestamp: number
}

export type Method = {
  id?: null | number
  method: string
}

export type Url = {
  id?: null | number
  url: string
}

export type GeoIpParts = {
  id?: null | number
  hash: string
  content: string
}

export type GeoIp = {
  id?: null | number
  hash: string
  content: string
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

export type UaType = {
  id?: null | number
  name: string
  count: number
}

export type UaBot = {
  id?: null | number
  name: string
  count: number
}

export type UaStat = {
  id?: null | number
  last_request_log_id: number
}

export type RequestSession = {
  id?: null | number
  language: null | string
  timezone: null | string
  timezone_offset: null | number
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

export type ErrorLog = {
  id?: null | number
  timestamp: number
  title: string
  error: string
  client_url_id: number
  client_url?: Url
  api_url_id: number
  api_url?: Url
  request_log_id: number
  request_log?: RequestLog
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

export type VerificationAttempt = {
  id?: null | number
  passcode: string // char(6)
  email: null | string
  tel: null | string
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

export type Project = {
  id?: null | number
  title: string
  creator_id: number
  creator?: User
}

export type Image = {
  id?: null | number
  original_filename: null | string
  filename: string
  user_id: number
  user?: User
  rotation: null | number
  project_id: null | number
  project?: Project
  content_hash: null | string
}

export type Label = {
  id?: null | number
  title: string
  dependency_id: null | number
  dependency?: Label
  project_id: null | number
  project?: Project
  display_order: null | number
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

export type ProjectMember = {
  id?: null | number
  project_id: number
  project?: Project
  user_id: number
  user?: User
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

export type ImageBoundingBox = {
  id?: null | number
  image_id: number
  image?: Image
  user_id: number
  user?: User
  label_id: number
  label?: Label
  x: number
  y: number
  height: number
  width: number
  rotate: number
}

export type ImageBoundingBoxConfirmation = {
  id?: null | number
  image_id: number
  image?: Image
  user_id: number
  user?: User
  label_id: number
  label?: Label
}

export type DBProxy = {
  request_log: RequestLog[]
  method: Method[]
  url: Url[]
  geo_ip_parts: GeoIpParts[]
  geo_ip: GeoIp[]
  user_agent: UserAgent[]
  ua_type: UaType[]
  ua_bot: UaBot[]
  ua_stat: UaStat[]
  request_session: RequestSession[]
  user: User[]
  error_log: ErrorLog[]
  verification_code: VerificationCode[]
  verification_attempt: VerificationAttempt[]
  content_report: ContentReport[]
  project: Project[]
  image: Image[]
  label: Label[]
  image_label: ImageLabel[]
  project_member: ProjectMember[]
  training_stats: TrainingStats[]
  image_bounding_box: ImageBoundingBox[]
  image_bounding_box_confirmation: ImageBoundingBoxConfirmation[]
}

export let proxy = proxySchema<DBProxy>({
  db,
  tableFields: {
    request_log: [
      /* foreign references */
      ['method', { field: 'method_id', table: 'method' }],
      ['url', { field: 'url_id', table: 'url' }],
      ['user_agent', { field: 'user_agent_id', table: 'user_agent' }],
      ['geo_ip', { field: 'geo_ip_id', table: 'geo_ip' }],
      ['request_session', { field: 'request_session_id', table: 'request_session' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    method: [],
    url: [],
    geo_ip_parts: [],
    geo_ip: [],
    user_agent: [
      /* foreign references */
      ['ua_type', { field: 'ua_type_id', table: 'ua_type' }],
      ['ua_bot', { field: 'ua_bot_id', table: 'ua_bot' }],
    ],
    ua_type: [],
    ua_bot: [],
    ua_stat: [],
    request_session: [],
    user: [],
    error_log: [
      /* foreign references */
      ['client_url', { field: 'client_url_id', table: 'url' }],
      ['api_url', { field: 'api_url_id', table: 'url' }],
      ['request_log', { field: 'request_log_id', table: 'request_log' }],
    ],
    verification_code: [
      /* foreign references */
      ['match', { field: 'match_id', table: 'verification_attempt' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    verification_attempt: [],
    content_report: [
      /* foreign references */
      ['reporter', { field: 'reporter_id', table: 'user' }],
      ['reviewer', { field: 'reviewer_id', table: 'user' }],
    ],
    project: [
      /* foreign references */
      ['creator', { field: 'creator_id', table: 'user' }],
    ],
    image: [
      /* foreign references */
      ['user', { field: 'user_id', table: 'user' }],
      ['project', { field: 'project_id', table: 'project' }],
    ],
    label: [
      /* foreign references */
      ['dependency', { field: 'dependency_id', table: 'label' }],
      ['project', { field: 'project_id', table: 'project' }],
    ],
    image_label: [
      /* foreign references */
      ['image', { field: 'image_id', table: 'image' }],
      ['label', { field: 'label_id', table: 'label' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    project_member: [
      /* foreign references */
      ['project', { field: 'project_id', table: 'project' }],
      ['user', { field: 'user_id', table: 'user' }],
    ],
    training_stats: [
      /* foreign references */
      ['user', { field: 'user_id', table: 'user' }],
      ['label', { field: 'label_id', table: 'label' }],
    ],
    image_bounding_box: [
      /* foreign references */
      ['image', { field: 'image_id', table: 'image' }],
      ['user', { field: 'user_id', table: 'user' }],
      ['label', { field: 'label_id', table: 'label' }],
    ],
    image_bounding_box_confirmation: [
      /* foreign references */
      ['image', { field: 'image_id', table: 'image' }],
      ['user', { field: 'user_id', table: 'user' }],
      ['label', { field: 'label_id', table: 'label' }],
    ],
  },
})
