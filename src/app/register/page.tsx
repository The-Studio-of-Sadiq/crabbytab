import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export default function RegisterPage() {
  return (
    <Suspense>
      <AuthScreen mode="register" />
    </Suspense>
  );
}
