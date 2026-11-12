-- Up Migration
-- Company login with SAML 2.0 as well as OpenID Connect (launch plan,
-- product gap 10.31). An organization uses one or the other.
ALTER TABLE tenant_sso
  ADD COLUMN protocol text NOT NULL DEFAULT 'oidc' CHECK (protocol IN ('oidc', 'saml')),
  -- SAML: the identity provider's sign-in address, its signing certificate
  -- (PEM) and, optionally, its entity ID (checked against the response).
  ADD COLUMN saml_entry_point text,
  ADD COLUMN saml_idp_cert text,
  ADD COLUMN saml_idp_issuer text,
  ALTER COLUMN issuer DROP NOT NULL,
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_secret_sealed DROP NOT NULL;

-- Down Migration
DELETE FROM tenant_sso WHERE protocol = 'saml';
ALTER TABLE tenant_sso
  ALTER COLUMN client_secret_sealed SET NOT NULL,
  ALTER COLUMN client_id SET NOT NULL,
  ALTER COLUMN issuer SET NOT NULL,
  DROP COLUMN saml_idp_issuer,
  DROP COLUMN saml_idp_cert,
  DROP COLUMN saml_entry_point,
  DROP COLUMN protocol;
