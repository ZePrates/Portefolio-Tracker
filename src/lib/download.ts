/** Descarrega texto como ficheiro (CSV exportado em formato português, etc.). */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Dá tempo ao browser para iniciar o descarregamento antes de libertar o URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
