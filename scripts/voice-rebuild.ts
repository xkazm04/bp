// Rebuilds Glim's voice where VOICE.voiceId does not resolve (another ElevenLabs account, a deleted library voice), from
// the design record in packages/core/src/companion/voice.ts (VOICE_DESIGN). Procedure and acceptance: docs/voice/glim.md.
//
//   node scripts/voice-rebuild.ts status               does VOICE.voiceId resolve on this key's account? (free)
//   node scripts/voice-rebuild.ts clone                instant clone from the reference clips -> prints a voice_id
//   node scripts/voice-rebuild.ts design               redesign from the record -> 3 previews to listen to
//   node scripts/voice-rebuild.ts save <generated_id>  save one design preview to the library -> prints a voice_id
//   node scripts/voice-rebuild.ts audition <voice_id>  read the reference lines with VOICE's settings, for comparison
//
// Audio lands in $BP_HOME/companion/voice-rebuild/. Every command but status spends ElevenLabs credits. The key is read
// like the server reads it (ELEVEN_LABS_API_KEY, else bp's .env) and is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { VOICE, VOICE_DESIGN } from '../packages/core/src/companion/voice.ts';
import { companionHome, repoRoot } from '../packages/core/src/server/companion/home.server.ts';
import { voiceKey } from '../packages/core/src/server/companion/voice.server.ts';

const API = 'https://api.elevenlabs.io/v1';
const OUT = path.join(companionHome(), 'voice-rebuild');
const key = voiceKey();
if (!key) { console.log('REFUSED: no ELEVEN_LABS_API_KEY in the environment or bp\'s .env'); process.exit(2); }
const H = { 'xi-api-key': key };

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) { console.log(`FAILED ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  return res;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const save = (name: string, buf: Buffer) => { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, name); fs.writeFileSync(f, buf); return f; };

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'status') {
  const res = await fetch(`${API}/voices/${VOICE.voiceId}`, { headers: H });
  console.log(res.ok ? `OK: ${VOICE.voiceId} resolves ("${(await res.json()).name}")` : `MISSING: ${VOICE.voiceId} is not on this account (${res.status}); run clone or design`);
  process.exit(res.ok ? 0 : 1);
} else if (cmd === 'clone') {
  const form = new FormData();
  form.append('name', `Glim - ${VOICE_DESIGN.name} (clone)`);
  form.append('description', VOICE_DESIGN.description);
  form.append('remove_background_noise', 'false');
  for (const r of VOICE_DESIGN.reference) {
    form.append('files', new Blob([fs.readFileSync(path.join(repoRoot(), r.file))], { type: 'audio/mpeg' }), path.basename(r.file));
  }
  const { voice_id } = await (await call(`${API}/voices/add`, { method: 'POST', body: form })).json();
  console.log(`voice_id=${voice_id}\nnext: node scripts/voice-rebuild.ts audition ${voice_id}`);
} else if (cmd === 'design') {
  const d = VOICE_DESIGN;
  const res = await call(`${API}/text-to-voice/design?output_format=${VOICE.format}`,
    json({ voice_description: d.description, text: d.text, model_id: d.modelId, guidance_scale: d.guidanceScale, seed: d.seed }));
  const { previews } = await res.json() as { previews: { generated_voice_id: string; audio_base_64: string }[] };
  previews.forEach((p, i) => console.log(`preview ${i}${i === d.preview ? ' (the record\'s pick)' : ''}: ${p.generated_voice_id} -> ${save(`design-${i}.mp3`, Buffer.from(p.audio_base_64, 'base64'))}`));
  console.log(`compare with ${VOICE_DESIGN.reference[0].file}, then: node scripts/voice-rebuild.ts save <generated_id>`);
} else if (cmd === 'save' && arg) {
  const { voice_id } = await (await call(`${API}/text-to-voice`,
    json({ voice_name: `Glim - ${VOICE_DESIGN.name}`, voice_description: VOICE_DESIGN.description, generated_voice_id: arg }))).json();
  console.log(`voice_id=${voice_id}\nnext: node scripts/voice-rebuild.ts audition ${voice_id}`);
} else if (cmd === 'audition' && arg) {
  for (const r of VOICE_DESIGN.reference) {
    if (!r.text) continue;
    const res = await call(`${API}/text-to-speech/${arg}?output_format=${VOICE.format}`,
      json({ text: r.text, model_id: VOICE.modelId, voice_settings: VOICE.settings, seed: VOICE.seed, apply_text_normalization: 'on' }));
    console.log(`${save(path.basename(r.file), Buffer.from(await res.arrayBuffer()))}  vs  ${r.file}`);
  }
  console.log(`listen side by side; if it is the voice, set VOICE.voiceId = '${arg}' in packages/core/src/companion/voice.ts`);
} else {
  console.log('usage: node scripts/voice-rebuild.ts status | clone | design | save <generated_id> | audition <voice_id>');
  process.exit(2);
}
