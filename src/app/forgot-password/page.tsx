import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="We'll email you a link to choose a new password."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <AuthForm action={requestPasswordReset} mode="reset" />
    </AuthShell>
  );
}
