// YOLO format helpers, vendored from dataset-helpers
// (src/label.ts + src/yaml.ts) so the project does not depend on a sibling
// folder / external build. Zero external dependencies.
// Includes the fix for parseMultilineArray where `if (+key)` is falsy for
// key "0" (0-indexed class names could not be parsed back from generated
// YAML). If dataset-helpers is updated upstream (e.g. pose support),
// sync changes here manually.

// ==================== label.ts ====================

export type BoundingBox = {
  /** starts from 0 */
  class_idx: number
  /** normalized to [0,1] */
  x: number
  y: number
  width: number
  height: number
}

export type Keypoint = {
  x: number
  y: number
  visibility: 0 | 1
}

export type BoundingBoxWithKeypoints = BoundingBox & {
  keypoints: Keypoint[]
}

// Type predicates
function isKeypoint(value: unknown): value is Keypoint {
  const k = value as Keypoint
  return (
    typeof k.x === 'number' &&
    typeof k.y === 'number' &&
    (k.visibility === 0 || k.visibility === 1) &&
    isBetweenZeroAndOne(k.x) &&
    isBetweenZeroAndOne(k.y)
  )
}

export function isBoundingBox(value: unknown): value is BoundingBox {
  const b = value as BoundingBox
  return (
    typeof b.class_idx === 'number' &&
    isBetweenZeroAndOne(b.x) &&
    isBetweenZeroAndOne(b.y) &&
    isBetweenZeroAndOne(b.width) &&
    isBetweenZeroAndOne(b.height)
  )
}

export function isBoundingBoxWithKeypoints(
  value: unknown,
): value is BoundingBoxWithKeypoints {
  const b = value as BoundingBoxWithKeypoints
  return (
    isBoundingBox(b) &&
    Array.isArray(b.keypoints) &&
    b.keypoints.every(isKeypoint)
  )
}

// Validation utilities
function isBetweenZeroAndOne(value: number): boolean {
  return value >= 0 && value <= 1
}

function validateClassIndex(options: {
  class_idx: number
  n_class: number
}): void {
  const { class_idx, n_class } = options
  if (!Number.isInteger(class_idx)) {
    throw new Error(
      `Invalid class index: receive ${class_idx} but expect an integer`,
    )
  }
  if (class_idx < 0 || class_idx >= n_class) {
    throw new Error(
      `Invalid class index: receive ${class_idx} but expect a range of [0,${n_class - 1}]`,
    )
  }
}

function validateBoundingBox(box: {
  x: number
  y: number
  width: number
  height: number
}): void {
  const { x, y, width, height } = box
  if (!isBetweenZeroAndOne(x) || !isBetweenZeroAndOne(y)) {
    throw new Error(
      `Invalid bounding box coordinates: x=${x}, y=${y}. Expected range [0, 1].`,
    )
  }

  if (!isBetweenZeroAndOne(width) || !isBetweenZeroAndOne(height)) {
    throw new Error(
      `Invalid bounding box size: width=${width}, height=${height}. Expected range [0, 1].`,
    )
  }
}

type BaseParseOptions = {
  line: string
  n_class: number
}

export type ParseDetectLabelOptions = BaseParseOptions

export type ParsePoseLabelOptions = BaseParseOptions & {
  n_keypoints: number
  is_visible: boolean
}

function isParsePoseLabelOptions(
  options: BaseParseOptions,
): options is ParsePoseLabelOptions {
  return 'n_keypoints' in options && 'is_visible' in options
}

// Label parsing
export function parseLabelString(
  task: 'detect' | 'pose',
  options: ParseDetectLabelOptions | ParsePoseLabelOptions,
): BoundingBox | BoundingBoxWithKeypoints {
  if (task === 'detect') {
    if (isParsePoseLabelOptions(options)) {
      throw new Error('Invalid options for detect task')
    }
    return parseDetectLabelString(options)
  } else {
    if (!isParsePoseLabelOptions(options)) {
      throw new Error('Invalid options for pose task')
    }
    return parsePoseLabelString(options)
  }
}

function parseBaseLabelString(options: BaseParseOptions) {
  const { line, n_class } = options
  const label_parts = line.trim().split(' ')

  const class_idx = +label_parts[0]
  validateClassIndex({ class_idx, n_class })

  const x = +label_parts[1]
  const y = +label_parts[2]
  const width = +label_parts[3]
  const height = +label_parts[4]
  validateBoundingBox({ x, y, width, height })

  return {
    class_idx,
    x,
    y,
    width,
    height,
    label_parts,
  }
}

