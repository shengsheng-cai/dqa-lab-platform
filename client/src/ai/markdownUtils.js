export function cleanText(text) {
  return text
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}
