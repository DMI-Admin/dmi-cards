import Image from "next/image";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-[#070B1A] text-white grid grid-cols-1 lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between p-12 bg-[#0F0E38] border-r border-white/10">
        <div>
          <div className="relative h-24 w-24 mb-8">
            <Image
              src="/logo.png"
              alt="DevMaster Inc Logo"
              fill
              sizes="96px"
              className="object-contain"
              priority
            />
          </div>

          <p className="text-xs tracking-[0.35em] text-white/40 font-semibold mb-6">
            DEVMASTER INC
          </p>

          <h1 className="text-5xl font-bold leading-tight max-w-xl">
            DMI Admin Portal
          </h1>

          <p className="mt-6 text-white/60 text-lg max-w-lg">
            Internal access for DevMaster Inc only. Manage the DMI Cards
            platform, clients, templates, subscriptions, analytics, and
            business operations from one secure portal.
          </p>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <p className="text-3xl font-bold">Private</p>
              <p className="text-white/45 text-sm mt-2">
                Internal business access only
              </p>
            </div>

            <div className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <p className="text-3xl font-bold">Secure</p>
              <p className="text-white/45 text-sm mt-2">
                Protected admin authentication
              </p>
            </div>
          </div>

          <p className="text-sm text-white/35">
            Powered by DevMaster Inc
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden flex flex-col items-center">
            <div className="relative h-20 w-20 mb-4">
              <Image
                src="/logo.png"
                alt="DevMaster Inc Logo"
                fill
                sizes="80px"
                className="object-contain"
                priority
              />
            </div>

            <p className="text-xs tracking-[0.35em] text-white/40 font-semibold">
              DMI ADMIN PORTAL
            </p>
          </div>

          <SignIn
            appearance={{
              elements: {
                rootBox: "mx-auto",
                card: "bg-white/5 border border-white/10 shadow-2xl rounded-3xl",
                headerTitle: "text-white",
                headerSubtitle: "text-white/50",
                socialButtonsBlockButton:
                  "bg-white/10 border-white/10 text-white hover:bg-white/15",
                formFieldLabel: "text-white/70",
                formFieldInput:
                  "bg-[#101935] border-white/10 text-white rounded-xl",
                footerActionText: "text-white/50",
                footerActionLink: "text-[#AC00FF]",
                formButtonPrimary:
                  "bg-[#AC00FF] hover:bg-[#9900e6] text-white rounded-xl",
              },
            }}
          />

          <p className="mt-8 text-center text-xs text-white/30">
            Powered by DevMaster Inc
          </p>
        </div>
      </section>
    </main>
  );
}