function parseDetectLabelString(options: ParseDetectLabelOptions): BoundingBox {
  const { label_parts, ...bounding_box } = parseBaseLabelString(options)

  if (label_parts.length !== 5) {
    throw new Error(
      `Invalid detect (bounding box) label line: expected 5 parts but got ${label_parts.length} parts`,
    )
  }

  if (!isBoundingBox(bounding_box)) {
    throw new Error('Invalid bounding box data')
  }

  return bounding_box
}

function parsePoseLabelString(
  options: ParsePoseLabelOptions,
): BoundingBoxWithKeypoints {
  const { n_keypoints, is_visible } = options
  const { label_parts, ...bounding_box } = parseBaseLabelString(options)

  const step = is_visible ? 3 : 2
  const expected_parts = 5 + n_keypoints * step
  if (label_parts.length !== expected_parts) {
    throw new Error(
      `Invalid pose label line: expect (5 + ${n_keypoints} * ${step} = ${expected_parts}) parts but got ${label_parts.length} parts`,
    )
  }

  const keypoints: Keypoint[] = []
  for (let i = 5; i < label_parts.length; i += step) {
    const x = +label_parts[i]
    const y = +label_parts[i + 1]
    const visibility = is_visible ? (+label_parts[i + 2] as 0 | 1) : 1
    const keypoint = { x, y, visibility }

    if (!isKeypoint(keypoint)) {
      throw new Error(`Invalid keypoint at position ${i}`)
    }
    keypoints.push(keypoint)
  }

  const result = {
    ...bounding_box,
    keypoints,
  }

  if (!isBoundingBoxWithKeypoints(result)) {
    throw new Error('Invalid bounding box with keypoints data')
  }

  return result
}

// Label string generation
type BaseToLabelOptions = {
  class_idx: number
  n_class: number
  x: number
  y: number
  width: number
  height: number
}

export type DetectLabelStringOptions = BaseToLabelOptions

export type PoseLabelStringOptions = BaseToLabelOptions & {
  n_keypoints: number
  visibility: boolean
  keypoints: Keypoint[]
}

export function toLabelString(
  task: 'detect' | 'pose',
  options: DetectLabelStringOptions | PoseLabelStringOptions,
): string {
  if (task === 'detect') {
    return toDetectLabelString(options as DetectLabelStringOptions)
  } else {
    if (!isToPoseLabelStringOptions(options)) {
      throw new Error('Invalid options for pose task')
    }
    return toPoseLabelString(options)
  }
}

function isToPoseLabelStringOptions(
  options: BaseToLabelOptions,
): options is PoseLabelStringOptions {
  return (
    'n_keypoints' in options &&
    'visibility' in options &&
    'keypoints' in options
  )
}

export function toDetectLabelString(options: DetectLabelStringOptions): string {
  const { class_idx, x, y, width, height } = options
  validateClassIndex(options)
  validateBoundingBox(options)
  return `${class_idx} ${x} ${y} ${width} ${height}`
}

export function toPoseLabelString(options: PoseLabelStringOptions): string {
  const { class_idx, x, y, width, height, keypoints, n_keypoints, visibility } =
    options

  validateClassIndex(options)
  validateBoundingBox(options)

  if (n_keypoints !== keypoints.length) {
    throw new Error(
      `Number of keypoints (${keypoints.length}) does not match n_keypoints (${n_keypoints})`,
    )
  }

  if (!keypoints.every(isKeypoint)) {
    throw new Error('Invalid keypoints data')
  }

  let label = `${class_idx} ${x} ${y} ${width} ${height}`

  for (const keypoint of keypoints) {
    label += ` ${keypoint.x} ${keypoint.y}`
    if (visibility) {
      label += ` ${keypoint.visibility}`
    }
  }

  return label
}

// ==================== yaml.ts ====================

function yamlToString(data: unknown): string {
  return Array.isArray(data)
    ? '[' + data.map(yamlToString).join(', ') + ']'
    : JSON.stringify(data)
}

function removeComment(line: string) {
  return line.split('#')[0]
}

function replaceStringQuote(line: string) {
  return line.replaceAll("'", '"')
}

function isDigit(char: string) {
  return '0' <= char && char <= '9'
}

function hasValue(lines: string[], name: string) {
  let pattern = name.toLowerCase() + ':'
  let index = lines.findIndex(line => line.toLowerCase().startsWith(pattern))
  return index != -1
}

