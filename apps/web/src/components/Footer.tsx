import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="border-t mt-auto">
      <div className="container max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Pensive. All rights reserved.
          </div>
          <nav className="flex items-center gap-6">
            <Link 
              to="/contact"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact Us
            </Link>
            <Link 
              to="/privacy" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <Link 
              to="/terms" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms & Conditions
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
} 