import { randomUUID } from "node:crypto";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
}

export interface AccountRecord {
  id: string;
  ownerUserId: string;
  name: string;
  baseCurrency: string;
}

/**
 * Persistence port for identity and accounts. Every account read is scoped to
 * the owning user: getAccountForUser returns undefined for another user's id,
 * so the caller cannot tell "missing" from "not yours".
 */
export interface IdentityStore {
  createUser(email: string, passwordHash: string): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  findUserById(id: string): Promise<UserRecord | undefined>;
  createAccount(ownerUserId: string, name: string, baseCurrency: string): Promise<AccountRecord>;
  getAccountForUser(userId: string, accountId: string): Promise<AccountRecord | undefined>;
  listAccountsForUser(userId: string): Promise<AccountRecord[]>;
}

/** In-memory store for tests and the no-database development mode. */
export class MemoryIdentityStore implements IdentityStore {
  private readonly users = new Map<string, UserRecord>();
  private readonly accounts = new Map<string, AccountRecord>();

  async createUser(email: string, passwordHash: string): Promise<UserRecord> {
    const normalised = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === normalised) throw new Error("duplicate email");
    }
    const user: UserRecord = { id: randomUUID(), email: normalised, passwordHash, role: "OWNER" };
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const normalised = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email === normalised) return u;
    }
    return undefined;
  }

  async findUserById(id: string): Promise<UserRecord | undefined> {
    return this.users.get(id);
  }

  async createAccount(ownerUserId: string, name: string, baseCurrency: string): Promise<AccountRecord> {
    const account: AccountRecord = { id: randomUUID(), ownerUserId, name, baseCurrency };
    this.accounts.set(account.id, account);
    return account;
  }

  async getAccountForUser(userId: string, accountId: string): Promise<AccountRecord | undefined> {
    const account = this.accounts.get(accountId);
    if (!account || account.ownerUserId !== userId) return undefined;
    return account;
  }

  async listAccountsForUser(userId: string): Promise<AccountRecord[]> {
    return [...this.accounts.values()].filter((a) => a.ownerUserId === userId);
  }
}
