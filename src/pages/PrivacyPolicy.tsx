import { Card, CardContent } from "@/components/ui/card";

export const PrivacyPolicy = () => {
  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
      <Card>
        <CardContent className="p-6 prose prose-slate dark:prose-invert max-w-none">
          <p className="text-sm text-muted-foreground mb-4">Last updated: {new Date().toLocaleDateString()}</p>
          
          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Information We Collect</h2>
            <p>We collect information that you provide directly to us when you:</p>
            <ul className="list-disc pl-6 mb-4">
              <li>Create an account</li>
              <li>Create or edit books and pages</li>
              <li>Collaborate with other users</li>
              <li>Contact us for support</li>
            </ul>
            <p>This information may include:</p>
            <ul className="list-disc pl-6">
              <li>Name and email address</li>
              <li>Profile information</li>
              <li>Content you create, upload, or share</li>
              <li>Communications with other users</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6">
              <li>Provide and maintain our services</li>
              <li>Process and fulfill your requests</li>
              <li>Send you technical notices and updates</li>
              <li>Respond to your comments and questions</li>
              <li>Improve our services</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Information Sharing</h2>
            <p>We do not sell your personal information. We may share your information:</p>
            <ul className="list-disc pl-6">
              <li>With other users you collaborate with</li>
              <li>With service providers who assist in our operations</li>
              <li>When required by law</li>
              <li>To protect rights and safety</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Data Security</h2>
            <p>We implement appropriate security measures to protect your personal information. However, no method of transmission over the Internet is 100% secure.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6">
              <li>Access your personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your information</li>
              <li>Object to processing of your information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">6. Contact Us</h2>
            <p>If you have questions about this Privacy Policy, please contact us at:</p>
            <p className="mt-2">Email: support@pensivebooks.com</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};

export default PrivacyPolicy; 