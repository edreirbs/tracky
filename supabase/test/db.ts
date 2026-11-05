// Postgres real en memoria (PGlite) con un esquema `auth` mínimo como el de Supabase,
// para probar migraciones, RLS y funciones de la economía sin un proyecto en la nube.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

const AUTH_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;

export type Db = PGlite & {
  /** Ejecuta como usuario autenticado (RLS activo). */
  as<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  /** Crea un usuario permitido y devuelve su id. */
  createUser(email: string): Promise<string>;
};

export async function freshDb(): Promise<Db> {
  const pg = (await PGlite.create()) as Db;
  await pg.exec(AUTH_STUB);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  pg.as = async (userId, fn) => {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
    try {
      return await fn();
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  };
  pg.createUser = async (email) => {
    await pg.query("insert into public.allowed_emails (email) values ($1) on conflict do nothing", [email]);
    const r = await pg.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    return r.rows[0]!.id;
  };
  return pg;
}
