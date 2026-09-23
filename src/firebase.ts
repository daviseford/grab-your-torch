// Import the functions you need from the SDKs you need
import {
  Analytics,
  initializeAnalytics,
  isSupported,
} from "firebase/analytics";
import { FirebaseOptions, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
} satisfies FirebaseOptions;

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Emulator wiring for the isolated auth-flow e2e suite (KTD6). Active only
// when Vite runs with `--mode e2e-auth` (see .env.e2e-auth and
// playwright.auth-flows.config.ts); every other mode is untouched. The demo-
// project guard makes it impossible for this mode to address production.
const isE2EAuthMode = import.meta.env.MODE === "e2e-auth";
if (
  isE2EAuthMode &&
  !import.meta.env.VITE_FIREBASE_PROJECT_ID?.startsWith("demo-")
) {
  throw new Error(
    `e2e-auth mode requires a demo- Firebase project id, got "${import.meta.env.VITE_FIREBASE_PROJECT_ID}". Refusing to start against non-emulator resources.`,
  );
}

// Emulator ports default to firebase.json; a local run whose defaults are
// taken by another process can move them with these variables.
const emulatorPort = (value: string | undefined, fallback: number) =>
  Number(value) || fallback;

// Initialize Firebase Authentication and get a reference to the service
// Use localStorage persistence so Playwright storageState can capture auth tokens
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);
if (isE2EAuthMode) {
  connectAuthEmulator(
    auth,
    `http://127.0.0.1:${emulatorPort(import.meta.env.VITE_EMULATOR_AUTH_PORT, 9099)}`,
    {
      disableWarnings: true,
    },
  );
}

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
if (isE2EAuthMode) {
  connectFirestoreEmulator(
    db,
    "127.0.0.1",
    emulatorPort(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT, 8080),
  );
}

// Initialize Cloud Realtime Database and get a reference to the service
export const rt_db = getDatabase(app);
if (isE2EAuthMode) {
  connectDatabaseEmulator(
    rt_db,
    "127.0.0.1",
    emulatorPort(import.meta.env.VITE_EMULATOR_DATABASE_PORT, 9000),
  );
}

// Initialize Google Analytics (GA4) in production builds only.
// Stays null in dev/test, so all tracking calls are no-ops there.
// Automatic page_view is disabled: gtag's first hit would snapshot the full
// URL before React can strip the one-time reset action code from
// /reset-password, and PageTracker already logs a sanitized page_view on
// every route change including the initial load.
export let analytics: Analytics | null = null;
if (
  typeof window !== "undefined" &&
  import.meta.env.PROD &&
  import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
) {
  isSupported().then((supported) => {
    if (supported) {
      analytics = initializeAnalytics(app, {
        config: { send_page_view: false },
      });
    }
  });
}

export default app;
