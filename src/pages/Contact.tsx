import { Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Contact() {
  return (
    <div className="container max-w-2xl mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Contact Us</CardTitle>
          <CardDescription>
            We're here to help with any questions or concerns you may have
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Get in Touch</h2>
            <p className="text-muted-foreground mb-6">
              Whether you have questions about Pensive, need technical support, or want to provide feedback,
              we're here to help. You can reach us at:
            </p>
            <div className="flex items-center gap-3 text-lg">
              <Mail className="h-5 w-5 text-primary" />
              <a 
                href="mailto:toanzalansari@gmail.com"
                className="text-primary hover:underline"
              >
                toanzalansari@gmail.com
              </a>
            </div>
          </div>
          
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              We aim to respond to all inquiries within 24-48 hours during business days.
              For faster responses, please include:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>A clear description of your question or issue</li>
              <li>Any relevant details or context</li>
              <li>Steps to reproduce if reporting a technical problem</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 