import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthScreen mode="login" />
    </Suspense>
  );
}
