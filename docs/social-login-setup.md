# Social login setup (Google and Discord)

The auth modal offers "Continue with Google" and, when configured, "Continue
with Discord" above the email form. The client code is in
`src/components/Auth/SocialSignIn.tsx` and `socialProviders.ts`. Both buttons
use Firebase's `signInWithPopup`; nothing else in the app changes, because a
social account is an ordinary Firebase Auth user with the same `users/{uid}`
document a password registration creates.

Everything below is one-time configuration in the Firebase, Google Cloud, and
Discord consoles. None of it is code.

## How a social sign-in behaves

- **First sign-in** creates the Firebase Auth account, copies the provider's
  display name into the profile, and writes `users/{uid}` with `uid`, `email`,
  and `displayName`. GA4 logs `sign_up` with `method: google|discord`.
- **Return sign-in** just signs in. GA4 logs `login`.
- **Closing the popup** releases the form with no error.
- **Same email, different method.** Google is a trusted provider, so a Google
  sign-in for an email that already has a password account links to that
  account (Firebase's default "one account per email" setting). Discord is
  not trusted, so the same case surfaces the "account already exists with a
  different sign-in method" message and the user signs in the old way.

## Google (required for the button to work)

The Google button always renders. Until the provider is enabled, clicking it
shows "This sign-in method is not available right now."

1. In the Firebase console, open Authentication, Sign-in method, Add new
   provider, choose **Google**, and enable it. Pick the project support
   email and save.
2. Under Authentication, Settings, **Authorized domains** must include
   `grabyourtorch.com` and `localhost`. Firebase adds the
   `*.firebaseapp.com` and `*.web.app` hosting domains itself.
3. Optional, recommended: make the consent screen say "to continue to
   grabyourtorch.com" instead of the `firebaseapp.com` domain. Set the
   `VITE_FIREBASE_AUTH_DOMAIN` repository variable to `grabyourtorch.com`.
   Firebase Hosting already serves the `/__/auth/handler` path on the custom
   domain, so this only needs the Google Cloud OAuth client updated: Google
   Cloud console > APIs & Services > Credentials > the auto-created "Web
   client (auto created by Google Service)" > Authorized redirect URIs > add
   `https://grabyourtorch.com/__/auth/handler`.

## Discord (optional)

Firebase Auth has no native Discord provider. Discord publishes an OpenID
Connect issuer (`https://discord.com/.well-known/openid-configuration`), so
it plugs in through an Identity Platform OIDC provider. This requires
upgrading the Firebase project to Identity Platform, which is free for this
project's usage tier but needs the Blaze (pay as you go) plan enabled.

1. **Discord app.** In the [Discord Developer Portal](https://discord.com/developers/applications),
   create a New Application and open its OAuth2 page. Note the Client ID and
   generate a Client Secret. Add the redirect URI
   `https://<VITE_FIREBASE_AUTH_DOMAIN>/__/auth/handler`, i.e.
   `https://survivor-fantasy-51c4b.firebaseapp.com/__/auth/handler`, plus the
   custom-domain form if step 3 above is done.
2. **Identity Platform.** In the Firebase console, open Authentication,
   Sign-in method, Add new provider, and choose **OpenID Connect** (this
   prompts the Identity Platform upgrade the first time). Grant type: Code
   flow. Name: `discord`. Client ID and Client secret from step 1. Issuer:
   `https://discord.com`. Save. The provider id shown is `oidc.discord`.
3. **Build variable.** Add the repository variable
   `VITE_AUTH_DISCORD_PROVIDER_ID` = `oidc.discord` under Settings > Secrets
   and variables > Actions > Variables. Both workflows already pass it to
   the build; an unset variable simply hides the button. Set the same value
   in a local `.env` to see the button in `yarn dev`.

The client requests the `identify` and `email` scopes on top of `openid`.
Discord returns the display name as `global_name` and the handle as
`preferred_username`; the app stores whichever exists first.

## Testing

- Unit: `yarn test src/components/Auth` covers provider selection, display
  name resolution, and error mapping.
- Emulator e2e: `yarn e2e:auth-flows` includes a Google sign-in test that
  drives the Auth emulator's fake account picker for a brand-new account and
  a returning one, then checks the `users/{uid}` document. Discord is not
  exercised there because `.env.e2e-auth` sets no provider id.
- Production smoke test after enabling Google: open the site signed out,
  click Continue with Google, pick an account, and confirm the navbar shows
  the account and Firestore has the new `users/{uid}` document.
