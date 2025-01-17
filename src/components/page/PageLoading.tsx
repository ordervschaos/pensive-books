import { Skeleton } from "@/components/ui/skeleton";

export const PageLoading = () => {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
};