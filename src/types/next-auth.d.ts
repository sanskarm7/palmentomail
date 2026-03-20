import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    userId: string;
    access_token: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    providerAccountId: string;
    access_token: string | null | undefined;
    refresh_token: string | undefined;
    expires_at: number | null;
  }
}
