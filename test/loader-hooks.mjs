/**
 * Test-only module resolution hook.
 *
 * Application code uses extensionless relative imports (`./normalize`), which
 * is what Next's bundler expects. Node's ESM resolver requires the extension.
 * Rather than write `./normalize.ts` everywhere and couple the source to the
 * test runner, we retry failed relative resolutions with a `.ts`/`.tsx`
 * extension — and only for relative specifiers, so a genuinely missing package
 * still fails loudly.
 */

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * `server-only` deliberately throws unless resolved under React's
 * "react-server" condition, which plain Node does not set. It is a build-time
 * assertion with no runtime behaviour, so the test run swaps in an empty
 * module — the guarantee it encodes is enforced by Next, not by the tests.
 */
const STUB = "data:text/javascript,export{}";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: STUB, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!isRelative) throw error;

    for (const extension of EXTENSIONS) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        // Try the next candidate extension.
      }
    }
    throw error;
  }
}
