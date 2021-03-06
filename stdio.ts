/* Deno already has similar `prompt` function inherited from DOM API
   but this one async  */

export async function prompt(q = "") {
  const buf = new Uint8Array(1024);

  await Deno.stdout.write(new TextEncoder().encode(q));

  const n = await Deno.stdin.read(buf);
  if (n === null) {
    return null;
  }

  return new TextDecoder().decode(buf.slice(0, n)).trim();
}
