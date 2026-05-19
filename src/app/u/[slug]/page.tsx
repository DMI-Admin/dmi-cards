import CardRenderer from "@/components/CardRenderer";
import { supabase } from "@/lib/supabase";
import { normalizeTemplate } from "@/lib/templates";

type PublicCardPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PublicCardPage({ params }: PublicCardPageProps) {
  const { slug } = await params;

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (cardError || !card) {
    return (
      <PublicMessage
        title="Card not found"
        message="The digital card you are looking for does not exist."
      />
    );
  }

  if (!(card.status === "published" || card.is_published)) {
    return (
      <PublicMessage
        title="This card is not currently published."
        message="Please contact the card owner or try again later."
      />
    );
  }

  const { data: template } = await supabase
    .from("templates")
    .select("*")
    .eq("id", card.template_id)
    .eq("status", "published")
    .maybeSingle();

  if (!template) {
    return (
      <PublicMessage
        title="Card template unavailable"
        message="This digital card cannot be displayed right now."
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#070B1A] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <div className="w-full">
          <CardRenderer
            mode="public"
            template={normalizeTemplate(template)}
            cardData={card}
          />
        </div>
      </div>
    </main>
  );
}

function PublicMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070B1A] px-6 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl shadow-[#AC00FF]/10">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/50">{message}</p>
      </div>
    </main>
  );
}
