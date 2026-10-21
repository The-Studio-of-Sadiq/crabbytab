import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service account JSON.");
    }

    if (typeof serviceAccount.privateKey === "string") {
      serviceAccount.privateKey = serviceAccount.privateKey.replace(/\\n/g, "\n");
    }

    return initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
}

/**
 * Whether admin credentials are configured (a service-account JSON or a credentials file). Pages
 * that only enrich the site, such as the sitemap, check this to degrade quietly instead of failing.
 */
export function hasAdminCredentials(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
