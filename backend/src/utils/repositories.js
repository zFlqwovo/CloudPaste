import { RepositoryFactory } from "../repositories/index.js";

export const useRepositories = (c) => {
  let factory = c.get("repos");
  if (factory) {
    return factory;
  }

  const db = c.env?.DB;
  if (!db) {
    throw new Error("Database connection is not available in context");
  }

  factory = new RepositoryFactory(db);
  c.set("repos", factory);
  return factory;
};