function findValue(lines: string[], name: string) {
  let pattern = name.toLowerCase() + ':'
  let index = lines.findIndex(line => line.toLowerCase().startsWith(pattern))
  let line = lines[index]
  if (!line) return
  let rest = removeComment(line.slice(pattern.length)).trim()
  if (rest.startsWith('[')) {
    // parse inline array
    return parseValue(rest)
  }
  if (!rest) {
    // parse multiline array or object
    return Array.from(parseMultilineArray(lines, index))
  }
  // number or string
  return parseValue(rest)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber)
}

function findString(lines: string[], name: string): string {
  let value = findValue(lines, name)
  if (value === undefined) {
    throw new TypeError(`expect ${name} to be string, but missing`)
  }
  if (!isString(value)) {
    throw new TypeError(`expect ${name} to be string, but got: ${typeof value}`)
  }
  return value
}

function findNumber(lines: string[], name: string): number {
  let value = findValue(lines, name)
  if (value === undefined) {
    throw new TypeError(`expect ${name} to be number, but missing`)
  }
  if (!isNumber(value)) {
    throw new TypeError(`expect ${name} to be number, but got: ${typeof value}`)
  }
  return value
}

function findStringArray(lines: string[], name: string): string[] {
  let value = findValue(lines, name)
  if (value === undefined) {
    throw new TypeError(`expect ${name} to be string array, but missing`)
  }
  if (!isStringArray(value)) {
    throw new TypeError(
      `expect ${name} to be string array, but got: ${Array.isArray(value) ? 'array of other type' : typeof value}`,
    )
  }
  return value
}

function findNumberArray(lines: string[], name: string): number[] {
  let value = findValue(lines, name)
  if (value === undefined) {
    throw new TypeError(`expect ${name} to be number array, but missing`)
  }
  if (!isNumberArray(value)) {
    throw new TypeError(
      `expect ${name} to be number array, but got: ${Array.isArray(value) ? 'array of other type' : typeof value}`,
    )
  }
  return value
}

function parseValue(value: string): unknown {
  value = removeComment(value)
  value = value.trim()
  value = replaceStringQuote(value)
  // inline array
  if (value.startsWith('[')) {
    return JSON.parse(value)
  }
  // string with quote
  if (value.startsWith('"')) {
    return JSON.parse(value)
  }
  // number
  if (isDigit(value[0])) {
    return +value
  }
  // string
  return value
}

function* parseMultilineArray(lines: string[], index: number) {
  for (let i = index + 1; i < lines.length; i++) {
    // e.g. "- value" or "0: value"
    let line = lines[i].trim()

    // test "- value"
    if (line.startsWith('- ')) {
      yield parseValue(line.slice(2).trim())
      continue
    }

    // test "0: value"
    // NOTE: use isNaN check rather than truthiness of +key — key "0" is
    // falsy, which would stop parsing at the first (0-indexed) entry
    let [key, value] = line.split(':')
    if (key.trim() !== '' && !isNaN(+key.trim())) {
      yield parseValue(value)
      continue
    }

    break
  }
}

type BaseYamlOptions = {
  train_dir: string
  val_dir: string
  test_dir: string
  n_class: number
  class_names?: string[]
}

export type DetectYamlOptions = BaseYamlOptions

export type PoseYamlOptions = BaseYamlOptions & {
  keypoint_names?: string[]
  n_keypoints: number
  visibility: boolean
  flip_idx?: number[]
}

export function isPoseYamlOptions(
  options: unknown,
): options is PoseYamlOptions {
  const o = options as PoseYamlOptions
  return (
    isString(o.train_dir) &&
    isString(o.val_dir) &&
    isString(o.test_dir) &&
    isNumber(o.n_class) &&
    (o.class_names === undefined || isStringArray(o.class_names)) &&
    isNumber(o.n_keypoints) &&
    typeof o.visibility === 'boolean' &&
    (o.flip_idx === undefined || isNumberArray(o.flip_idx))
  )
}

export function isDetectYamlOptions(
  options: unknown,
): options is DetectYamlOptions {
  const o = options as DetectYamlOptions
  return (
    isString(o.train_dir) &&
    isString(o.val_dir) &&
    isString(o.test_dir) &&
    isNumber(o.n_class) &&
    (o.class_names === undefined || isStringArray(o.class_names))
  )
}

