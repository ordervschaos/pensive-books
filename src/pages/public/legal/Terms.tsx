import { Card, CardContent } from "@/components/ui/card";

export const Terms = () => {
  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-4xl font-bold mb-8">Terms and Conditions</h1>
      <Card>
        <CardContent className="p-6 prose prose-slate dark:prose-invert max-w-none">
          <p className="text-sm text-muted-foreground mb-4">Last updated: {new Date().toLocaleDateString()}</p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p>By accessing and using Pensive, you accept and agree to be bound by these Terms and Conditions. If you do not agree to these terms, please do not use our service.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. User Accounts</h2>
            <ul className="list-disc pl-6">
              <li>You must provide accurate and complete information when creating an account</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>You must notify us immediately of any unauthorized access</li>
              <li>We reserve the right to suspend or terminate accounts that violate these terms</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Content</h2>
            <p>By using our service, you agree that:</p>
            <ul className="list-disc pl-6">
              <li>You own or have the necessary rights to the content you create</li>
              <li>Your content does not violate any third-party rights</li>
              <li>You grant us a license to host and share your content</li>
              <li>You are responsible for the content you post</li>
              <li>Your content is not unsafe or harmful to others</li>
              <li>Your content is not vulgar or sexually explicit</li>
              <li>We may remove content that violates these terms or is otherwise inappropriate</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Intellectual Property</h2>
            <ul className="list-disc pl-6">
              <li>Our service and its original content are protected by copyright and other laws</li>
              <li>Our trademarks and trade dress may not be used without permission</li>
              <li>You retain ownership of your content</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Prohibited Activities</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6">
              <li>Violate any laws or regulations</li>
              <li>Impersonate others or provide false information</li>
              <li>Interfere with the service's security features</li>
              <li>Use the service for unauthorized commercial purposes</li>
              <li>Harass or harm other users</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Limitation of Liability</h2>
            <p>We provide the service "as is" without warranties of any kind. We are not liable for any damages arising from:</p>
            <ul className="list-disc pl-6">
              <li>Use or inability to use the service</li>
              <li>Unauthorized access to your account</li>
              <li>Loss or corruption of data</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Changes to Terms</h2>
            <p>We reserve the right to modify these terms at any time. We will notify users of significant changes via email or through the service.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. License Agreement</h2>
            <p className="mt-4">
              Users are granted permission to install, use, and modify one instance of the Software for personal use. 
              This license does not grant rights to publish, distribute, sublicense, or sell the Software, its source code, 
              or any derivative works.
            </p>
            <p className="mt-4 uppercase text-sm">
              THE SOFTWARE IS PROVIDED "AS IS", WITHOUT ANY WARRANTIES OR GUARANTEES, WHETHER EXPRESS OR IMPLIED, INCLUDING 
              BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR PURPOSE AND NON-INFRINGEMENT. THE AUTHORS AND COPYRIGHT HOLDERS 
              SHALL NOT BE LIABLE FOR ANY CLAIMS, DAMAGES OR OTHER LIABILITY ARISING FROM THE USE OR DISTRIBUTION OF THE SOFTWARE.
            </p>
            <p className="mt-4">
              By using the Software, users agree to comply with all applicable laws and regulations regarding its download 
              and use.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Contact Information</h2>
            <p>For questions about these Terms and Conditions, please contact us at:</p>
            <p className="mt-2">Email: toanzalansari@gmail.com</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};

export default Terms; 