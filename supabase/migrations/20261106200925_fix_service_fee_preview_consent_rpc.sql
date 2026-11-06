-- Repair the preview opt-in RPC. This records the Owner's explicit preview
-- acknowledgement and starts the 30-day information-only preview atomically.
-- It never enables fees, invoices, collections, balance deductions, or feature locks.
CREATE OR REPLACE FUNCTION public.kasusaha_accept_service_fee_terms(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_workspace public.business_workspaces%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR coalesce(((auth.jwt() ->> 'is_anonymous')::boolean), false) THEN
    RAISE EXCEPTION 'Login Owner diperlukan untuk memulai pratinjau.';
  END IF;

  SELECT w.* INTO v_workspace
  FROM public.business_workspaces w
  JOIN public.business_members m ON m.business_id = w.id
  WHERE w.id = p_business_id
    AND w.owner_id = v_uid
    AND m.user_id = v_uid
    AND m.role = 'owner'
    AND m.active = true
  FOR UPDATE OF w;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hanya Owner usaha yang sah yang dapat memulai pratinjau.';
  END IF;

  UPDATE public.business_workspaces
  SET service_fee_consent_at = coalesce(service_fee_consent_at, now()),
      service_fee_trial_started_at = coalesce(service_fee_trial_started_at, now()),
      service_fee_terms_version = coalesce(service_fee_terms_version, '2026-11-v1')
  WHERE id = p_business_id
  RETURNING * INTO v_workspace;

  RETURN jsonb_build_object(
    'success', true,
    'trial_started_at', v_workspace.service_fee_trial_started_at,
    'consent_recorded', v_workspace.service_fee_consent_at IS NOT NULL,
    'terms_version', v_workspace.service_fee_terms_version,
    'trial_days', 30,
    'preview_only', true,
    'fee_enabled', false,
    'billing_enabled', false,
    'message', 'Persetujuan dan awal pratinjau tercatat. Ini bukan persetujuan penagihan; billing tetap nonaktif.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.kasusaha_accept_service_fee_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kasusaha_accept_service_fee_terms(uuid) TO authenticated;