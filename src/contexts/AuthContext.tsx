"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
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
