import type { Metadata } from "next";
import { updatePassword } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  await requireUser("/auth/update-password");
  return (
    <AuthShell title="Choose a new password">
      <AuthForm action={updatePassword} mode="update" />
    </AuthShell>
  );
}
