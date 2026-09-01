export interface AuthUser {
  userId: string;
  email: string;
  username: string;
}

export const AUTH_USER = Symbol("AUTH_USER");
