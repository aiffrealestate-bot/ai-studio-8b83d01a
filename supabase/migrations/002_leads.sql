-- =============================================================================
-- Migration: 002_leads.sql
-- Description: Creates the leads table for the law firm landing page
--              contact/inquiry form with Row Level Security.
-- =============================================================================

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Enum: legal_matter_type
-- Must match the LegalMatterTypeEnum defined in lib/validation.ts
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'legal_matter_type') THEN
    CREATE TYPE legal_matter_type AS ENUM (
      'corporate',
      'real_estate',
      'family_law',
      'criminal_defense',
      'labor_employment',
      'intellectual_property',
      'litigation',
      'tax_law',
      'immigration',
      'banking_finance',
      'data_privacy',
      'other'
    );
  END IF;
END;
$$;

-- =============================================================================
-- Enum: preferred_contact_method
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'preferred_contact_method') THEN
    CREATE TYPE preferred_contact_method AS ENUM (
      'phone',
      'email',
      'whatsapp'
    );
  END IF;
END;
$$;

-- =============================================================================
-- Enum: lead_status
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_status') THEN
    CREATE TYPE lead_status AS ENUM (
      'new',
      'contacted',
      'qualified',
      'converted',
      'closed'
    );
  END IF;
END;
$$;

-- =============================================================================
-- Table: leads
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  -- Primary key
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact information
  full_name         TEXT        NOT NULL CHECK (char_length(full_name) >= 2 AND char_length(full_name) <= 120),
  phone             TEXT        NOT NULL CHECK (char_length(phone) <= 20),
  email             TEXT        NOT NULL CHECK (char_length(email) <= 254 AND email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'),

  -- Legal inquiry details
  matter_type       legal_matter_type    NOT NULL,
  message           TEXT        NOT NULL CHECK (char_length(message) >= 10 AND char_length(message) <= 2000),
  preferred_contact preferred_contact_method NOT NULL DEFAULT 'email',

  -- CRM / pipeline status
  status            lead_status NOT NULL DEFAULT 'new',

  -- Attribution & analytics
  source_url        TEXT,
  ip_address        INET,
  user_agent        TEXT,

  -- Internal notes (staff only)
  internal_notes    TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at      TIMESTAMPTZ
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_matter_type ON public.leads (matter_type);
CREATE INDEX IF NOT EXISTS idx_leads_email       ON public.leads (email);

-- =============================================================================
-- Trigger: auto-update updated_at on row modification
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating to support idempotent migrations
DROP POLICY IF EXISTS "leads_insert_anon"        ON public.leads;
DROP POLICY IF EXISTS "leads_select_authenticated" ON public.leads;
DROP POLICY IF EXISTS "leads_update_authenticated" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_authenticated" ON public.leads;

-- Policy 1: Anonymous users can INSERT new leads (public contact form)
--           No SELECT/UPDATE/DELETE allowed for anonymous users.
CREATE POLICY "leads_insert_anon"
  ON public.leads
  FOR INSERT
  TO anon
  WITH CHECK (
    -- Prevent inserting reserved/internal fields via the public API
    status = 'new'
    AND internal_notes IS NULL
    AND contacted_at IS NULL
  );

-- Policy 2: Authenticated staff can SELECT all leads
CREATE POLICY "leads_select_authenticated"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy 3: Authenticated staff can UPDATE leads (e.g. update status, add notes)
CREATE POLICY "leads_update_authenticated"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy 4: Authenticated staff can DELETE leads if needed
CREATE POLICY "leads_delete_authenticated"
  ON public.leads
  FOR DELETE
  TO authenticated
  USING (true);

-- =============================================================================
-- Comments / documentation
-- =============================================================================
COMMENT ON TABLE  public.leads                    IS 'Inquiry leads submitted via the law firm landing page contact form.';
COMMENT ON COLUMN public.leads.id                 IS 'Unique identifier for each lead.';
COMMENT ON COLUMN public.leads.full_name          IS 'Full name of the prospective client.';
COMMENT ON COLUMN public.leads.phone              IS 'Contact phone number (Israeli or international format).';
COMMENT ON COLUMN public.leads.email              IS 'Contact email address (lowercase, validated format).';
COMMENT ON COLUMN public.leads.matter_type        IS 'Category of legal matter as selected by the client.';
COMMENT ON COLUMN public.leads.message            IS 'Free-text description of the legal matter provided by the client.';
COMMENT ON COLUMN public.leads.preferred_contact  IS 'Preferred contact method: phone, email, or whatsapp.';
COMMENT ON COLUMN public.leads.status             IS 'CRM pipeline status of the lead.';
COMMENT ON COLUMN public.leads.source_url         IS 'Referrer or origin URL from which the form was submitted.';
COMMENT ON COLUMN public.leads.ip_address         IS 'IP address of the submitter (stored only in production for abuse prevention).';
COMMENT ON COLUMN public.leads.user_agent         IS 'User-Agent string from the submitter browser.';
COMMENT ON COLUMN public.leads.internal_notes     IS 'Staff-only internal notes about this lead (not visible to the client).';
COMMENT ON COLUMN public.leads.contacted_at       IS 'Timestamp of when the lead was first contacted by the firm.';
