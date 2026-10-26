import type { Metadata } from "next";
import Link from "next/link";
import { signUp } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Your collection is private to you. Catalog and prices are public."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm action={signUp} mode="signup" />
    </AuthShell>
  );
}
