import type { Metadata } from "next";
import { AccountClient } from "./AccountClient";

export const metadata: Metadata = {
  title: "Account",
  description: "Sign in to manage your TabBurrow account and PRO billing.",
};

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <AccountClient />
    </div>
  );
}
