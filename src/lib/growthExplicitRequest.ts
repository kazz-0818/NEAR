/**
 * ユーザーが NEAR 本体への「再現可能な機能・永続連携・自動運用」を求めているか。
 *
 * Growth に載せるのはここが true のときだけ（pre-growth の最優先）。
 * 一般質問・文面作成・一回の天気/ニュース照会などは false にし、LLM / 外部短文側へ逃がす。
 */

export function isExplicitGrowthDevelopmentRequest(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (
    /(NEAR|ニア).{0,80}(できるように|調べられるように|使えるように|してほしい|対応して|追加して|実装して|連携して)/i.test(t)
  ) {
    return true;
  }
  if (
    /(できるようにして|できるように|管理できるように|運用できるように|機能を追加|機能追加|この機能を追加して|この機能を追加|API連携.*追加|連携.*追加して)/i.test(t)
  ) {
    return true;
  }
  if (/(外部API|Web\s*API).{0,24}(と.?連携|連携して|つないで|追加)/i.test(t)) return true;
  if (/(自動化して|毎朝|毎日|毎週|毎月|定期).{0,120}(通知|送って|リマインド|LINE通知|LINEで|教えて)/i.test(t)) return true;
  // 「〇〇を自動化して」単体（機能実装依頼）
  if ([...t].length >= 7 && /(を自動化して|が自動化|を自動化したい|ワークフローを自動)/i.test(t)) return true;
  if (/(スプレッドシート|スプシ|シート).{0,50}(に|へ).{0,12}(保存|書き込み|追記|記録|自動保存).{0,12}(して|したい|できるように)/i.test(t)) {
    return true;
  }
  if (/(スプレッドシート|スプシ|シート).{0,48}(読める|表示|抽出|出せるように|できるように|対応)/i.test(t)) return true;
  if (/GitHub.{0,24}(Issue|イシュー|PR).{0,24}(自動|作れるように|できるように|追加)/i.test(t)) return true;
  if (/(タスク|リマインド).{0,20}(できるように|追加|自動)/i.test(t)) return true;
  // SNS 等の「NEAR 経由の自動投稿・連携」＝実装が要る依頼
  if (
    /(Instagram|インスタ|Threads|Facebook|Meta\b|\bX\b|Twitter).{0,28}(に|と|へ).{0,16}(自動投稿|投稿できるように|連携して|できるように|API)/i.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * 「できるようにして」系が明示的に既存 Sheets/Drive 操作であるか。
 * true なら Growth ではなく既存モジュールに流してよい。
 * 例: 「POPUP売上管理表を開いて」「このスプレッドシートのタスク一覧出して」
 */
export function isExplicitExistingFileOperation(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  // 「このスプレッドシート」「既存のシート」「○○シートを開いて」等の既存ファイル明示
  if (/(この|既存の|例の|さっきの).{0,20}(スプレッドシート|スプシ|シート|表|ファイル)/iu.test(t)) return true;
  // 固有名詞＋シートを開く・読む（管理表名を指定している）
  if (/(POPUP|ポップアップ|購入代行|売上管理|在庫|受注).{0,30}(シート|管理表|表).{0,20}(を)?(開いて|見て|出して|読んで)/iu.test(t)) return true;
  // 明示ファイル URL
  if (/docs\.google\.com\/spreadsheets/iu.test(t)) return true;
  return false;
}

/**
 * ユーザーが混乱・否定・不満を示しているシグナル。
 * pending 状態を継続せず、謝罪＋正しい解釈を返すために使う。
 * 注: 修正依頼（「これもう少し変えて」）とは区別する。
 */
export function isUserConfusionOrNegationSignal(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  // 短い感嘆・疑問（<=8文字）
  if ([...t].length <= 8) {
    if (/^(は[?？!！\s]*|え[?？!！\s]*|ん[?？!！\s]*|はぁ[?？!！\s]*|は[あ]+|なんで[?？]?|意味不明|わからん|わからない|違う[!！]?)$/u.test(t)) {
      return true;
    }
  }
  // 混乱・疑問シグナル（長短問わず）
  if (
    /(どういうこと[?？]?|どういう意味[?？]?|意味わからん|意味不明|ぜんぜんあかん|全然あかん|何の話[?？]?|話がズレ|ズレてる|ちがう|違う|そういうことじゃない|そうじゃなくて|それじゃない|なんかおかしい|文脈見て|ちゃんと汲み取って|なぜ番号|なんで番号|番号じゃない)/u.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * 管理者・成長フロー向けの短い強制コマンド（エージェント雑談に回さない）。
 * 「GitHub Issue作って」単体は既存の Issue 作成／管理者経路に任せ、ここでは Growth に載せない。
 */
export function isForcedGrowthOrIssueCommand(text: string): boolean {
  const t = text.normalize("NFKC").trim();
  if (!t) return false;
  if (/成長案にして|要望を\s*Issue\s*化|issue\s*化して|イシュー化して/i.test(t)) return true;
  if (/Cursorに投げて|カーソルに投げて|実装依頼して/i.test(t)) return true;
  return false;
}
