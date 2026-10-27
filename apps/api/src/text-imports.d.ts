// Bun loads these as strings when imported `with { type: "text" }`.
declare module "*.md" {
  const text: string;
  export default text;
}
