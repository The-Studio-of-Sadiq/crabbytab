"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/lib/firebase";

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  configured: boolean;
  isGlobalAdmin: boolean;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Reauthenticates with the current password, then sets the new one (signed-in users only). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setLoading(false);
      return;
    }

    let active = true;
    let authChange = 0;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const currentChange = ++authChange;
      setUser(null);
      setIsGlobalAdmin(false);
      setLoading(true);

      void (async () => {
        let nextIsGlobalAdmin = false;
        if (firebaseUser) {
          try {
            const token = await firebaseUser.getIdToken();
            const response = await fetch("/api/auth/access", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const result = await response.json() as {
              error?: string;
              isGlobalAdmin?: boolean;
              refreshToken?: boolean;
            };
            if (!response.ok) throw new Error(result.error || "Could not check administrator access.");
            nextIsGlobalAdmin = result.isGlobalAdmin === true;
            if (result.refreshToken) await firebaseUser.getIdToken(true);
          } catch (error) {
            console.error("Could not verify global administrator access:", error);
          }
        }

        if (!active || currentChange !== authChange) return;
        setUser(firebaseUser);
        setIsGlobalAdmin(nextIsGlobalAdmin);
        setLoading(false);
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const resetPassword = async (email: string) => {
    if (!auth) throw new Error("Firebase Auth is not configured.");
    await sendPasswordResetEmail(auth, email);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const current = auth?.currentUser;
    if (!auth || !current) throw new Error("Sign in before changing your password.");
    if (!current.email) throw new Error("This account has no email address, so its password cannot be changed here.");
    // Firebase refuses a password change on an old sign-in, so confirm the current password first.
    await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, currentPassword));
    await updatePassword(current, newPassword);
  };

  const logout = async () => {
    if (auth) {
      await signOut(auth);
    }
    setUser(null);
    setIsGlobalAdmin(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        configured: isFirebaseConfigured,
        isGlobalAdmin,
        signInWithEmail,
        resetPassword,
        changePassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
