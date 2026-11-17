import { readFile, writeFile } from 'node:fs/promises';

const paths = process.argv.slice(2);
if (paths.length !== 2 || !paths[0].endsWith('.js') || !paths[1].endsWith('.mjs')) {
  throw new Error('Expected the compiled .js path followed by the compiled .mjs path');
}

function replaceExactly(source, pattern, replacement, label, expected = 1) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== expected) {
    throw new Error(`Expected ${expected} ${label} match(es); found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function unwrapReplyButtons(source) {
  const marker = /viewOnceMessage:\{message:\{interactiveMessage:\{body:/g;
  const matches = [...source.matchAll(marker)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one compiled reply/CTA button viewOnce wrapper; found ${matches.length}`);
  }

  const markerIndex = matches[0].index;
  const endPattern = /\}\};return await this\.sendMessageWithTyping\(/g;
  endPattern.lastIndex = markerIndex;
  const endMatch = endPattern.exec(source);
  if (!endMatch) throw new Error('Compiled button message terminator changed');

  const objectEndIndex = endMatch.index + 2;
  const objectStart = source.lastIndexOf('viewOnceMessage:{message:{interactiveMessage:{body:', markerIndex);
  if (objectStart !== markerIndex) throw new Error('Compiled button wrapper boundary changed');

  const objectBody = source.slice(markerIndex, objectEndIndex);
  const trailingBraces = objectBody.match(/\}+$/)?.[0];
  // NativeFlow, InteractiveMessage, inner message, viewOnceMessage, outer
  // message are the five expected closes in this fixed compiled shape.
  if (trailingBraces?.length !== 5) throw new Error('Compiled button object closing shape changed');

  const withoutWrapper = objectBody
    .replace(/^viewOnceMessage:\{message:\{/, '')
    .replace(/\}{5}$/, '}}}');
  return source.slice(0, markerIndex) + withoutWrapper + source.slice(objectEndIndex);
}

function patchSource(source, path) {
  let patched = source;

  patched = unwrapReplyButtons(patched);

  // Direct interactive/list payloads must use Baileys relayMessage so the
  // stanza-level biz nodes can accompany the existing message and messageId.
  const dispatchPattern = /,(\w+)\.viewOnceMessage\)\{/g;
  patched = replaceExactly(
    patched,
    dispatchPattern,
    ',$1.viewOnceMessage||$1.interactiveMessage||$1.listMessage){',
    'compiled relay dispatch condition',
  );

  const relayPattern = /this\.client\.relayMessage\((\w+),(\w+),\{messageId:(\w+)\}\)/g;
  const relayReplacement = (_match, sender, message, messageId) =>
    `this.client.relayMessage(${sender},${message},{messageId:${messageId},...(${message}.interactiveMessage?{additionalNodes:[{tag:"biz",attrs:{},content:[{tag:"interactive",attrs:{type:"native_flow",v:"1"},content:[{tag:"native_flow",attrs:{v:"9",name:"mixed"}}]}]}]}:${message}.listMessage?{additionalNodes:[{tag:"biz",attrs:{},content:[{tag:"list",attrs:{type:"product_list",v:"2"}}]}]}:{})})`;
  patched = replaceExactly(patched, relayPattern, relayReplacement, 'compiled relay call');
  const relayResultPattern = /(\w+)=await this\.client\.relayMessage\((\w+),(\w+),\{messageId:(\w+),\.\.\.\(/g;
  const relayResults = [...patched.matchAll(relayResultPattern)];
  if (relayResults.length !== 1) throw new Error(`Relay ID result shape changed in ${path}`);
  const [, relayId, sender] = relayResults[0];
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const returnedKeyPattern = new RegExp(`\\.key=\\{id:${escapeRegex(relayId)},remoteJid:${escapeRegex(sender)}`);
  if (!returnedKeyPattern.test(patched)) {
    throw new Error(`Compiled send response no longer uses the relay ID and recipient in ${path}`);
  }

  const listPayloadPattern = /(listMessage:\{title:(\w+)\.title,description:\2\.description,buttonText:\2\?\.buttonText,footerText:\2\?\.footerText,sections:\2\.sections,listType:)2(\})/g;
  patched = replaceExactly(
    patched,
    listPayloadPattern,
    (_match, prefix, _data, suffix) => `${prefix}1${suffix}`,
    'compiled legacy list payload',
  );

  const clonePattern = /(\w+)=JSON\.parse\(JSON\.stringify\(\1\)\),/g;
  patched = replaceExactly(patched, clonePattern, '', 'compiled protobuf JSON clone', 2);

  // Fail closed if the transformations did not leave exactly the intended
  // wire shapes and preserve the event/log patches in this same image layer.
  if (/viewOnceMessage:\{message:\{interactiveMessage:\{body:/.test(patched)) {
    throw new Error(`Reply/CTA interactive message still has a viewOnce wrapper in ${path}`);
  }
  if (!/\.interactiveMessage\?\{additionalNodes:\[\{tag:"biz"/.test(patched)) {
    throw new Error(`Interactive biz/native_flow node is missing in ${path}`);
  }
  if (!/\.listMessage\?\{additionalNodes:\[\{tag:"biz"/.test(patched)) {
    throw new Error(`List biz/product_list node is missing in ${path}`);
  }
  if (!/listMessage:\{title:\w+\.title,description:\w+\.description,buttonText:\w+\?\.buttonText,footerText:\w+\?\.footerText,sections:\w+\.sections,listType:1\}/.test(patched)) {
    throw new Error(`Legacy SINGLE_SELECT list payload is missing in ${path}`);
  }
  if (/(\w+)=JSON\.parse\(JSON\.stringify\(\1\)\)/.test(patched)) {
    throw new Error(`Protobuf JSON clone remains in ${path}`);
  }
  if (!/this\.sendDataWebhook\("messages\.upsert",/.test(patched)) {
    throw new Error(`messages.upsert emission is missing in ${path}`);
  }

  return patched;
}

const files = [];
for (const path of paths) {
  const source = await readFile(path, 'utf8');
  const patched = patchSource(source, path);
  files.push({ path, source, patched });
}

for (const { path, patched } of files) {
  await writeFile(path, patched, 'utf8');
  console.log(`Patched compiled reply buttons and legacy lists once: ${path}`);
}
