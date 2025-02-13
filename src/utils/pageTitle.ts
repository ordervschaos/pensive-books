export const setPageTitle = (title: string | null | undefined) => {
  document.title = title ? `${title} | Pensive Books` : 'Pensive Books';
}; 