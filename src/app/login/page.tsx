import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn, signInWithGoogle } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { Notice } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-redirect";
import { param } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNext(param(sp, "next"));
  if (await getUser()) redirect(next);
  const error = param(sp, "error");
  const googleEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "1";
  return (
    <AuthShell
      title="Sign in"
      description="Track your sealed products and cards."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {error ? (
        <Notice tone="error" className="mb-4">
          {error === "link" ? "That sign-in link is invalid or has expired." : "Sign-in with Google failed."}
        </Notice>
      ) : null}
      <AuthForm action={signIn} mode="signin" next={next} />
      {googleEnabled ? (
        <form action={signInWithGoogle} className="mt-3">
          <input type="hidden" name="next" value={next} />
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>
      ) : null}
    </AuthShell>
  );
}
