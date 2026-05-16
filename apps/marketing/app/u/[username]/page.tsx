import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getConfiguredAppOrigin } from "@/lib/pensive";
import {
  getPublicBooksByOwner,
  getPublicProfile,
} from "@/lib/public-books";
import { BOOK_GRID_CLASS } from "@pensive/shared/ui/book-card";
import { ProfileEditLink } from "@/components/ProfileEditLink";
import { PublicBookCard } from "@/components/PublicBookCard";

export const dynamic = "force-dynamic";

type Props = {
  params: {
    username: string;
  };
};

function getInitials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getPublicProfile(params.username);

  if (!profile) {
    return {
      title: "Profile Not Found | Pensive",
    };
  }

  return {
    title: `${profile.name || `@${profile.username}`} | Pensive`,
    description:
      profile.intro || `Browse public books by @${profile.username} on Pensive.`,
    openGraph: {
      title: `${profile.name || `@${profile.username}`} | Pensive`,
      description:
        profile.intro || `Browse public books by @${profile.username} on Pensive.`,
      images: profile.profile_pic ? [profile.profile_pic] : ["/og-image.png"],
    },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await getPublicProfile(params.username);

  if (!profile) {
    notFound();
  }

  if (params.username !== profile.username) {
    redirect(`/u/${encodeURIComponent(profile.username)}`);
  }

  const books = await getPublicBooksByOwner(profile.user_id);
  const appOrigin = getConfiguredAppOrigin();
  const displayName = profile.name || `@${profile.username}`;

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <header className="mb-10 rounded-3xl border bg-card p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-2xl font-semibold text-muted-foreground">
            {profile.profile_pic ? (
              <img
                src={profile.profile_pic}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              getInitials(profile.username)
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1">
              <h1 className="text-4xl font-bold">{displayName}</h1>
              {profile.name && (
                <p className="text-lg text-muted-foreground">
                  @{profile.username}
                </p>
              )}
            </div>

            {profile.intro && (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {profile.intro}
              </p>
            )}

            <ProfileEditLink profileUserId={profile.user_id} appOrigin={appOrigin} />
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-2xl font-semibold">Published Books</h2>
          <p className="mt-1 text-muted-foreground">
            {books.length} {books.length === 1 ? "book" : "books"} published
          </p>
        </div>
      </header>

      {books.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">
          No published books yet.
        </div>
      ) : (
        <div className={BOOK_GRID_CLASS}>
          {books.map((book) => (
            <PublicBookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </main>
  );
}
