/** Resolve the two published Flash catalog names without guessing other models.
 * Upstream: packages/llm/llm-deepseek/src/models.ts (deepseek-flash in rc.3;
 * deepseek-v4-flash in older hosts). Never rewrite an existing catalog entry,
 * a custom model, or a model when discovery failed/returned no useful rows.
 */
export function catalogModelId(model: string, models: readonly { id: string }[]): string {
  if (models.some(row => row.id === model)) return model
  const alternate = model === 'deepseek-v4-flash' ? 'deepseek-flash'
    : model === 'deepseek-flash' ? 'deepseek-v4-flash' : undefined
  return alternate !== undefined && models.some(row => row.id === alternate) ? alternate : model
}
