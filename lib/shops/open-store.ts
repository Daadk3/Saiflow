/**
 * Open a store for a user who is already authenticated.
 *
 * The dashboard route and the founder bot both call this, so the name,
 * description, country and owner row cannot drift apart. The caller decides
 * who `userId` is. This function does not read a session and does not trust
 * a user id out of a request body of its own.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { parseNewStoreLocation } from "@/lib/store-location";

export interface OpenedStore {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  country: string | null;
  city: string | null;
}

export type OpenStoreResult =
  | { ok: true; shop: OpenedStore }
  | { ok: false; status: 400; error: string };

export async function openStoreForOwner(input: {
  userId: string;
  name: unknown;
  description: unknown;
  country: unknown;
  city: unknown;
}): Promise<OpenStoreResult> {
  const { name, description } = input;

  if (!name || typeof name !== "string" || name.trim().length < 2 || name.length > 100) {
    return { ok: false, status: 400, error: "Shop name must be between 2 and 100 characters" };
  }
  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== "string" || description.length > 1000)
  ) {
    return { ok: false, status: 400, error: "Description must be less than 1,000 characters" };
  }

  const location = parseNewStoreLocation({ country: input.country, city: input.city });
  if (!location.ok) return { ok: false, status: 400, error: location.error };

  const slug = slugify(name, "shop");
  const existingShop = await prisma.shop.findUnique({ where: { slug } });
  if (existingShop) {
    return { ok: false, status: 400, error: "A shop with this name already exists" };
  }

  try {
    const shop = await prisma.shop.create({
      data: {
        name,
        slug,
        description: typeof description === "string" ? description : null,
        country: location.country,
        city: location.city,
        shopUsers: {
          create: {
            userId: input.userId,
            role: "OWNER",
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        country: true,
        city: true,
      },
    });
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, status: 400, error: "A shop with this name already exists" };
    }
    throw error;
  }
}
