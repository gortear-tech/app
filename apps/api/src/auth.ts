import { createClient } from "@supabase/supabase-js";
import { unauthorizedError, User } from "@fbmaniaco/shared";
import { ApiConfig } from "./config.js";
import { DataStore } from "./db/index.js";

export type Actor = {
  userId: string;
  email: string;
};

const parseLocalToken = (token: string): Actor | null => {
  if (!token.startsWith("dev:")) return null;
  const [, userId, email] = token.split(":");
  if (!userId || !email) return null;
  return { userId, email };
};

export const authenticateBearer = async (input: {
  authorization: string | undefined;
  config: ApiConfig;
  store: DataStore;
}): Promise<{ actor: Actor; user: User }> => {
  const raw = input.authorization?.replace(/^Bearer\s+/i, "");
  if (!raw) throw unauthorizedError();

  const localActor = input.config.localAuthEnabled ? parseLocalToken(raw) : null;
  if (localActor) {
    const user = await input.store.upsertLocalUser({
      userId: localActor.userId,
      email: localActor.email,
      displayName: localActor.email.split("@")[0]
    });
    return { actor: localActor, user };
  }

  if (!input.config.supabaseUrl || !input.config.supabaseServiceRole) {
    throw unauthorizedError();
  }

  const supabase = createClient(input.config.supabaseUrl, input.config.supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const result = await supabase.auth.getUser(raw);
  if (result.error || !result.data.user?.id) {
    throw unauthorizedError();
  }

  const email = result.data.user.email || `${result.data.user.id}@anon.fbmaniaco.local`;
  const displayName =
    typeof result.data.user.user_metadata?.name === "string"
      ? result.data.user.user_metadata.name
      : typeof result.data.user.user_metadata?.full_name === "string"
        ? result.data.user.user_metadata.full_name
        : result.data.user.is_anonymous
          ? "Usuario FBmaniaco"
          : undefined;
  const actor = { userId: result.data.user.id, email };
  const user = await input.store.upsertLocalUser({
    userId: actor.userId,
    email: actor.email,
    ...(displayName ? { displayName } : {})
  });
  return { actor, user };
};
