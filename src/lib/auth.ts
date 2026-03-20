import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { google } from "googleapis";

async function ensureUserInDb({
  id,
  email,
  name,
}: {
  id: string;
  email: string;
  name: string | null;
}) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({ id, email, name });
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account?.providerAccountId) return false;

      await ensureUserInDb({
        id: account.providerAccountId,
        email: user.email,
        name: user.name ?? null,
      });

      return true;
    },

    async jwt({ token, account }) {
      // On login: store tokens from provider
      if (account) {
        token.providerAccountId = account.providerAccountId;
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at ? account.expires_at * 1000 : null;
        return token;
      }

      // No expiration stored → nothing to refresh
      const expiresAt = token.expires_at as number | null;
      if (!expiresAt) return token;

      const isExpiringSoon = (expiresAt as number) < Date.now() + 5 * 60 * 1000;
      if (!isExpiringSoon) return token;

      const refreshToken = token.refresh_token;
      if (!refreshToken) {
        token.access_token = null;
        token.expires_at = null;
        return token;
      }

      try {
        const oauth = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );

        oauth.setCredentials({ refresh_token: refreshToken as string });
        const { credentials } = await oauth.refreshAccessToken();

        token.access_token = (credentials.access_token ?? null) as string | null;
        token.expires_at = (credentials.expiry_date ?? null) as number | null;

        if (credentials.refresh_token) {
          token.refresh_token = credentials.refresh_token as string;
        }
      } catch (err) {
        console.error("Failed to refresh Google access token:", err);
        token.access_token = null;
        token.expires_at = null;
      }

      return token;
    },

    async session({ session, token }) {
      session.userId = (token.providerAccountId as string) ?? "";
      session.access_token = (token.access_token as string | null) ?? null;
      return session;
    },
  },
});
