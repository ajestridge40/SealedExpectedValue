import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/page";
import { DeleteAccountForm, ProfileForm } from "@/components/settings-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProfile, requireUser } from "@/lib/auth";
import { getGames } from "@/lib/data/catalog";
import { param } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/settings");
  const [profile, games] = await Promise.all([getProfile(), getGames()]);
  const sp = await searchParams;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description={`Signed in as ${user.email ?? "your account"}.`} />
      {param(sp, "updated") === "password" ? <Notice tone="success">Your password was updated.</Notice> : null}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          {profile ? <ProfileForm profile={profile} games={games} /> : <Notice tone="error">Profile not found.</Notice>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Price refresh</CardTitle>
          <CardDescription>
            Prices are refreshed for everyone once a day by a scheduled job (TCGCSV updates daily around 20:00 UTC).
            Refreshing more often would not produce newer prices.
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/forgot-password">Send a password reset email</Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Download everything stored about you.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <a href="/api/export/collection" download>
              <Download /> Collection (CSV)
            </a>
          </Button>
          <Button asChild>
            <a href="/api/export/account" download>
              <Download /> Full account (JSON)
            </a>
          </Button>
        </CardContent>
      </Card>
      <Card className="border-loss/40">
        <CardHeader>
          <CardTitle className="text-loss">Delete account</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}
