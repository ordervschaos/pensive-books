
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ManageCollaboratorsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageCollaboratorsSheet({ open, onOpenChange }: ManageCollaboratorsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Manage Collaborators</SheetTitle>
        </SheetHeader>
        {/* Add collaborator management UI here */}
      </SheetContent>
    </Sheet>
  );
}
