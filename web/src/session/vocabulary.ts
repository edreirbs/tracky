// Vocabulario para Whisper: corto a propósito (un prompt largo se "transcribe" en los silencios).
// Se arma con los nombres de las etiquetas y el vocabulario del perfil (Ajustes).
let vocabulary: string[] = [];

export function setVocabulary(words: readonly string[]): void {
  vocabulary = [...new Set(words.map((w) => w.trim()).filter(Boolean))].slice(0, 20);
}

export function getVocabulary(): readonly string[] {
  return vocabulary;
}
