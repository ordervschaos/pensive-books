import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/page/PageLoading";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Upload, Save, ArrowLeft } from "lucide-react";

export default function ProfileEdit() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [intro, setIntro] = useState("");
  const [profilePic, setProfilePic] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate("/auth");
          return;
        }

        const { data: userDataResult, error } = await supabase
          .from("user_data")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (error) throw error;

        setUserData(userDataResult);
        setIntro(userDataResult.intro || "");
        setProfilePic(userDataResult.profile_pic || "");
      } catch (error: any) {
        console.error("Error fetching user data:", error);
        toast({
          variant: "destructive",
          title: "Error loading profile",
          description: error.message,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [navigate, toast]);

  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 400; // Square size
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          // Calculate dimensions to crop to square (centered)
          const aspectRatio = img.width / img.height;
          let sourceX = 0;
          let sourceY = 0;
          let sourceWidth = img.width;
          let sourceHeight = img.height;

          if (aspectRatio > 1) {
            // Wider than tall - crop sides
            sourceWidth = img.height;
            sourceX = (img.width - sourceWidth) / 2;
          } else if (aspectRatio < 1) {
            // Taller than wide - crop top/bottom
            sourceHeight = img.width;
            sourceY = (img.height - sourceHeight) / 2;
          }

          // Draw the cropped and resized image
          ctx.drawImage(
            img,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, size, size
          );

          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Could not create blob'));
            }
          }, 'image/jpeg', 0.9);
        };
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingImage(true);

      // Resize and crop image to square
      const resizedBlob = await resizeImage(file);

      // Upload to profile-pictures bucket
      const fileName = `${crypto.randomUUID()}.jpg`;
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("You must be logged in to upload a profile picture");
      }

      const filePath = `${user.id}/${fileName}`;

      const { data, error } = await supabase.storage
        .from("profile-pictures")
        .upload(filePath, resizedBlob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from("profile-pictures")
        .getPublicUrl(data.path);

      setProfilePic(urlData.publicUrl);
      console.log('Image uploaded, URL set to:', urlData.publicUrl);
      toast({
        title: "Image uploaded",
        description: "Your profile picture has been uploaded successfully. Click 'Save Changes' to update your profile.",
      });
    } catch (error: any) {
      console.error("Error uploading image:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      console.log('Saving profile with:', { intro, profile_pic: profilePic });

      const { error } = await supabase
        .from("user_data")
        .update({
          intro,
          profile_pic: profilePic,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

      if (error) {
        console.error('Save error:', error);
        throw error;
      }

      console.log('Profile saved successfully');

      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
      });

      // Navigate to user's profile
      if (userData?.username) {
        navigate(`/${userData.username}`);
      }
    } catch (error: any) {
      console.error("Error saving profile:", error);
      toast({
        variant: "destructive",
        title: "Error saving profile",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <PageLoading />;
  }

  const userInitials = userData?.username
    ? userData.username.substring(0, 2).toUpperCase()
    : "?";

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-3xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate(userData?.username ? `/${userData.username}` : "/my-books")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Profile
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Edit Your Profile</CardTitle>
            <CardDescription>
              Update your profile picture and introduction. This is your publishing page that others will see.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Profile Picture */}
            <div className="space-y-2">
              <Label>Profile Picture</Label>
              <div className="flex items-center gap-4">
                <Avatar className="h-24 w-24">
                  <AvatarImage
                    key={profilePic}
                    src={profilePic || undefined}
                    alt={userData?.username || "User"}
                  />
                  <AvatarFallback>{userInitials}</AvatarFallback>
                </Avatar>
                {profilePic && (
                  <div className="text-xs text-muted-foreground">
                    Preview: Image loaded
                  </div>
                )}
                <div className="space-y-2">
                  <Input
                    id="profile-pic-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById("profile-pic-upload")?.click()}
                    disabled={uploadingImage}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadingImage ? "Uploading..." : "Upload Picture"}
                  </Button>
                  {profilePic && (
                    <Button
                      variant="ghost"
                      onClick={() => setProfilePic("")}
                      disabled={uploadingImage}
                    >
                      Remove Picture
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Username (read-only) */}
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={userData?.username || ""} disabled />
              <p className="text-sm text-muted-foreground">
                Your username cannot be changed here. Your profile is at: /{userData?.username}
              </p>
            </div>

            {/* Intro */}
            <div className="space-y-2">
              <Label htmlFor="intro">Introduction</Label>
              <Textarea
                id="intro"
                placeholder="Write a brief introduction about yourself. This will be displayed on your public profile page."
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                rows={6}
                maxLength={500}
              />
              <p className="text-sm text-muted-foreground">
                {intro.length}/500 characters
              </p>
            </div>

            {/* Save Button */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => navigate(userData?.username ? `/${userData.username}` : "/my-books")}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
