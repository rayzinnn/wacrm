import { readFile, writeFile } from 'node:fs/promises';

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  throw new Error('Expected exactly the compiled .js and .mjs paths');
}

const pattern = /console\.log\(([A-Za-z_$][\w$]*)\),this\.sendDataWebhook\("messages\.upsert",\1\)/g;
const files = [];

for (const path of paths) {
  const source = await readFile(path, 'utf8');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one compiled upsert object log in ${path}; found ${matches.length}`);
  }

  const match = matches[0];
  const emissionPattern = /this\.sendDataWebhook\("messages\.upsert",/g;
  const emissionsBefore = [...source.matchAll(emissionPattern)].length;
  const replacement = `this.sendDataWebhook("messages.upsert",${match[1]})`;
  const patched = source.replace(pattern, replacement);
  const emissionsAfter = [...patched.matchAll(emissionPattern)].length;
  const expectedLengthReduction = `console.log(${match[1]}),`.length;
  if (
    patched === source ||
    [...patched.matchAll(pattern)].length !== 0 ||
    emissionsAfter !== emissionsBefore ||
    source.length - patched.length !== expectedLengthReduction
  ) {
    throw new Error(`Compiled upsert log was not removed cleanly in ${path}`);
  }
  files.push({ path, patched });
}

for (const { path, patched } of files) {
  await writeFile(path, patched, 'utf8');
  console.log(`Removed one raw messages.upsert object log: ${path}`);
}
