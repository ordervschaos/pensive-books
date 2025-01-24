import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Pensive</h1>
          <p className="text-xl text-muted-foreground">
            Your personal knowledge base and collaborative writing platform
          </p>

          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={() => navigate("/auth")}>
              Get Started
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/library")}>
              Browse Library
            </Button>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <Card>
              <CardHeader>
                <CardTitle>Personal Notes</CardTitle>
                <CardDescription>
                  Create and organize your thoughts
                </CardDescription>
              </CardHeader>
              <CardContent>
                Keep all your ideas, research, and knowledge in one place
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Collaboration</CardTitle>
                <CardDescription>
                  Work together with others
                </CardDescription>
              </CardHeader>
              <CardContent>
                Share your books and collaborate in real-time
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Public Library</CardTitle>
                <CardDescription>
                  Discover and learn
                </CardDescription>
              </CardHeader>
              <CardContent>
                Browse through published books and expand your knowledge
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}