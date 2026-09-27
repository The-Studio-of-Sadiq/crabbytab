import { Suspense } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <AuthScreen mode="reset" />
    </Suspense>
  );
}
