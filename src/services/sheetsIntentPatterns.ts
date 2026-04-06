/**
 * simple_question → google_sheets_query 昇格用のパターン（意図分類の補助）。
 * 正規表現が増えたらこのファイルに集約する。
 */

const SHEETS_TOPIC_EXPLICIT =
  /シート|スプシ|スプレッド|spreadsheet|一覧を|一覧が|一覧に|表を|表の|表に|表データ|ブック|セル|先に(送|貼|共有)|このブック|この一覧|この表|既定の|読み取った|取り込ん|docs\.google\.com\/spreadsheets/i;

const ANALYZE_OR_CONTINUE_SHEETS =
  /(これ|それ|上|さっき|先|直前|このデータ|この表|この一覧|一覧).{0,30}(見て|読んで|分析|解析|どう思|教えて|解説|コメント|判断|説明)|分析(して|できますか|できる)|見て.{0,12}(判断|どう|分析)|^ニア[,、\s]*(これ|それ|上).{0,25}(見て|分析)/i;

const SHEETS_NUMERIC_OR_OPINION_FOLLOWUP =
  /\d{1,2}月(だけ|のみ|分)?\s*(の|で)?\s*(算出|集計|データ|結果|教えて|見て|出して|抽出|一覧|リスト|件|売上|売り上げ|売上高|売行|粗利|利益|実績|件数|個数|人数|台数|数量|注文|受注)|\d{1,2}月(について|の件|の分|の状況|の数字)|(?:^|[\s、。])(算出|集計|合計|平均(値)?|件数|内訳)(\s|を)?(して|してほしい|ください|お願い|できる)|どう思(う|います|いる)|所感|印象|読み取って|傾向|比較して|前年|先月|昨年|今月|四半期|\bQ[1-4]\b|増えた|減った|落ちた|上がった/i;

/** 第三者伝言調・レビュー依頼でもシート実読に回す（「〜とのことですね」「見てほしい」等） */
export function indirectSheetReadOrReviewRequest(text: string): boolean {
  const t = text.trim();
  if (t.length > 400) return false;
  const sheetish = /(シート|スプシ|スプレッド|スプレッドシート|表|一覧|管理表)/i.test(t);
  const biz = /(購入代行|代行|管理|売上|在庫|受注|発注|POPUP|ポップアップ)/i.test(t);
  if (sheetish && /(見て|確認|チェック|教えて|読ん|把握|俯瞰|整理|まとめ|判断|所感|ざっくり|状況)/i.test(t)) {
    return true;
  }
  if (
    (/(とのこと|依頼|言われ|頼まれ|お願いされ)/i.test(t) || /見てほしい|確認してほしい|見て欲しい/i.test(t)) &&
    biz &&
    (sheetish || /データ|数字|実績/i.test(t))
  ) {
    return true;
  }
  return false;
}

export function roughSheetsBusinessRequest(text: string): boolean {
  const t = text.trim();
  if (
    /(シート|スプシ|スプレッド).{0,55}(の|で|は)?\s*(売上|売り上げ|集計|件数|合計|平均|一覧|データ|数字|\d{1,2}月|先月|今月|昨日|教えて|ください|いくら|どのくらい|どれくらい)/i.test(
      t
    )
  ) {
    return true;
  }
  if (/(売上|売り上げ|件数|集計|一覧|実績|予算).{0,35}(シート|スプシ|表で|表の|タブ)/i.test(t)) return true;
  // 購入代行】管理シート のように記号・中黒が挟まっても代行〜シートを拾う
  if (/(POPUP|ポップアップ|購入代行|代行|在庫|受注|発注|売上|仕入).{0,40}(シート|表)/i.test(t)) return true;
  if (
    /(売上|売り上げ|件数|合計).{0,18}(教えて|ください|いくら|どのくらい|どれくらい)/i.test(t) &&
    /(シート|表|スプシ|\d{1,2}月|先月|今月|タブ|データ)/i.test(t)
  ) {
    return true;
  }
  // 「○○シートを読んで」「管理シートを読んで」
  if (/(管理|業務|売上|在庫|代行).{0,12}シート.{0,12}(を)?(読み|見て|開いて|教えて)/i.test(t)) return true;
  if (/シート.{0,20}(を)?(読み|読んで|読み上げ|見て|見せて|開いて)/i.test(t)) return true;
  if (indirectSheetReadOrReviewRequest(t)) return true;
  return false;
}

/** 過去のユーザー発言にシート・業務表の話題があったか（続きの短文用） */
export function recentUserThreadHadSheetsTopic(recentUserMessages: string[]): boolean {
  for (const m of recentUserMessages) {
    const t = m.trim();
    if (!t) continue;
    if (SHEETS_TOPIC_EXPLICIT.test(t) || roughSheetsBusinessRequest(t)) return true;
  }
  return false;
}

const SHORT_SHEETS_CONTINUATION =
  /売上|売り上げ|読み|読んで|上げて|ざっくり|箇条書き|部分|担当|推移|タブ|シート|一覧|集計|教えて|出力|見せ|数字|いくら|件数|内訳/i;

/**
 * シート会話の続きの短文（「売上の部分」「ざっくり読み上げて」）をスレッド文脈と組み合わせて検出する。
 */
function looksLikeShortSheetsContinuation(text: string, recentUserMessages: string[]): boolean {
  const t = text.trim();
  if (t.length > 120) return false;
  if (!recentUserThreadHadSheetsTopic(recentUserMessages)) return false;
  return SHORT_SHEETS_CONTINUATION.test(t);
}

export function looksLikeSheetsThreadFollowUp(text: string, recentUserMessages: string[] = []): boolean {
  const t = text.trim();
  return (
    ANALYZE_OR_CONTINUE_SHEETS.test(t) ||
    SHEETS_NUMERIC_OR_OPINION_FOLLOWUP.test(t) ||
    roughSheetsBusinessRequest(t) ||
    looksLikeShortSheetsContinuation(t, recentUserMessages)
  );
}

/**
 * ブック ID が未特定でも、Sheets モジュールに回して「リンクを送って」と案内すべき依頼か。
 * （FAQ が空振りするループを防ぐ）
 */
export function explicitUnanchoredSheetReadIntent(text: string, recentUserMessages: string[]): boolean {
  const t = text.trim();
  if (roughSheetsBusinessRequest(t)) return true;
  if (indirectSheetReadOrReviewRequest(t)) return true;
  if (allowDefaultSheetPromotionWithoutUrl(t)) return true;
  if (looksLikeShortSheetsContinuation(t, recentUserMessages)) return true;
  if (/読み上げ|読んで|読み取って/.test(t) && /シート|表|スプシ|売上|管理|代行|推移|担当/i.test(t)) return true;
  return false;
}

/** 会話にスプレッドシート URL が無いとき、既定ブックへ昇格してよいか */
export function allowDefaultSheetPromotionWithoutUrl(text: string): boolean {
  const t = text.trim();
  return (
    ANALYZE_OR_CONTINUE_SHEETS.test(t) ||
    SHEETS_TOPIC_EXPLICIT.test(t) ||
    roughSheetsBusinessRequest(t) ||
    SHEETS_NUMERIC_OR_OPINION_FOLLOWUP.test(t)
  );
}
