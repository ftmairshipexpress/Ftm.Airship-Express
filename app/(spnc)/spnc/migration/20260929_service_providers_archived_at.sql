ALTER TABLE public.service_providers
ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS service_providers_archived_at_idx
ON public.service_providers (archived_at);