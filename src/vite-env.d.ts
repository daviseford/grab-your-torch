/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Identity Platform OpenID Connect provider id for Discord sign-in, e.g.
   * "oidc.discord". Unset or malformed hides the Discord button entirely.
   * See docs/social-login-setup.md.
   */
  readonly VITE_AUTH_DISCORD_PROVIDER_ID?: string;
}
