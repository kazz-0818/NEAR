-- NEAR 専用テーブルをスキーマ near に移し、テーブル名に near_ プレフィックスを付ける（SERA の sera_* と同様の整理）。
-- 共有 Supabase の public にある SERA 用オブジェクトには触れない。

CREATE SCHEMA IF NOT EXISTS near;

-- 1) public 上でリネーム（FK は内部参照が追従する）
ALTER TABLE IF EXISTS public.inbound_messages RENAME TO near_inbound_messages;
ALTER TABLE IF EXISTS public.intent_runs RENAME TO near_intent_runs;
ALTER TABLE IF EXISTS public.tasks RENAME TO near_tasks;
ALTER TABLE IF EXISTS public.memos RENAME TO near_memos;
ALTER TABLE IF EXISTS public.reminders RENAME TO near_reminders;
ALTER TABLE IF EXISTS public.unsupported_requests RENAME TO near_unsupported_requests;
ALTER TABLE IF EXISTS public.implementation_suggestions RENAME TO near_implementation_suggestions;
ALTER TABLE IF EXISTS public.growth_user_sessions RENAME TO near_growth_user_sessions;
ALTER TABLE IF EXISTS public.growth_admin_sessions RENAME TO near_growth_admin_sessions;
ALTER TABLE IF EXISTS public.growth_hearing_items RENAME TO near_growth_hearing_items;
ALTER TABLE IF EXISTS public.capability_registry RENAME TO near_capability_registry;
ALTER TABLE IF EXISTS public.user_sheet_defaults RENAME TO near_user_sheet_defaults;
ALTER TABLE IF EXISTS public.outbound_messages RENAME TO near_outbound_messages;
ALTER TABLE IF EXISTS public.google_oauth_link_tokens RENAME TO near_google_oauth_link_tokens;
ALTER TABLE IF EXISTS public.user_google_oauth_accounts RENAME TO near_user_google_oauth_accounts;
ALTER TABLE IF EXISTS public.user_google_active_oauth RENAME TO near_user_google_active_oauth;
ALTER TABLE IF EXISTS public.user_sheet_pending_confirm RENAME TO near_user_sheet_pending_confirm;
ALTER TABLE IF EXISTS public.user_sheet_pending_pick RENAME TO near_user_sheet_pending_pick;
ALTER TABLE IF EXISTS public.agent_tool_runs RENAME TO near_agent_tool_runs;
ALTER TABLE IF EXISTS public.pending_tool_confirmations RENAME TO near_pending_tool_confirmations;
ALTER TABLE IF EXISTS public.agent_search_runs RENAME TO near_agent_search_runs;
ALTER TABLE IF EXISTS public.growth_funnel_events RENAME TO near_growth_funnel_events;
ALTER TABLE IF EXISTS public.growth_candidate_signals RENAME TO near_growth_candidate_signals;
ALTER TABLE IF EXISTS public.growth_signal_buckets RENAME TO near_growth_signal_buckets;
ALTER TABLE IF EXISTS public.line_user_profiles RENAME TO near_line_user_profiles;
ALTER TABLE IF EXISTS public.pending_perm_ops RENAME TO near_pending_perm_ops;
ALTER TABLE IF EXISTS public.user_roles RENAME TO near_user_roles;
ALTER TABLE IF EXISTS public.pending_clarifications RENAME TO near_pending_clarifications;
ALTER TABLE IF EXISTS public.improvement_candidates RENAME TO near_improvement_candidates;
ALTER TABLE IF EXISTS public.improvement_capsules RENAME TO near_improvement_capsules;
ALTER TABLE IF EXISTS public.routing_traces RENAME TO near_routing_traces;
ALTER TABLE IF EXISTS public.conversation_session_memory RENAME TO near_conversation_session_memory;

-- near_line_groups は既に near_ 接頭辞のため名称は据え置き、スキーマ移動のみ
ALTER TABLE IF EXISTS public.near_line_groups SET SCHEMA near;

-- 2) リネーム済みテーブルを near スキーマへ
ALTER TABLE IF EXISTS public.near_inbound_messages SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_intent_runs SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_tasks SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_memos SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_reminders SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_unsupported_requests SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_implementation_suggestions SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_user_sessions SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_admin_sessions SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_hearing_items SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_capability_registry SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_sheet_defaults SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_outbound_messages SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_google_oauth_link_tokens SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_google_oauth_accounts SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_google_active_oauth SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_sheet_pending_confirm SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_sheet_pending_pick SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_agent_tool_runs SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_pending_tool_confirmations SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_agent_search_runs SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_funnel_events SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_candidate_signals SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_growth_signal_buckets SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_line_user_profiles SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_pending_perm_ops SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_user_roles SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_pending_clarifications SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_improvement_candidates SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_improvement_capsules SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_routing_traces SET SCHEMA near;
ALTER TABLE IF EXISTS public.near_conversation_session_memory SET SCHEMA near;
