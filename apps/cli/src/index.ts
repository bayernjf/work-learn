const [command, ...args] = process.argv.slice(2);

const commands = {
  capture: "Capture selected text or a clipboard entry for later review.",
  review: "Show the next review items from Work Learn.",
  search: "Search the saved corpus.",
  run: "Run an agent command with a future PTY recorder."
} as const;

if (!command || !(command in commands)) {
  console.log("Work Learn CLI\n");
  for (const [name, description] of Object.entries(commands)) console.log(`  learn ${name.padEnd(8)} ${description}`);
  process.exit(command ? 1 : 0);
}

console.log(`learn ${command}`, args.length ? args : "ready for implementation");
