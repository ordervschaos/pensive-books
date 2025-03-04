
export async function getBookBackCover(genre?: string): Promise<string> {
  // For now, we'll return a placeholder image URL
  // In a production app, you might want to use an AI service to generate covers
  return "https://via.placeholder.com/800x1200/475569/ffffff?text=" + encodeURIComponent(`${genre || 'Book'} Back Cover`);
}
