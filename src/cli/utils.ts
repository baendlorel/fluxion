export function quit(message: string): never {
  console.log(message);
  process.exit(0);
}
