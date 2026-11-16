ALTER TABLE public.messages
  ADD COLUMN provider_connection_id uuid NULL;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_provider_connection_id_fkey
  FOREIGN KEY (provider_connection_id)
  REFERENCES public.whatsapp_connections(id);

DROP INDEX public.idx_messages_conversation_message_id;

CREATE UNIQUE INDEX idx_messages_legacy_conversation_message_id
  ON public.messages (conversation_id, message_id)
  WHERE provider_connection_id IS NULL
    AND message_id IS NOT NULL;

CREATE UNIQUE INDEX idx_messages_provider_connection_message_id
  ON public.messages (provider_connection_id, message_id)
  WHERE provider_connection_id IS NOT NULL
    AND message_id IS NOT NULL;

ALTER TABLE public.pending_message_statuses
  ADD COLUMN provider_connection_id uuid NULL;

ALTER TABLE public.pending_message_statuses
  ADD CONSTRAINT pending_message_statuses_provider_connection_id_fkey
  FOREIGN KEY (provider_connection_id)
  REFERENCES public.whatsapp_connections(id);

ALTER TABLE public.pending_message_statuses
  DROP CONSTRAINT pending_message_statuses_account_wamid_status_key;

CREATE UNIQUE INDEX pending_message_statuses_legacy_key
  ON public.pending_message_statuses (account_id, wamid, status)
  WHERE provider_connection_id IS NULL;

CREATE UNIQUE INDEX pending_message_statuses_provider_key
  ON public.pending_message_statuses (account_id, provider_connection_id, wamid, status)
  WHERE provider_connection_id IS NOT NULL;
