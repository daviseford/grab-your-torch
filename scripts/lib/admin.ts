import { config } from "dotenv";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import * as fs from "fs";
import * as path from "path";

config({ override: true });

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
// FIREBASE_PRIVATE_KEY_PATH lets a git worktree use the main checkout's key
// without copying it.
const keyPath =
  process.env.FIREBASE_PRIVATE_KEY_PATH ??
  path.join(PROJECT_ROOT, "firebase-private-key.json");

if (!fs.existsSync(keyPath)) {
  console.error(
    "Missing firebase-private-key.json in project root. Download from Firebase Console > Project Settings > Service accounts.",
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf-8"));

const databaseURL = process.env.VITE_FIREBASE_DATABASE_URL;

const app = initializeApp({
  credential: cert(serviceAccount),
  // Set explicitly so app.options.projectId is populated — callers log it so
  // the operator can confirm which project they are about to write to.
  projectId: serviceAccount.project_id,
  ...(databaseURL ? { databaseURL } : {}),
});

export const adminApp = app;
export const adminAuth = getAuth(app);
