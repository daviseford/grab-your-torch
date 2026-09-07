# Social login setup (Google)

The auth modal offers "Continue with Google" above the email form. The client
code is in `src/components/Auth/SocialSignIn.tsx` and `socialProviders.ts`.
The button uses Firebase's `signInWithPopup`; nothing else in the app changes,
because a Google account is an ordinary Firebase Auth user with the same
`users/{uid}` document a password registration creates.

Everything below is one-time configuration in the Firebase and Google Cloud
consoles. None of it is code.

## How a Google sign-in behaves

- **First sign-in** creates the Firebase Auth account, copies the Google
  display name into the profile, and writes `users/{uid}` with `uid`, `email`,
  and `displayName`. GA4 logs `sign_up` with `method: google`.
- **Return sign-in** just signs in. GA4 logs `login`.
- **Closing the popup** releases the form with no error.
- **Same email, existing password account.** Google is a trusted provider, so
  a Google sign-in for an email that already has a password account links to
  that account (Firebase's default "one account per email" setting).

## Console setup

The Google button always renders. Until the provider is enabled, clicking it
shows "This sign-in method is not available right now."

1. In the Firebase console, open Authentication, Sign-in method, Add new
   provider, choose **Google**, and enable it. Pick the project support
   email and save.
2. Under Authentication, Settings, **Authorized domains** must include
   `grabyourtorch.com` and `localhost`. Firebase adds the
   `*.firebaseapp.com` and `*.web.app` hosting domains itself.
3. Make the consent screen say "to continue to grabyourtorch.com" instead of
   the `firebaseapp.com` domain. This is done for production: the
   `VITE_FIREBASE_AUTH_DOMAIN` repository variable is `grabyourtorch.com`,
   and the Google Cloud OAuth client ("Web client (auto created by Google
   Service)" under APIs & Services > Credentials) lists
   `https://grabyourtorch.com/__/auth/handler` as an authorized redirect URI
   and `https://grabyourtorch.com` as an authorized JavaScript origin.
   Firebase Hosting already serves the `/__/auth/handler` path on the custom
   domain. Repeat both console entries if the OAuth client is ever recreated.

## Testing

- Unit: `yarn test src/components/Auth` covers the provider definition,
  display name resolution, and error mapping.
- Emulator e2e: `yarn e2e:auth-flows` includes a Google sign-in test that
  drives the Auth emulator's fake account picker for a brand-new account and
  a returning one, then checks the `users/{uid}` document.
- Production smoke test after enabling Google: open the site signed out,
  click Continue with Google, pick an account, and confirm the navbar shows
  the account and Firestore has the new `users/{uid}` document.
