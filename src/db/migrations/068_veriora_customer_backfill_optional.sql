-- Veliora Vegapunk: 既存 conversations から identity / link を INSERT のみで生成
-- 自動 merge は行わない。表示名一致は merge_candidates のみ。

WITH missing AS (
  SELECT DISTINCT
    c.line_user_id,
    a.agent_key,
    a.agent_key || '_line' AS channel_key
  FROM veriora.conversations c
  JOIN veriora.ai_agents a ON a.id = c.agent_id
  WHERE c.line_user_id IS NOT NULL AND btrim(c.line_user_id) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM veriora.customer_identities ci
      WHERE ci.provider = 'line'
        AND ci.channel_key = a.agent_key || '_line'
        AND ci.external_user_id = c.line_user_id
    )
),
new_customers AS (
  INSERT INTO veriora.customers (status, metadata)
  SELECT 'active', jsonb_build_object('backfill', true, 'source', '068')
  FROM missing
  RETURNING id
),
numbered AS (
  SELECT m.*, nc.id AS customer_id
  FROM (
    SELECT *, row_number() OVER () AS rn FROM missing
  ) m
  JOIN (
    SELECT id, row_number() OVER () AS rn FROM new_customers
  ) nc ON m.rn = nc.rn
)
INSERT INTO veriora.customer_identities (
  customer_id, provider, channel_key, agent_key, external_user_id, linked_by
)
SELECT customer_id, 'line', channel_key, agent_key, line_user_id, 'auto'
FROM numbered
ON CONFLICT (provider, channel_key, external_user_id) DO NOTHING;

INSERT INTO veriora.customer_conversation_links (customer_id, conversation_id, agent_key, link_reason, confidence)
SELECT ci.customer_id, c.id, a.agent_key, 'backfill_068', 1.0
FROM veriora.conversations c
JOIN veriora.ai_agents a ON a.id = c.agent_id
JOIN veriora.customer_identities ci
  ON ci.provider = 'line'
 AND ci.channel_key = a.agent_key || '_line'
 AND ci.external_user_id = c.line_user_id
WHERE c.line_user_id IS NOT NULL
ON CONFLICT (customer_id, conversation_id) DO NOTHING;

UPDATE veriora.conversations conv
SET customer_id = ci.customer_id
FROM veriora.ai_agents a,
     veriora.customer_identities ci
WHERE conv.agent_id = a.id
  AND ci.provider = 'line'
  AND ci.channel_key = a.agent_key || '_line'
  AND ci.external_user_id = conv.line_user_id
  AND conv.customer_id IS NULL
  AND conv.line_user_id IS NOT NULL;

INSERT INTO veriora.customer_merge_candidates (customer_id_a, customer_id_b, reason, score, status, metadata)
SELECT
  LEAST(c1.customer_id, c2.customer_id),
  GREATEST(c1.customer_id, c2.customer_id),
  'display_name_match_backfill',
  0.3,
  'pending',
  jsonb_build_object('display_name', c1.external_display_name)
FROM veriora.customer_identities c1
JOIN veriora.customer_identities c2
  ON c1.customer_id < c2.customer_id
 AND c1.external_display_name IS NOT NULL
 AND btrim(c1.external_display_name) = btrim(c2.external_display_name)
 AND btrim(c1.external_display_name) <> ''
 AND c1.external_user_id <> c2.external_user_id
WHERE NOT EXISTS (
  SELECT 1 FROM veriora.customer_merge_candidates m
  WHERE m.customer_id_a = LEAST(c1.customer_id, c2.customer_id)
    AND m.customer_id_b = GREATEST(c1.customer_id, c2.customer_id)
    AND m.status = 'pending'
);
