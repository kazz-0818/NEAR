/** 挨拶・呼びかけのみ（記憶更新・clarify 抑止などで共有） */
export function looksLikeTrivialLinePing(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (t.length === 0 || t.length > 32) return false;
  return /^(にあ|ニア|ねあ|nea|near|こんにちは|こんばんは|おはよう|おーい|おつ|おつかれ|よう|はろー|hello|hi|やあ|やー)$/iu.test(
    t
  );
}