export function parseDataYaml(
  task: 'pose' | 'detect',
  yaml: string,
): PoseYamlOptions | DetectYamlOptions {
  return task === 'pose' ? parsePoseDataYaml(yaml) : parseDetectDataYaml(yaml)
}

function parseDetectDataYaml(yaml: string): DetectYamlOptions {
  const lines = yaml.split('\n')

  const detectOptions: DetectYamlOptions = {
    train_dir: findString(lines, 'train'),
    val_dir: findString(lines, 'val'),
    test_dir: findString(lines, 'test'),
    n_class: findNumber(lines, 'nc'),
    class_names: hasValue(lines, 'names')
      ? findStringArray(lines, 'names')
      : undefined,
  }

  if (!isDetectYamlOptions(detectOptions)) {
    throw new Error('Invalid detect YAML options structure')
  }

  return detectOptions
}

function parsePoseDataYaml(yaml: string): PoseYamlOptions {
  const lines = yaml.split('\n')

  const kpt_shape = findNumberArray(lines, 'kpt_shape')
  const n_keypoints = kpt_shape[0]
  const visibility = kpt_shape[1] === 3

  const poseOptions: PoseYamlOptions = {
    train_dir: findString(lines, 'train'),
    val_dir: findString(lines, 'val'),
    test_dir: findString(lines, 'test'),
    n_class: findNumber(lines, 'nc'),
    class_names: hasValue(lines, 'names')
      ? findStringArray(lines, 'names')
      : undefined,
    keypoint_names: hasValue(lines, '# keypoints')
      ? findStringArray(lines, '# keypoints')
      : undefined,
    n_keypoints,
    visibility,
    flip_idx: hasValue(lines, 'flip_idx')
      ? findNumberArray(lines, 'flip_idx')
      : undefined,
  }

  if (!isPoseYamlOptions(poseOptions)) {
    throw new Error('Invalid pose YAML options structure')
  }

  return poseOptions
}

class YamlBuilder {
  lines: string[] = []

  addLine(line: string) {
    this.lines.push(line)
  }

  toString(): string {
    return this.lines.join('\n').trim() + '\n'
  }
}

function toBaseDataYamlString(options: BaseYamlOptions): YamlBuilder {
  let yaml = new YamlBuilder()
  yaml.addLine(`train: ${options.train_dir}`)
  yaml.addLine(`val: ${options.val_dir}`)
  yaml.addLine(`test: ${options.test_dir}`)
  yaml.addLine(``)
  yaml.addLine(`nc: ${options.n_class} # Number of classes`)

  if (options.class_names) {
    let class_names = options.class_names

    if (class_names.length !== options.n_class) {
      throw new Error(
        `Number of class_names (${class_names.length}) does not match n_class (${options.n_class})`,
      )
    }

    yaml.addLine('# Class names')
    if (class_names.length > 1) {
      yaml.addLine(`names:`)
      for (let i = 0; i < class_names.length; i++) {
        yaml.addLine(`  ${i}: ${class_names[i]}`)
      }
    } else {
      yaml.addLine(`names: ${yamlToString(class_names)}`)
    }
  }

  yaml.addLine(``)

  return yaml
}

export function toDataYamlString(
  task: 'pose' | 'detect',
  options: PoseYamlOptions | DetectYamlOptions,
): string {
  if (task === 'pose') {
    if (!isPoseYamlOptions(options)) {
      throw new Error('Invalid options for pose YAML')
    }
    return toPoseDataYamlString(options)
  }
  if (task === 'detect') {
    if (!isDetectYamlOptions(options)) {
      throw new Error('Invalid options for detect YAML')
    }
    return toDetectDataYamlString(options)
  }
  throw new Error(`unknown task type "${task}"`)
}

export function toDetectDataYamlString(options: DetectYamlOptions): string {
  return toBaseDataYamlString(options).toString()
}

export function toPoseDataYamlString(options: PoseYamlOptions): string {
  const { keypoint_names, n_keypoints, visibility, flip_idx } = options

  let yaml = toBaseDataYamlString(options)

  if (keypoint_names) {
    yaml.addLine(`# Keypoints: ${yamlToString(keypoint_names)}`)
  }

  const n_dims = visibility ? 3 : 2
  yaml.addLine(
    `kpt_shape: ${yamlToString([n_keypoints, n_dims])} # [n_keypoints, n_dims]`,
  )

  if (flip_idx && flip_idx.length > 0) {
    yaml.addLine(`flip_idx: ${yamlToString(flip_idx)} # Keypoint flip indexes`)
  }

  return yaml.toString()
}