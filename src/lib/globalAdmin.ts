import type { Auth } from "firebase-admin/auth";

export function getGlobalAdminUids(): Set<string> {
  return new Set(
    (process.env.FIREBASE_ADMIN_UIDS || "")
      .split(/[,\s]+/)
      .map((uid) => uid.trim())
      .filter(Boolean)
  );
}

export function isGlobalAdminUid(uid: string): boolean {
  return getGlobalAdminUids().has(uid);
}

export async function synchronizeGlobalAdminClaim(auth: Auth, uid: string) {
  const isGlobalAdmin = isGlobalAdminUid(uid);
  const user = await auth.getUser(uid);
  const currentClaim = user.customClaims?.globalAdmin === true;

  if (currentClaim !== isGlobalAdmin) {
    await auth.setCustomUserClaims(uid, {
      ...user.customClaims,
      globalAdmin: isGlobalAdmin,
    });
  }

  return { isGlobalAdmin, refreshToken: currentClaim !== isGlobalAdmin };
}
