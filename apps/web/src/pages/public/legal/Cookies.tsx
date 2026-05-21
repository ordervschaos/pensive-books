import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCookieConsent } from "@/hooks/useCookieConsent";

export const Cookies = () => {
  const { consent, accept, reject, reset } = useCookieConsent();

  const status =
    consent === "accepted"
      ? "Analytics accepted"
      : consent === "rejected"
        ? "Analytics rejected"
        : "Not set";

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-4xl font-bold mb-8">Cookie Policy</h1>
      <Card>
        <CardContent className="p-6 prose prose-slate dark:prose-invert max-w-none">
          <p className="text-sm text-muted-foreground mb-4">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">What are cookies?</h2>
            <p>
              Cookies are small text files placed on your device when you visit
              a website. We also use similar technologies such as your browser's
              local storage.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Cookies we use</h2>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              Strictly necessary
            </h3>
            <p>
              These are required for the site to function (sign-in, sessions,
              security). They cannot be switched off and do not require your
              consent under EU law.
            </p>
            <ul className="list-disc pl-6">
              <li>
                <strong>sb-*</strong> — Supabase authentication session, set
                when you sign in. Persists until you sign out or the session
                expires.
              </li>
              <li>
                <strong>pensive.cookie-consent</strong> — Stored in your
                browser's local storage to remember your cookie choice on this
                device.
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">
              Analytics (optional)
            </h3>
            <p>
              Loaded only if you accept. We use Google Analytics 4 to
              understand aggregate usage — which pages are visited, from which
              countries, and on what devices. We do not use this data to
              advertise to you and we do not share it with third parties beyond
              Google for the purpose of providing the analytics service.
            </p>
            <ul className="list-disc pl-6">
              <li>
                <strong>_ga, _ga_*</strong> — Google Analytics. Used to
                distinguish unique visitors. Expires after 2 years.
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">Your choices</h2>
            <p className="mb-4">
              Current setting: <strong>{status}</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={accept}
                variant={consent === "accepted" ? "default" : "outline"}
              >
                Accept analytics
              </Button>
              <Button
                onClick={reject}
                variant={consent === "rejected" ? "default" : "outline"}
              >
                Reject analytics
              </Button>
              {consent !== "unknown" && (
                <Button onClick={reset} variant="ghost">
                  Reset choice
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              You can change your mind at any time by returning to this page.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p>
              Questions about cookies or privacy? Email us at
              toanzalansari@gmail.com.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};

export default Cookies;
