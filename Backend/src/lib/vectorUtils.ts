/** Cosine similarity for dense vectors (e.g. embeddings). */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const m = Math.sqrt(magA) * Math.sqrt(magB);
  return m === 0 ? 0 : dot / m;
}
