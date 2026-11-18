import {
  isPreferZh,
  isPreferZhCN,
  isPreferZhHK,
  type LocaleVariants,
} from '../components/locale.js'
import { getContextLanguage, type Context } from '../context.js'

/**
 * The texts of the similar-images page that are rendered by the
 * client-side script (or by a websocket message) instead of by the
 * server-rendered JSX.
 *
 * The JSX parts of the page use the `<Locale>` component, which
 * resolves the language on the server. The inline script cannot do
 * that: it runs in the browser, where the user's language is only
 * known through the cookie. So the strings live here, the server
 * resolves them (see `resolveSimilarImagesMessages`) and injects the
 * result into the script.
 *
 * Placeholders use the `{name}` syntax and are replaced by
 * `formatMessage` on the server and by `fmt` in the script.
 */
export const similarImagesMessages = {
  error: {
    en: 'Error',
    zh_hk: '錯誤',
    zh_cn: '错误',
  },
  computingEmbeddings: {
    en: 'Computing embeddings...',
    zh_hk: '正在計算向量...',
    zh_cn: '正在计算向量...',
  },
  computeEmbeddingsDone: {
    en: 'Done: {embedded} embedded, {skipped} skipped',
    zh_hk: '完成：已計算 {embedded} 張，略過 {skipped} 張',
    zh_cn: '完成：已计算 {embedded} 张，跳过 {skipped} 张',
  },
  computeEmbeddingsAllDone: {
    en: 'All {skipped} images already have embeddings — nothing to compute',
    zh_hk: '全部 {skipped} 張圖片都已有向量，無需計算',
    zh_cn: '全部 {skipped} 张图片都已有向量，无需计算',
  },
  searching: {
    en: 'Searching...',
    zh_hk: '搜尋中...',
    zh_cn: '搜索中...',
  },
  trainingFromRanking: {
    en: 'Training AI from your ranking...',
    zh_hk: '正在用你的排序訓練 AI...',
    zh_cn: '正在用你的排序训练 AI...',
  },
  trainingModel: {
    en: 'Training similarity model...',
    zh_hk: '正在訓練相似度模型...',
    zh_cn: '正在训练相似度模型...',
  },
  modelTrained: {
    en: 'Model trained (best epoch {epoch})',
    zh_hk: '模型訓練完成（最佳輪次 {epoch}）',
    zh_cn: '模型训练完成（最佳轮次 {epoch}）',
  },
  deleteImageTitle: {
    en: 'Delete this image?',
    zh_hk: '確定刪除這張圖片？',
    zh_cn: '确定删除这张图片？',
  },
  deleteImageText: {
    en: 'It will be removed from the dataset (including annotations).',
    zh_hk: '它會從數據集中移除（包括標註）。',
    zh_cn: '它会从数据集中移除（包括标注）。',
  },
  deleteButton: {
    en: 'Delete',
    zh_hk: '刪除',
    zh_cn: '删除',
  },
  cancelButton: {
    en: 'Cancel',
    zh_hk: '取消',
    zh_cn: '取消',
  },
  deleteImageConfirm: {
    en: 'Delete this image? It will be removed from the dataset.',
    zh_hk: '確定刪除這張圖片？它會從數據集中移除。',
    zh_cn: '确定删除这张图片？它会从数据集中移除。',
  },
  trainingRelationModel: {
    en: 'Training relation model...',
    zh_hk: '正在訓練關係模型...',
    zh_cn: '正在训练关系模型...',
  },
  relationModelTrained: {
    en: 'Relation model trained: {accuracy}% accuracy',
    zh_hk: '關係模型訓練完成：準確率 {accuracy}%',
    zh_cn: '关系模型训练完成：准确率 {accuracy}%',
  },
  usingTrainedModel: {
    en: 'Using the trained model',
    zh_hk: '正在使用訓練好的模型',
    zh_cn: '正在使用训练好的模型',
  },
  usingWeightedCosine: {
    en: 'Using the weighted cosine',
    zh_hk: '正在使用加權餘弦',
    zh_cn: '正在使用加权余弦',
  },
  noMoreTriplets: {
    en: 'No more triplets to annotate. The dataset may not have enough images with embeddings.',
    zh_hk: '沒有更多三元組可標註了。數據集可能沒有足夠帶向量的圖片。',
    zh_cn: '没有更多三元组可标注了。数据集可能没有足够带向量的图片。',
  },
  tripletPosition: {
    en: 'Triplet {current} of {total}',
    zh_hk: '第 {current} 組 / 共 {total} 組',
    zh_cn: '第 {current} 组 / 共 {total} 组',
  },
  annotatedCount: {
    en: 'Annotated: {count}',
    zh_hk: '已標註：{count}',
    zh_cn: '已标注：{count}',
  },
  clickImageHint: {
    en: 'Click an image, or press 1-5',
    zh_hk: '點擊圖片，或按 1-5 鍵',
    zh_cn: '点击图片，或按 1-5 键',
  },
  skipBatch: {
    en: 'Skip batch',
    zh_hk: '跳過這批',
    zh_cn: '跳过这批',
  },
  oddOneOutA: {
    en: 'A is the odd one out',
    zh_hk: 'A 是最不同的一張',
    zh_cn: 'A 是最不同的一张',
  },
  oddOneOutB: {
    en: 'B is the odd one out',
    zh_hk: 'B 是最不同的一張',
    zh_cn: 'B 是最不同的一张',
  },
  oddOneOutC: {
    en: 'C is the odd one out',
    zh_hk: 'C 是最不同的一張',
    zh_cn: 'C 是最不同的一张',
  },
  allEquallySimilar: {
    en: 'All three are equally similar',
    zh_hk: '三者都差不多',
    zh_cn: '三者都差不多',
  },
  allDifferent: {
    en: 'All three are different',
    zh_hk: '三者都相異',
    zh_cn: '三者都相异',
  },
  annotatedTriplets: {
    en: 'Annotated triplets',
    zh_hk: '已標註的三元組',
    zh_cn: '已标注的三元组',
  },
  rankingSaved: {
    en: 'Ranking saved',
    zh_hk: '排序已儲存',
    zh_cn: '排序已保存',
  },
  needTwoPairs: {
    en: 'Need at least 2 ranked pairs to train. Move some pairs first.',
    zh_hk: '至少需要 2 組已排序的配對才能訓練，請先調整排序。',
    zh_cn: '至少需要 2 组已排序的配对才能训练，请先调整排序。',
  },
  aiTrainedFromRanking: {
    en: 'AI trained from your ranking (GA, {elapsed}ms) — list refreshed ({mode} mode)',
    zh_hk: '已用你的排序訓練 AI（GA，{elapsed} 毫秒）— 清單已更新（{mode} 模式）',
    zh_cn: '已用你的排序训练 AI（GA，{elapsed} 毫秒）— 清单已更新（{mode} 模式）',
  },
  imageDeleted: {
    en: 'Image deleted',
    zh_hk: '圖片已刪除',
    zh_cn: '图片已删除',
  },
  computingEmbeddingsProgress: {
    en: 'Computing embeddings... {done}/{total}',
    zh_hk: '正在計算向量... {done}/{total}',
    zh_cn: '正在计算向量... {done}/{total}',
  },
  trainingProgress: {
    en: 'Training model: epoch {epoch}{loss}{detail}',
    zh_hk: '正在訓練模型：第 {epoch} 輪{loss}{detail}',
    zh_cn: '正在训练模型：第 {epoch} 轮{loss}{detail}',
  },
  trainingDone: {
    en: 'Model trained{accuracy}',
    zh_hk: '模型訓練完成{accuracy}',
    zh_cn: '模型训练完成{accuracy}',
  },
  rankingAccuracy: {
    en: 'ranking {accuracy}%',
    zh_hk: '排序 {accuracy}%',
    zh_cn: '排序 {accuracy}%',
  },
  relationAccuracy: {
    en: 'relation {accuracy}%',
    zh_hk: '關係 {accuracy}%',
    zh_cn: '关系 {accuracy}%',
  },
  loss: {
    en: ', loss {loss}',
    zh_hk: '，損失 {loss}',
    zh_cn: '，损失 {loss}',
  },
  deleteImageTooltip: {
    en: 'Delete this image',
    zh_hk: '刪除這張圖片',
    zh_cn: '删除这张图片',
  },
  notSeparatedTooltip: {
    en: 'The model has not separated these pairs yet — the order still reflects the plain cosine.',
    zh_hk: '模型還未能分辨這些配對 — 排序仍然反映原始餘弦相似度。',
    zh_cn: '模型还未能分辨这些配对 — 排序仍然反映原始余弦相似度。',
  },
  moveUpTooltip: {
    en: 'Move up (more similar)',
    zh_hk: '上移（更相似）',
    zh_cn: '上移（更相似）',
  },
  moveDownTooltip: {
    en: 'Move down (less similar)',
    zh_hk: '下移（較不相似）',
    zh_cn: '下移（较不相似）',
  },
  notEnoughTriplets: {
    en: 'Not enough triplet annotations. Answer at least 4 triplets first.',
    zh_hk: '三元組標註不足，請先至少標註 4 組。',
    zh_cn: '三元组标注不足，请先至少标注 4 组。',
  },
  notEnoughRanking: {
    en: 'Not enough ranking feedback. Move some pairs up or down first, then train again.',
    zh_hk: '排序回饋不足，請先調整一些配對的上下順序，然後再訓練。',
    zh_cn: '排序反馈不足，请先调整一些配对的上下顺序，然后再训练。',
  },
  notEnoughImagesForTriplet: {
    en: 'Not enough images with embeddings to build a triplet',
    zh_hk: '帶向量的圖片不足，無法組成三元組',
    zh_cn: '带向量的图片不足，无法组成三元组',
  },
} satisfies Record<string, LocaleVariants<string>>

export type SimilarImagesMessageKey = keyof typeof similarImagesMessages

/**
 * Replace the `{name}` placeholders of a message with the given values.
 */
export function formatMessage(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    let value = values[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Resolve the messages of the page for the user's language.
 *
 * The result is a flat dictionary of `key -> template`, which the
 * client script fills in with the values it knows (the counts, the
 * accuracy, ...).
 */
export function resolveSimilarImagesMessages(
  context: Context,
): Record<string, string> {
  let lang = getContextLanguage(context)
  let resolved: Record<string, string> = {}
  for (let key in similarImagesMessages) {
    let variants = similarImagesMessages[key as SimilarImagesMessageKey]
    let text: string
    if (isPreferZhHK(lang)) text = variants.zh_hk
    else if (isPreferZhCN(lang)) text = variants.zh_cn
    else if (isPreferZh(lang)) text = variants.zh_hk
    else text = variants.en
    resolved[key] = text
  }
  return resolved
}

