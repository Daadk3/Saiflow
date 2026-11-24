import { Suspense } from "react";
import SignupForm from "@/components/auth/SignupForm";

// The form reads the consent error from the URL. useSearchParams has to sit
// under Suspense or the page cannot be server-rendered.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
