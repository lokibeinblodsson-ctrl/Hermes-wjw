declare module "*.sql?raw" {
  const content: string;
  export default content;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
