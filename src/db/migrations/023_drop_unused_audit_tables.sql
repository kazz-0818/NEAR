-- アプリから未参照の監査・クールダウン用テーブルを削除（002/010 での新規作成も廃止済み）。
-- 既存 DB にだけ残っている場合に DROP する。

DROP TABLE IF EXISTS growth_execution_log CASCADE;
DROP TABLE IF EXISTS admin_notify_log CASCADE;
