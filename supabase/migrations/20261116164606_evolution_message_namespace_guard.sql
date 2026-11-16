CREATE OR REPLACE FUNCTION public.guard_message_provider_connection_namespace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_link_changed boolean := false;
  v_connection_account_id uuid;
  v_conversation_account_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_link_changed := NEW.provider_connection_id IS NOT NULL;
  ELSE
    v_link_changed := OLD.provider_connection_id IS DISTINCT FROM NEW.provider_connection_id;
    IF v_link_changed
       OR (NEW.provider_connection_id IS NOT NULL
           AND OLD.conversation_id IS DISTINCT FROM NEW.conversation_id) THEN
      v_link_changed := true;
    END IF;
  END IF;

  IF v_link_changed AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'provider connection namespace is server controlled'
      USING ERRCODE = '42501';
  END IF;

  IF v_link_changed AND NEW.provider_connection_id IS NOT NULL THEN
    SELECT c.account_id
      INTO v_connection_account_id
      FROM public.whatsapp_connections AS c
     WHERE c.id = NEW.provider_connection_id;

    SELECT c.account_id
      INTO v_conversation_account_id
      FROM public.conversations AS c
     WHERE c.id = NEW.conversation_id;

    IF v_connection_account_id IS NOT NULL
       AND v_conversation_account_id IS NOT NULL
       AND v_connection_account_id IS DISTINCT FROM v_conversation_account_id THEN
      RAISE EXCEPTION 'provider connection and conversation must belong to the same account'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER messages_guard_provider_connection_namespace
  BEFORE INSERT OR UPDATE OF provider_connection_id, conversation_id
  ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_message_provider_connection_namespace();
