const sdk = typeof window !== "undefined" ? window.Appwrite : null;

if (!sdk) {
  throw new Error("Appwrite SDK yüklenemedi. HTML içinde iife sdk.js script'ini ekleyin.");
}

export const Client = sdk.Client;
export const Databases = sdk.Databases;
export const Storage = sdk.Storage;
export const Account = sdk.Account;
export const ID = sdk.ID;
export const Query = sdk.Query;
