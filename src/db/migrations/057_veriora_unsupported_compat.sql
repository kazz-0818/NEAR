-- Veliora: read-only views over NEAR growth tables (legacy veliora.* views unchanged)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'near' AND table_name = 'near_unsupported_requests'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.unsupported_requests AS
      SELECT * FROM near.near_unsupported_requests
    $v$;
    COMMENT ON VIEW veriora.unsupported_requests IS
      'Compat: near.near_unsupported_requests (read). Canonical writes remain on near.*';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'near' AND table_name = 'near_implementation_suggestions'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW veriora.implementation_suggestions AS
      SELECT * FROM near.near_implementation_suggestions
    $v$;
    COMMENT ON VIEW veriora.implementation_suggestions IS
      'Compat: near.near_implementation_suggestions (read)';
  END IF;
END $$;
