type SigningConfig = { publicKey: string; privateKey: string; subject: string };
type KeyPair = { publicKey: string; privateKey: string };
type Database = {
  rpc(name: string, parameters?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const subject = "https://gyungchung.vercel.app";
const unavailable = () => new Error("Web push signing configuration unavailable");

function parseConfig(data: unknown): SigningConfig {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
  const config = data as Record<string, unknown>;
  if (typeof config.public_key !== "string" || !/^B[A-Za-z0-9_-]{86}$/.test(config.public_key)
    || typeof config.private_key !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(config.private_key)
    || config.subject !== subject) throw unavailable();
  return { publicKey: config.public_key, privateKey: config.private_key, subject };
}

export async function loadWebPushConfig(database: Database, generateKeys: () => KeyPair | Promise<KeyPair>): Promise<SigningConfig> {
  try {
    const existing = await database.rpc("get_web_push_config");
    if (existing.error) throw unavailable();
    if (existing.data !== null) return parseConfig(existing.data);
    const keys = await generateKeys();
    if (!keys || typeof keys.publicKey !== "string" || !/^B[A-Za-z0-9_-]{86}$/.test(keys.publicKey)
      || typeof keys.privateKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(keys.privateKey)) throw unavailable();
    const initialized = await database.rpc("initialize_web_push_config", {
      target_public_key: keys.publicKey, target_private_key: keys.privateKey,
    });
    if (initialized.error) throw unavailable();
    // A concurrent writer can win; always use the pair returned by the database.
    return parseConfig(initialized.data);
  } catch {
    // Never forward database, generator or network errors containing signing material.
    throw unavailable();
  }
}
