import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Loader2 } from "lucide-react";

interface UserData {
  kindle_email: string | null;
  kindle_configured: boolean;
}

export default function KindleSettings() {
  const [kindleEmail, setKindleEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const loadKindleEmail = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('user_data')
        .select('kindle_email, kindle_configured')
        .eq('user_id', session.user.id)
        .single();

      if (error) {
        console.error("Error loading Kindle email:", error);
        return;
      }

      if (data) {
        setKindleEmail(data.kindle_email || "");
        setIsConfigured(data.kindle_configured || false);
      }
    };

    loadKindleEmail();
  }, []);

  const handleSave = async () => {
    if (!kindleEmail) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter your Kindle email address"
      });
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { error } = await supabase
        .from('user_data')
        .upsert({ 
          user_id: session.user.id,
          kindle_email: kindleEmail.toLowerCase(),
          kindle_configured: false // Reset configuration when email changes
        });

      if (error) throw error;

      toast({
        title: "Email saved",
        description: "Now let's verify your Kindle email"
      });
      
      // Proceed to verification
      handleSendVerification();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving settings",
        description: error.message
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSendVerification = async () => {
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke('send-kindle-verification', {
        body: { kindleEmail },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) throw error;

      setShowOtpInput(true);
      toast({
        title: "Verification sent",
        description: "Check your Kindle for the verification code"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error sending verification",
        description: error.message
      });
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter the verification code"
      });
      return;
    }

    setVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Verify OTP
      const { data, error } = await supabase
        .from('user_data')
        .select('kindle_verification_otp, kindle_verification_expires')
        .eq('user_id', session.user.id)
        .single();

      if (error) throw error;

      if (!data.kindle_verification_otp || !data.kindle_verification_expires) {
        throw new Error('No verification code found. Please request a new one.');
      }

      if (new Date(data.kindle_verification_expires) < new Date()) {
        throw new Error('Verification code has expired. Please request a new one.');
      }

      if (data.kindle_verification_otp !== otp) {
        throw new Error('Invalid verification code');
      }

      // Mark as configured
      const { error: updateError } = await supabase
        .from('user_data')
        .update({ 
          kindle_configured: true,
          kindle_verification_otp: null,
          kindle_verification_expires: null
        })
        .eq('user_id', session.user.id);

      if (updateError) throw updateError;

      setIsConfigured(true);
      setShowOtpInput(false);
      toast({
        title: "Success",
        description: "Your Kindle email has been verified"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error verifying code",
        description: error.message
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Kindle Settings</CardTitle>
          <CardDescription>
            Configure your Kindle email to receive books directly on your device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Important Setup Instructions</AlertTitle>
            <AlertDescription className="mt-4">
              <p className="mb-4">
                To receive books on your Kindle, you need to:
              </p>
              <ol className="list-decimal pl-4 space-y-2">
                <li>
                  Add your Kindle email address below (usually ends with @kindle.com)
                </li>
                <li>
                  Go to your{" "}
                  <a 
                    href="https://www.amazon.com/hz/mycd/myx#/home/settings/payment" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Amazon Content and Devices
                  </a>
                  {" "}page
                </li>
                <li>
                  Under "Preferences" Tab, under "Personal Document Settings", add "hello@pensive.me" to your approved email list
                </li>
              </ol>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="kindle-email">Your Kindle Email</Label>
            <Input
              id="kindle-email"
              type="email"
              placeholder="your.kindle@kindle.com"
              value={kindleEmail}
              onChange={(e) => setKindleEmail(e.target.value)}
              disabled={showOtpInput}
            />
            <p className="text-sm text-muted-foreground">
              You can find your Kindle email in your Amazon account under "Your Devices and Content"
            </p>
          </div>

          {!showOtpInput ? (
            <Button 
              onClick={handleSave} 
              disabled={saving || sending}
              className="w-full"
            >
              {(saving || sending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Saving..." : sending ? "Sending Verification..." : isConfigured ? "Update Email" : "Save & Verify Email"}
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                />
                <p className="text-sm text-muted-foreground">
                  Enter the verification code sent to your Kindle
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleVerifyOtp} 
                  disabled={verifying}
                  className="flex-1"
                >
                  {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {verifying ? "Verifying..." : "Verify Code"}
                </Button>
                <Button 
                  onClick={handleSendVerification}
                  variant="outline"
                  disabled={sending}
                  className="flex-1"
                >
                  {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {sending ? "Sending..." : "Resend Code"}
                </Button>
              </div>
            </div>
          )}

          {isConfigured && !showOtpInput && (
            <Alert variant="default" className="bg-green-50 dark:bg-green-950">
              <Info className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-600 dark:text-green-400">Kindle Email Verified</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                Your Kindle email has been verified and is ready to receive books.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
